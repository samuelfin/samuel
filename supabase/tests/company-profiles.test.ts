import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError } from "./db";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * A company is an identity six other tables point at, so it is versioned by
 * keeping its history beside it rather than by replacing the row. These tests pin
 * down that the history cannot be lost or rewritten, that the web address cannot
 * carry anything but a slug, that a listed company is reachable by the symbol a
 * reader knows, and that a reader sees only what has been reviewed.
 */

let db: PGlite;
let analyst: string;
let reviewer: string;
let admin: string;
let editor: string;
let reader: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  reviewer = await createUser(db, { staff: ["analyst"] });
  admin = await createUser(db, { admin: true });
  editor = await createUser(db, { staff: ["editor"] });
  reader = await createUser(db);
}, 180_000);

let counter = 0;

interface ProfileInput {
  actor?: string;
  name?: string;
  slug?: string | null;
  listingStatus?: string;
  companyId?: string | null;
  legalName?: string | null;
  sectorId?: string | null;
  industry?: string | null;
  description?: string | null;
  website?: string | null;
  listingBoard?: string | null;
  symbol?: string | null;
  reason?: string | null;
}

async function upsert(opts: ProfileInput = {}): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_profile(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     ) as id`,
    [
      opts.actor ?? analyst,
      opts.name ?? `Example Cement ${counter} Plc`,
      opts.slug === undefined ? null : opts.slug,
      opts.listingStatus ?? "listed",
      opts.companyId ?? null,
      opts.legalName ?? null,
      opts.sectorId ?? null,
      opts.industry ?? null,
      opts.description ?? null,
      opts.website ?? null,
      opts.listingBoard ?? null,
      opts.symbol === undefined ? `EXCEM${counter}` : opts.symbol,
      opts.reason ?? null,
    ],
  );
  return rows[0].id;
}

async function companyRow(id: string) {
  const { rows } = await db.query<{
    name: string;
    slug: string;
    listing_status: string;
    listing_board: string | null;
    review_status: string;
    review_self_approved: boolean;
    reviewed_by: string | null;
    reviewed_version: number | null;
  }>(
    `select name, slug, listing_status, listing_board, review_status, review_self_approved,
            reviewed_by, reviewed_version
       from public.companies where id = $1`,
    [id],
  );
  return rows[0];
}

async function versions(id: string) {
  const { rows } = await db.query<{
    version: number;
    name: string;
    slug: string;
    ngx_symbol: string | null;
    change_reason: string | null;
    changed_by: string | null;
  }>(
    `select version, name, slug, ngx_symbol, change_reason, changed_by
       from public.company_profile_versions where company_id = $1 order by version`,
    [id],
  );
  return rows;
}

async function currentSymbol(id: string): Promise<string | null> {
  const { rows } = await db.query<{ value: string }>(
    `select ii.value
       from public.instrument_identifiers ii
       join public.instruments i on i.id = ii.instrument_id
      where i.company_id = $1 and i.asset_class = 'equity'
        and ii.scheme = 'ngx_symbol' and ii.valid_to is null`,
    [id],
  );
  return rows[0]?.value ?? null;
}

describe("creating a company profile", () => {
  it("records version 1 and leaves the company pending review", async () => {
    const id = await upsert({ name: "Example Cement Plc", symbol: "EXCEM" });
    const company = await companyRow(id);

    expect(company.review_status).toBe("pending");
    expect(company.slug).toBe("example-cement-plc");

    const history = await versions(id);
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].ngx_symbol).toBe("EXCEM");
    expect(history[0].changed_by).toBe(analyst);
  });

  it("derives the web address from the name when none is given", async () => {
    const id = await upsert({ name: "Trans  Atlantic   Holdings  PLC", slug: null });
    expect((await companyRow(id)).slug).toBe("trans-atlantic-holdings-plc");
  });

  it("stores a ticker in upper case on the equity instrument", async () => {
    const id = await upsert({ symbol: "exoil" });
    expect(await currentSymbol(id)).toBe("EXOIL");
  });

  it("accepts a pre-listing company with no ticker at all", async () => {
    const id = await upsert({ listingStatus: "pre_listing", symbol: null });
    const company = await companyRow(id);
    expect(company.listing_status).toBe("pre_listing");
    expect(await currentSymbol(id)).toBeNull();
  });

  it("refuses a listed company with no ticker, because a reader could not reach it", async () => {
    const error = await expectSqlError(upsert({ listingStatus: "listed", symbol: null }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/NGX symbol/i);
  });

  it("refuses a name that reduces to nothing addressable", async () => {
    const error = await expectSqlError(upsert({ name: "!!! ???", slug: null, symbol: null, listingStatus: "pre_listing" }));
    expect(error.code).toBe("23514");
  });

  it("refuses an empty name", async () => {
    const error = await expectSqlError(upsert({ name: "   " }));
    expect(error.code).toBe("23514");
  });
});

describe("the web address cannot carry anything but a slug", () => {
  // A traversal, a scheme or a path segment is normalised away rather than
  // stored, so no stored slug can ever address anything but this one route.
  const attempts = [
    "../../etc/passwd",
    "https://evil.test/x",
    "a/b",
    "Example%2FCement",
    "javascript:alert(1)",
    "..",
    "<script>alert(1)</script>",
  ];

  for (const attempt of attempts) {
    it(`stores nothing dangerous for ${JSON.stringify(attempt)}`, async () => {
      let stored: string | null = null;
      try {
        const id = await upsert({ slug: attempt, listingStatus: "pre_listing", symbol: null });
        stored = (await companyRow(id)).slug;
      } catch (error) {
        // Refusing outright is an equally good outcome.
        expect((error as { code?: string }).code).toBe("23514");
        return;
      }
      expect(stored).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(stored).not.toContain("/");
      expect(stored).not.toContain(":");
      expect(stored).not.toContain(".");
      expect(stored).not.toContain("%");
      expect(stored).not.toContain("<");
    });
  }

  it("refuses a malformed NGX symbol", async () => {
    const error = await expectSqlError(upsert({ symbol: "A B/C" }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/NGX symbol/i);
  });

  it("will not let two companies claim the same current ticker", async () => {
    await upsert({ symbol: "DUPE" });
    const error = await expectSqlError(upsert({ symbol: "DUPE" }));
    expect(error.code).toBe("23505");
  });
});

describe("editing keeps the history", () => {
  it("appends a version carrying the reason, and updates the current row", async () => {
    const id = await upsert({ name: "Original Name Plc", symbol: "ORIG" });

    await upsert({
      companyId: id,
      name: "Renamed Holdings Plc",
      slug: "renamed-holdings",
      symbol: "ORIG",
      reason: "Name changed at the 2026 AGM",
    });

    const company = await companyRow(id);
    expect(company.name).toBe("Renamed Holdings Plc");
    expect(company.slug).toBe("renamed-holdings");

    const history = await versions(id);
    expect(history).toHaveLength(2);
    expect(history[0].name).toBe("Original Name Plc");
    expect(history[1].name).toBe("Renamed Holdings Plc");
    expect(history[1].change_reason).toBe("Name changed at the 2026 AGM");
  });

  it("requires a reason for a change", async () => {
    const id = await upsert({ symbol: "NOREAS" });
    const error = await expectSqlError(upsert({ companyId: id, name: "Something Else Plc", symbol: "NOREAS" }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/why/i);
  });

  it("says so rather than writing an empty version when nothing changed", async () => {
    const id = await upsert({ name: "Unchanged Plc", symbol: "UNCH" });
    const error = await expectSqlError(
      upsert({ companyId: id, name: "Unchanged Plc", slug: "unchanged-plc", symbol: "UNCH", reason: "no-op" }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/nothing changed/i);
    expect(await versions(id)).toHaveLength(1);
  });

  it("closes the old symbol and opens a new one on a rename", async () => {
    const id = await upsert({ name: "Ticker Change Plc", symbol: "OLDSYM" });

    await upsert({
      companyId: id,
      name: "Ticker Change Plc",
      slug: "ticker-change-plc",
      symbol: "NEWSYM",
      reason: "Symbol changed by the exchange",
    });

    expect(await currentSymbol(id)).toBe("NEWSYM");

    const { rows } = await db.query<{ value: string; valid_to: string | null }>(
      `select ii.value, ii.valid_to
         from public.instrument_identifiers ii
         join public.instruments i on i.id = ii.instrument_id
        where i.company_id = $1 and ii.scheme = 'ngx_symbol'
        order by ii.valid_from, ii.value`,
      [id],
    );
    const closed = rows.find((r) => r.value === "OLDSYM");
    expect(closed?.valid_to).not.toBeNull();

    // The old symbol stays in the history against the version that had it.
    const history = await versions(id);
    expect(history[0].ngx_symbol).toBe("OLDSYM");
    expect(history[1].ngx_symbol).toBe("NEWSYM");
  });

  it("records the symbol the company actually carries, not the one passed in", async () => {
    // Omitting the symbol leaves the live identifier in place, so the version
    // must not claim the company had none: the history would then contradict the
    // register it exists to explain.
    const id = await upsert({ name: "Kept Symbol Plc", symbol: "KEPT" });
    await upsert({
      companyId: id,
      name: "Kept Symbol Group Plc",
      slug: "kept-symbol-plc",
      symbol: null,
      listingStatus: "suspended",
      reason: "Trading suspended",
    });

    expect(await currentSymbol(id)).toBe("KEPT");
    const history = await versions(id);
    expect(history[1].ngx_symbol).toBe("KEPT");
  });

  it("refuses to edit a company that does not exist", async () => {
    const error = await expectSqlError(
      upsert({ companyId: "00000000-0000-0000-0000-000000000000", reason: "x" }),
    );
    expect(error.code).toBe("23503");
  });
});

describe("only an analyst or a platform administrator may write a profile", () => {
  it("admits a platform administrator", async () => {
    const id = await upsert({ actor: admin, symbol: "ADMCO" });
    expect((await companyRow(id)).review_status).toBe("pending");
  });

  it("refuses an editor", async () => {
    const error = await expectSqlError(upsert({ actor: editor }));
    expect(error.code).toBe("42501");
  });

  it("refuses a reader", async () => {
    const error = await expectSqlError(upsert({ actor: reader }));
    expect(error.code).toBe("42501");
  });

  it("refuses a signed-in user calling the function directly", async () => {
    const error = await expectSqlError(
      asUser(db, reader, () =>
        db.query("select public.upsert_company_profile($1, 'Smuggled Plc', 'smuggled', 'pre_listing')", [analyst]),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses a signed-in user calling the review function directly", async () => {
    const id = await upsert({ symbol: "DIRECT" });
    const error = await expectSqlError(
      asUser(db, reader, () => db.query("select public.review_company($1, $2, 'approved')", [id, admin])),
    );
    expect(error.code).toBe("42501");
  });
});

describe("the current row changes only through the function that records the version", () => {
  it("refuses a direct update that would leave the history incomplete", async () => {
    const id = await upsert({ symbol: "DIRUPD" });
    const error = await expectSqlError(
      db.query("update public.companies set name = 'Quietly Renamed' where id = $1", [id]),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/upsert_company_profile/);
  });

  it("refuses a direct review_status change", async () => {
    const id = await upsert({ symbol: "DIRREV" });
    const error = await expectSqlError(
      db.query("update public.companies set review_status = 'approved' where id = $1", [id]),
    );
    expect(error.code).toBe("42501");
  });

  it("never deletes a company", async () => {
    const id = await upsert({ symbol: "NODEL" });
    const error = await expectSqlError(db.query("delete from public.companies where id = $1", [id]));
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/delisted/i);
  });
});

describe("the history is append-only", () => {
  it("refuses an update to a version row", async () => {
    const id = await upsert({ symbol: "HISTUP" });
    const error = await expectSqlError(
      db.query("update public.company_profile_versions set name = 'Rewritten' where company_id = $1", [id]),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses a delete of a version row", async () => {
    const id = await upsert({ symbol: "HISTDEL" });
    const error = await expectSqlError(
      db.query("delete from public.company_profile_versions where company_id = $1", [id]),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses to reattribute a version to someone else", async () => {
    const id = await upsert({ symbol: "REATTR" });
    const error = await expectSqlError(
      db.query("update public.company_profile_versions set changed_by = $1 where company_id = $2", [reviewer, id]),
    );
    expect(error.code).toBe("42501");
  });

  it("still lets an account be deleted, anonymising the actor", async () => {
    const leaver = await createUser(db, { staff: ["analyst"] });
    const id = await upsert({ actor: leaver, symbol: "LEAVER" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, leaver]);

    // The lesson from the document review stage: a blanket refusal to update
    // would block the foreign key's own ON DELETE SET NULL and make offboarding
    // impossible.
    await db.query("delete from auth.users where id = $1", [leaver]);

    expect((await versions(id))[0].changed_by).toBeNull();
    expect((await companyRow(id)).reviewed_by).toBeNull();
  });
});

describe("review", () => {
  it("approves a company and the equity instrument with it", async () => {
    const id = await upsert({ symbol: "APPROV" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    expect((await companyRow(id)).review_status).toBe("approved");

    const { rows } = await db.query<{ review_status: string }>(
      "select review_status from public.instruments where company_id = $1",
      [id],
    );
    // A symbol resolving to an unapproved instrument is a company a reader can
    // see but cannot reach.
    expect(rows[0].review_status).toBe("approved");
  });

  it("flags a self-approval without blocking it", async () => {
    const id = await upsert({ actor: analyst, symbol: "SELFAP" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, analyst]);
    expect((await companyRow(id)).review_self_approved).toBe(true);
  });

  it("does not flag a review by someone else", async () => {
    const id = await upsert({ actor: analyst, symbol: "TWOEYE" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    expect((await companyRow(id)).review_self_approved).toBe(false);
  });

  it("blocks a self-approval once two-person review is switched on", async () => {
    await db.query("update public.platform_settings set value = 'true'::jsonb where key = 'review.require_two_person'");
    try {
      const id = await upsert({ actor: analyst, symbol: "TWOREQ" });
      const error = await expectSqlError(
        db.query("select public.review_company($1, $2, 'approved')", [id, analyst]),
      );
      expect(error.code).toBe("42501");

      // Someone else still can.
      await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
      expect((await companyRow(id)).review_status).toBe("approved");
    } finally {
      await db.query(
        "update public.platform_settings set value = 'false'::jsonb where key = 'review.require_two_person'",
      );
    }
  });

  it("requires a reason to reject", async () => {
    const id = await upsert({ symbol: "REJNOR" });
    const error = await expectSqlError(db.query("select public.review_company($1, $2, 'rejected')", [id, reviewer]));
    expect(error.code).toBe("23514");
  });

  it("records a rejection with its reason", async () => {
    const id = await upsert({ symbol: "REJECT" });
    await db.query("select public.review_company($1, $2, 'rejected', 'Not an NGX issuer')", [id, reviewer]);
    expect((await companyRow(id)).review_status).toBe("rejected");
  });

  it("refuses an invented decision", async () => {
    const id = await upsert({ symbol: "BADDEC" });
    const error = await expectSqlError(
      db.query("select public.review_company($1, $2, 'approved_quietly')", [id, reviewer]),
    );
    expect(error.code).toBe("23514");
  });

  it("refuses to approve what is already approved", async () => {
    const id = await upsert({ symbol: "TWICE" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    const error = await expectSqlError(db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]));
    expect(error.code).toBe("23514");
  });

  it("refuses to review a company that does not exist", async () => {
    const error = await expectSqlError(
      db.query("select public.review_company('00000000-0000-0000-0000-000000000000', $1, 'approved')", [reviewer]),
    );
    expect(error.code).toBe("23503");
  });
});

describe("a review states which version of the profile was read", () => {
  it("records the reviewed version, so a later edit cannot claim it was cleared", async () => {
    const id = await upsert({ name: "Drifting Plc", symbol: "DRIFT" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    const cleared = await companyRow(id);
    expect(cleared.reviewed_version).toBe(1);
    expect(cleared.reviewed_by).toBe(reviewer);

    await upsert({ companyId: id, name: "Drifting Group Plc", symbol: "DRIFT", reason: "Renamed" });

    // Still visible to readers, which is the point of not resetting the status —
    // a typo fix must not delist a company. But the row no longer claims the
    // reviewer saw this content: the reviewed version is now behind.
    const edited = await companyRow(id);
    expect(edited.review_status).toBe("approved");
    expect(edited.reviewed_version).toBe(1);
    expect(await versions(id)).toHaveLength(2);
  });

  it("lets an edited profile be cleared again, so two-person review still bites", async () => {
    const id = await upsert({ actor: analyst, name: "Recleared Plc", symbol: "RECLR" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    await upsert({ companyId: id, actor: analyst, name: "Recleared Group Plc", symbol: "RECLR", reason: "Renamed" });

    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    expect((await companyRow(id)).reviewed_version).toBe(2);
  });

  it("refuses a re-approval when nothing has changed since the last one", async () => {
    const id = await upsert({ symbol: "NOCHNG" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    const error = await expectSqlError(db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/nothing has changed/i);
  });
});

describe("the server can call what it needs to call", () => {
  // The harness runs as the migration owner and only ever switches to
  // `authenticated`, so a function revoked from PUBLIC without being granted
  // back to service_role passes every other test and then fails in production
  // with 42501. This reads the grants the application actually depends on,
  // discovered from the code rather than from a list kept by hand.
  it("grants service_role execute on every function the application calls", async () => {
    const sources = [
      ...globSync("app/**/*.{ts,tsx}", { cwd: REPO_ROOT }),
      ...globSync("lib/**/*.ts", { cwd: REPO_ROOT }),
    ];

    // The receiver matters: `admin.rpc(...)` goes through createAdminClient and
    // runs as service_role, while `supabase.rpc(...)` is the signed-in user's own
    // client and runs as authenticated. A function needs the grant for the client
    // that actually calls it, and only that one.
    const called = new Map<string, "service_role" | "authenticated">();
    for (const file of sources) {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      for (const match of text.matchAll(/\b(\w+)\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g)) {
        const [, receiver, name] = match;
        const role = receiver === "admin" ? "service_role" : "authenticated";
        // A function called both ways needs the server grant, which is stricter.
        if (role === "service_role" || !called.has(name)) called.set(name, role);
      }
    }

    // Guards against the regex silently matching nothing and the test passing
    // vacuously once the desks are wired up in 3a.2.
    const { rows: defined } = await db.query<{ proname: string }>(
      `select distinct p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef`,
    );
    const definedNames = new Set(defined.map((r) => r.proname));

    expect(called.size, "found no .rpc() call sites at all — the scan is not working").toBeGreaterThan(0);

    for (const [name, role] of called) {
      expect(definedNames, `${name} is called with .rpc() but no such security-definer function exists`).toContain(name);

      const { rows } = await db.query<{ granted: boolean }>(
        `select has_function_privilege($2, p.oid, 'EXECUTE') as granted
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name, role],
      );
      expect(rows.length, `${name} is called with .rpc() but is not defined in public`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.granted, `${role} cannot execute ${name}; the caller would get 42501`).toBe(true);
      }
    }
  });

  it("lets service_role write and review a profile end to end", async () => {
    await db.exec("set role service_role");
    try {
      const { rows } = await db.query<{ id: string }>(
        `select public.upsert_company_profile($1, 'Service Role Plc', 'service-role-plc', 'listed',
                 null, null, null, null, null, null, null, 'SVCRL', null) as id`,
        [analyst],
      );
      const id = rows[0].id;
      await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
      await db.exec("reset role");
      expect((await companyRow(id)).review_status).toBe("approved");
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("what a reader may see", () => {
  it("shows approved companies and hides pending ones", async () => {
    const approved = await upsert({ name: "Visible Plc", symbol: "VISIB" });
    await db.query("select public.review_company($1, $2, 'approved')", [approved, reviewer]);
    const pending = await upsert({ name: "Hidden Plc", symbol: "HIDDN" });

    const visible = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ id: string }>("select id from public.companies where id = any($1)", [
        [approved, pending],
      ]);
      return rows.map((r) => r.id);
    });

    expect(visible).toContain(approved);
    expect(visible).not.toContain(pending);
  });

  it("keeps the profile history to the desk", async () => {
    const id = await upsert({ symbol: "HISTRL" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    const asReader = await asUser(db, reader, async () => {
      const { rows } = await db.query("select version from public.company_profile_versions where company_id = $1", [id]);
      return rows.length;
    });
    expect(asReader).toBe(0);

    const asStaff = await asUser(db, analyst, async () => {
      const { rows } = await db.query("select version from public.company_profile_versions where company_id = $1", [id]);
      return rows.length;
    });
    expect(asStaff).toBeGreaterThan(0);
  });

  it("gives no client any way to write a company or its history", async () => {
    await asUser(db, analyst, async () => {
      const insertCompany = await expectSqlError(
        db.query("insert into public.companies (name, slug, listing_status) values ('Forged Plc', 'forged', 'listed')"),
      );
      expect(insertCompany.code).toBe("42501");

      const insertVersion = await expectSqlError(
        db.query(
          `insert into public.company_profile_versions (company_id, version, name, slug, listing_status)
             values (gen_random_uuid(), 1, 'Forged', 'forged', 'listed')`,
        ),
      );
      expect(insertVersion.code).toBe("42501");
    });
  });
});

describe("an address a reader already has keeps working", () => {
  async function formerSlugResolves(former: string): Promise<string | null> {
    const { rows } = await db.query<{ slug: string | null }>(
      "select public.company_slug_for_former_slug($1) as slug",
      [former],
    );
    return rows[0]?.slug ?? null;
  }

  it("sends an old address to the company's current one", async () => {
    const id = await upsert({ name: "Renaming Plc", slug: "renaming-plc", symbol: "RENAM" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    await upsert({
      companyId: id,
      name: "Renaming Group Plc",
      slug: "renaming-group",
      symbol: "RENAM",
      reason: "Renamed at the AGM",
    });

    expect(await formerSlugResolves("renaming-plc")).toBe("renaming-group");
  });

  it("follows a chain of renames to the latest address", async () => {
    const id = await upsert({ name: "Chain One Plc", slug: "chain-one", symbol: "CHAIN" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    await upsert({ companyId: id, name: "Chain Two Plc", slug: "chain-two", symbol: "CHAIN", reason: "First" });
    await upsert({ companyId: id, name: "Chain Three Plc", slug: "chain-three", symbol: "CHAIN", reason: "Second" });

    expect(await formerSlugResolves("chain-one")).toBe("chain-three");
    expect(await formerSlugResolves("chain-two")).toBe("chain-three");
  });

  it("says nothing for the address the company still uses", async () => {
    const id = await upsert({ name: "Still Here Plc", slug: "still-here", symbol: "STILL" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    // The page is served directly, so there is nothing to redirect to.
    expect(await formerSlugResolves("still-here")).toBeNull();
  });

  it("says nothing for an address nobody ever had", async () => {
    expect(await formerSlugResolves("never-existed-at-all")).toBeNull();
  });

  it("will not reveal a company that is not approved", async () => {
    // A pending or rejected company is invisible to readers, and a redirect that
    // resolved would confirm it exists and name it.
    const pending = await upsert({ name: "Hidden Rename Plc", slug: "hidden-one", symbol: "HID1" });
    await upsert({
      companyId: pending,
      name: "Hidden Rename Plc",
      slug: "hidden-two",
      symbol: "HID1",
      reason: "Renamed while still pending",
    });
    expect(await formerSlugResolves("hidden-one")).toBeNull();

    const rejected = await upsert({ name: "Rejected Rename Plc", slug: "rejected-one", symbol: "REJ1" });
    await upsert({
      companyId: rejected,
      name: "Rejected Rename Plc",
      slug: "rejected-two",
      symbol: "REJ1",
      reason: "Renamed",
    });
    await db.query("select public.review_company($1, $2, 'rejected', 'Not an issuer')", [rejected, reviewer]);
    expect(await formerSlugResolves("rejected-one")).toBeNull();
  });

  it("is answerable by an ordinary reader, since the history itself is not", async () => {
    const id = await upsert({ name: "Reader Redirect Plc", slug: "reader-one", symbol: "RDR1" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    await upsert({
      companyId: id,
      name: "Reader Redirect Plc",
      slug: "reader-two",
      symbol: "RDR1",
      reason: "Renamed",
    });

    const asReader = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ slug: string | null }>(
        "select public.company_slug_for_former_slug('reader-one') as slug",
      );
      return rows[0]?.slug ?? null;
    });
    expect(asReader).toBe("reader-two");

    // And the table behind it stays closed to them.
    const historyRows = await asUser(db, reader, async () => {
      const { rows } = await db.query("select slug from public.company_profile_versions where company_id = $1", [id]);
      return rows.length;
    });
    expect(historyRows).toBe(0);
  });
});

describe("what the desk can see", () => {
  // The registry desk reads through the analyst's own session, so row-level
  // security decides what the queue contains. Every other test here calls the
  // functions as the migration owner, where no policy applies — which is exactly
  // how an empty desk would have shipped unnoticed.
  it("shows an analyst the companies waiting to be reviewed", async () => {
    const pending = await upsert({ name: "Desk Pending Plc", symbol: "DSKP" });
    const rejected = await upsert({ name: "Desk Rejected Plc", symbol: "DSKR" });
    await db.query("select public.review_company($1, $2, 'rejected', 'Not an issuer')", [rejected, reviewer]);

    const seen = await asUser(db, analyst, async () => {
      const { rows } = await db.query<{ id: string }>("select id from public.companies where id = any($1)", [
        [pending, rejected],
      ]);
      return rows.map((r) => r.id);
    });

    // Without this an analyst's review queue is always empty, and following an
    // edit link to a pending company yields nothing — while the write functions
    // would happily let them act on it.
    expect(seen).toContain(pending);
    expect(seen).toContain(rejected);
  });

  it("shows an analyst a pending company's ticker, so the desk can display it", async () => {
    const pending = await upsert({ name: "Desk Ticker Plc", symbol: "DSKT" });

    const symbols = await asUser(db, analyst, async () => {
      const { rows } = await db.query<{ value: string }>(
        `select ii.value from public.instrument_identifiers ii
           join public.instruments i on i.id = ii.instrument_id
          where i.company_id = $1`,
        [pending],
      );
      return rows.map((r) => r.value);
    });
    expect(symbols).toContain("DSKT");
  });

  it("still shows a plain reader nothing unapproved", async () => {
    const pending = await upsert({ name: "Reader Blind Plc", symbol: "RDRB" });

    const seen = await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.companies where id = $1", [pending]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });

  it("shows an editor nothing unapproved either, since they do not run this desk", async () => {
    const pending = await upsert({ name: "Editor Blind Plc", symbol: "EDTB" });

    const seen = await asUser(db, editor, async () => {
      const { rows } = await db.query("select id from public.companies where id = $1", [pending]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });
});

describe("the listing board is reference text until the board list is confirmed", () => {
  it("accepts the three current NGX boards", async () => {
    for (const board of ["Premium Board", "Main Board", "Growth Board"]) {
      const id = await upsert({ listingBoard: board });
      expect((await companyRow(id)).listing_board).toBe(board);
    }
  });

  it("still accepts ASeM, which real history needs", async () => {
    // NGX wound ASeM down with effect from 1 July 2025. A company delisted
    // before that was on it, and an enumeration of today's boards would refuse
    // to record the truth.
    const id = await upsert({ listingBoard: "ASeM", listingStatus: "delisted", symbol: null });
    expect((await companyRow(id)).listing_board).toBe("ASeM");
  });

  it("leaves the board empty when none is given", async () => {
    const id = await upsert({ listingBoard: null });
    expect((await companyRow(id)).listing_board).toBeNull();
  });

  it("refuses something too long to be a board name", async () => {
    const error = await expectSqlError(upsert({ listingBoard: "x".repeat(61) }));
    expect(error.code).toBe("23514");
  });
});

describe("the audit log", () => {
  it("records creation, change and review", async () => {
    const id = await upsert({ name: "Audited Plc", symbol: "AUDIT" });
    await upsert({ companyId: id, name: "Audited Group Plc", symbol: "AUDIT", reason: "Group restructure" });
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    const { rows } = await db.query<{ action: string }>(
      `select action from public.audit_logs
        where details ->> 'company_id' = $1 order by created_at, action`,
      [id],
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("company.created");
    expect(actions).toContain("company.profile_changed");
    expect(actions).toContain("company.approved");
  });
});
