import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError } from "./db";

/**
 * Attacks on the company registry, each asserting a refusal rather than a
 * behaviour. Written against the defences stage 3a.1 claims: service_role-only
 * writes, security-definer functions revoked from every client role, a role check
 * admitting only analysts and platform administrators, append-only history, and
 * constraints that make a slug, a symbol and a website unable to carry anything
 * dangerous.
 *
 * An analyst editing an approved company in place is an intended capability and
 * is not attacked here.
 */

let db: PGlite;
let analyst: string;
let reviewer: string;
let reader: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  reviewer = await createUser(db, { staff: ["analyst"] });
  reader = await createUser(db);
}, 180_000);

let counter = 0;

async function createCompany(
  opts: { actor?: string; symbol?: string | null; slug?: string | null; listingStatus?: string } = {},
) {
  counter += 1;
  // A listed company must carry a symbol, so a case that deliberately passes no
  // symbol has to say it is pre-listing — otherwise every such attempt fails on
  // the symbol rule and the thing under test is never reached.
  const listingStatus = opts.listingStatus ?? (opts.symbol === null ? "pre_listing" : "listed");
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_profile(
       $1, $2, $3, $5, null, null, null, null, null, null, null, $4, null
     ) as id`,
    [
      opts.actor ?? analyst,
      `Attack Target ${counter} Plc`,
      opts.slug ?? `attack-target-${counter}`,
      opts.symbol === undefined ? `ATK${counter}` : opts.symbol,
      listingStatus,
    ],
  );
  return rows[0].id;
}

describe("1. privilege escalation", () => {
  // Every staff role that is not an analyst, plus a plain reader.
  for (const role of ["editor", "fact_checker", "publisher"] as const) {
    it(`refuses a ${role} writing a profile`, async () => {
      const actor = await createUser(db, { staff: [role] });
      const error = await expectSqlError(createCompany({ actor }));
      expect(error.code).toBe("42501");
    });

    it(`refuses a ${role} reviewing a profile`, async () => {
      const actor = await createUser(db, { staff: [role] });
      const id = await createCompany();
      const error = await expectSqlError(
        db.query("select public.review_company($1, $2, 'approved')", [id, actor]),
      );
      expect(error.code).toBe("42501");
    });
  }

  it("refuses a reader writing or reviewing", async () => {
    const id = await createCompany();
    expect((await expectSqlError(createCompany({ actor: reader }))).code).toBe("42501");
    expect(
      (await expectSqlError(db.query("select public.review_company($1, $2, 'approved')", [id, reader]))).code,
    ).toBe("42501");
  });

  it("gives no client role a way to reach either function at all", async () => {
    for (const who of [reader, analyst]) {
      const error = await expectSqlError(
        asUser(db, who, () =>
          db.query(
            `select public.upsert_company_profile($1, 'Escalated Plc', 'escalated', 'pre_listing',
                      null, null, null, null, null, null, null, null, null)`,
            [analyst],
          ),
        ),
      );
      // Either the EXECUTE revoke or the role check — both are refusals.
      expect(error.code).toBe("42501");
    }
  });

  it("will not let a client set the guard's session flag and then write", async () => {
    // The informative case: the flag is developer discipline, not a control. What
    // actually holds is that `authenticated` has no write grant on the table.
    const id = await createCompany();
    const error = await expectSqlError(
      asUser(db, analyst, async () => {
        await db.query("select set_config('sfi.company_write', '1', true)");
        return db.query("update public.companies set name = 'Owned' where id = $1", [id]);
      }),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses a direct write to the review fields", async () => {
    const id = await createCompany();
    // Reviewed first, so each of these is a real change rather than a no-op
    // update, which the guard has no reason to refuse.
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    for (const column of [
      "review_status = 'pending'",
      "review_status = 'rejected'",
      // The reviewer's account still exists, so blanking the attribution is not
      // the foreign key's referential action and must be refused.
      "reviewed_by = null",
      "reviewed_version = 99",
      // Already false after a review by someone else, so `= true` is the change
      // that would actually misrepresent the record.
      "review_self_approved = true",
    ]) {
      const error = await expectSqlError(
        db.query(`update public.companies set ${column} where id = $1`, [id]),
      );
      expect(error.code, `direct write "${column}" was allowed`).toBe("42501");
    }
  });

  it("refuses a forged history row from a client", async () => {
    const id = await createCompany();
    const error = await expectSqlError(
      asUser(db, analyst, () =>
        db.query(
          `insert into public.company_profile_versions
             (company_id, version, name, slug, listing_status, changed_by)
           values ($1, 99, 'Forged', 'forged', 'listed', $2)`,
          [id, reviewer],
        ),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("still blocks a self-approval with two-person review on, whatever the route", async () => {
    await db.query("update public.platform_settings set value = 'true'::jsonb where key = 'review.require_two_person'");
    try {
      const id = await createCompany({ actor: analyst });
      const error = await expectSqlError(
        db.query("select public.review_company($1, $2, 'approved')", [id, analyst]),
      );
      expect(error.code).toBe("42501");
    } finally {
      await db.query(
        "update public.platform_settings set value = 'false'::jsonb where key = 'review.require_two_person'",
      );
    }
  });
});

describe("2. injection", () => {
  const payloads = [
    "'); drop table public.companies; --",
    "x'; update public.companies set review_status='approved'; --",
    "$$; raise exception 'pwned'; --",
    "'||(select string_agg(email, ',') from auth.users)||'",
    "\\'; select 1; --",
  ];

  for (const payload of payloads) {
    it(`survives ${JSON.stringify(payload.slice(0, 28))} in every text parameter`, async () => {
      counter += 1;
      // Every one of these is a value, never an identifier, and nothing in the
      // migration builds SQL as a string. A payload either stores verbatim as
      // inert text or is refused by a constraint.
      const attempt = db.query(
        `select public.upsert_company_profile(
           $1, $2, $3, 'pre_listing', null, $2, $4, $2, $2, $5, $6, null, null
         ) as id`,
        [
          analyst,
          payload,
          `injection-${counter}`,
          payload, // p_sector_id — a foreign key
          `https://example.test/${encodeURIComponent(payload)}`,
          payload.slice(0, 60), // p_listing_board — length-bounded
        ],
      );

      let failed: { code?: string } | null = null;
      try {
        await attempt;
      } catch (error) {
        failed = error as { code?: string };
      }

      // A foreign-key refusal on the sector is the expected outcome; what matters
      // is that nothing executed.
      if (failed) expect(["23503", "23514"]).toContain(failed.code);

      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'companies'",
      );
      expect(rows[0].n).toBe(1);
    });
  }

  it("refuses an invented listing status rather than storing it", async () => {
    counter += 1;
    const error = await expectSqlError(
      db.query(
        `select public.upsert_company_profile($1, 'Status Plc', $2, 'approved', null, null, null, null, null, null, null, null, null)`,
        [analyst, `status-${counter}`],
      ),
    );
    // 'approved' is not a listing status; the CHECK refuses it.
    expect(error.code).toBe("23514");
  });
});

describe("3. stored XSS and redirects", () => {
  const badUrls = [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "//evil.test/x",
    " javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    // A newline before the scheme: Postgres `~` is not newline-sensitive by
    // default, so `^` must still mean start-of-string, not start-of-line.
    "\njavascript:alert(1)",
    "\nhttps://ok.test",
    "java\nscript:alert(1)",
  ];

  for (const url of badUrls) {
    it(`refuses ${JSON.stringify(url)} as a website`, async () => {
      counter += 1;
      const error = await expectSqlError(
        db.query(
          `select public.upsert_company_profile($1, 'Site Plc', $2, 'pre_listing',
                    null, null, null, null, null, $3, null, null, null)`,
          [analyst, `site-${counter}`, url],
        ),
      );
      expect(error.code).toBe("23514");
    });
  }

  it("stores a website only when it carries an http scheme at the very start", async () => {
    counter += 1;
    const { rows } = await db.query<{ id: string }>(
      `select public.upsert_company_profile($1, 'Good Site Plc', $2, 'pre_listing',
                null, null, null, null, null, 'https://issuer.test/ir', null, null, null) as id`,
      [analyst, `good-site-${counter}`],
    );
    const { rows: stored } = await db.query<{ website: string }>(
      "select website from public.companies where id = $1",
      [rows[0].id],
    );
    expect(stored[0].website).toBe("https://issuer.test/ir");
  });

  it("cannot be made to store a slug that escapes the company route", async () => {
    const escapes = [
      "../../admin",
      "..%2f..%2fadmin",
      "a/../../b",
      "x?y=1",
      "x#y",
      "x%00y",
      "//evil.test",
      "http://evil.test",
    ];
    let asserted = 0;
    for (const attempt of escapes) {
      counter += 1;
      let stored: string | null = null;
      try {
        const id = await createCompany({ slug: attempt, symbol: null });
        const { rows } = await db.query<{ slug: string }>("select slug from public.companies where id = $1", [id]);
        stored = rows[0].slug;
      } catch (error) {
        expect(["23514", "23505"]).toContain((error as { code?: string }).code);
        asserted += 1;
        continue;
      }
      expect(stored).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(stored).not.toMatch(/[/:?#%.]/);
      asserted += 1;
    }
    // Without this the loop could skip every case and still pass.
    expect(asserted).toBe(escapes.length);
  });

  it("keeps markup inert in a name, description and board, because nothing renders them as markup", async () => {
    counter += 1;
    const markup = "<img src=x onerror=alert(1)>";
    const { rows } = await db.query<{ id: string }>(
      `select public.upsert_company_profile($1, $2, $3, 'pre_listing',
                null, null, null, null, $2, null, 'Main Board', null, null) as id`,
      [analyst, markup, `markup-${counter}`],
    );
    const { rows: stored } = await db.query<{ name: string; slug: string }>(
      "select name, slug from public.companies where id = $1",
      [rows[0].id],
    );
    // Stored verbatim as text. React escapes it on render; the slug, which is the
    // only one of these that reaches a URL, is constrained separately.
    expect(stored[0].name).toBe(markup);
    expect(stored[0].slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("4. integrity", () => {
  it("refuses to rewrite or delete history, by any route", async () => {
    const id = await createCompany();

    for (const statement of [
      "update public.company_profile_versions set name = 'Rewritten' where company_id = $1",
      "update public.company_profile_versions set slug = 'rewritten' where company_id = $1",
      "update public.company_profile_versions set version = 99 where company_id = $1",
      "delete from public.company_profile_versions where company_id = $1",
    ]) {
      const error = await expectSqlError(db.query(statement, [id]));
      expect(error.code).toBe("42501");
    }
  });

  it("will not let one company take another's live ticker", async () => {
    await createCompany({ symbol: "HIJACK" });
    const error = await expectSqlError(createCompany({ symbol: "HIJACK" }));
    expect(error.code).toBe("23505");
  });

  it("will not let two companies share a web address", async () => {
    await createCompany({ slug: "shared-address" });
    const error = await expectSqlError(createCompany({ slug: "shared-address" }));
    expect(error.code).toBe("23505");
  });

  it("hides a pending and a rejected company from a reader", async () => {
    const pending = await createCompany();
    const rejected = await createCompany();
    await db.query("select public.review_company($1, $2, 'rejected', 'Not an issuer')", [rejected, reviewer]);

    const seen = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ id: string }>("select id from public.companies where id = any($1)", [
        [pending, rejected],
      ]);
      return rows.map((r) => r.id);
    });
    expect(seen).toEqual([]);
  });

  it("hides a rejected company's instrument and ticker from a reader", async () => {
    const id = await createCompany({ symbol: "REJSYM" });
    await db.query("select public.review_company($1, $2, 'rejected', 'Not an issuer')", [id, reviewer]);

    const seen = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ value: string }>(
        `select ii.value from public.instrument_identifiers ii
           join public.instruments i on i.id = ii.instrument_id
          where i.company_id = $1`,
        [id],
      );
      return rows.map((r) => r.value);
    });
    expect(seen).toEqual([]);
  });

  it("keeps the history unreadable by a reader even when the company is public", async () => {
    const id = await createCompany();
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    const count = await asUser(db, reader, async () => {
      const { rows } = await db.query("select * from public.company_profile_versions where company_id = $1", [id]);
      return rows.length;
    });
    expect(count).toBe(0);
  });
});

describe("5. the widened desk visibility gives nothing away", () => {
  // 202611210002 admits has_staff_role(['analyst']) to every company, identifier
  // and instrument, so the registry desk can work its own queue. Anyone who is
  // not an analyst must be exactly as blind as before.
  for (const role of ["editor", "fact_checker", "publisher"] as const) {
    it(`gives a ${role} no sight of an unapproved company`, async () => {
      const actor = await createUser(db, { staff: [role] });
      const pending = await createCompany();

      const seen = await asUser(db, actor, async () => {
        const company = await db.query("select id from public.companies where id = $1", [pending]);
        const identifiers = await db.query(
          `select ii.value from public.instrument_identifiers ii
             join public.instruments i on i.id = ii.instrument_id
            where i.company_id = $1`,
          [pending],
        );
        const instruments = await db.query("select id from public.instruments where company_id = $1", [pending]);
        const companyIdentifiers = await db.query(
          "select id from public.company_identifiers where company_id = $1",
          [pending],
        );
        // The one this originally missed. The 3a.1 policy admitted
        // is_platform_staff(), which is any staff row at all, so an editor could
        // read a pending company's name, description and symbol out of its
        // history while being unable to see the company row itself.
        const history = await db.query(
          "select name, description, ngx_symbol from public.company_profile_versions where company_id = $1",
          [pending],
        );
        return (
          company.rows.length +
          identifiers.rows.length +
          instruments.rows.length +
          companyIdentifiers.rows.length +
          history.rows.length
        );
      });
      expect(seen).toBe(0);
    });
  }

  it("still shows an analyst the history, which is their working record", async () => {
    const analystActor = await createUser(db, { staff: ["analyst"] });
    const pending = await createCompany();

    const rows = await asUser(db, analystActor, async () => {
      const { rows } = await db.query("select version from public.company_profile_versions where company_id = $1", [
        pending,
      ]);
      return rows.length;
    });
    expect(rows).toBeGreaterThan(0);
  });

  it("gives a plain reader no sight of one either", async () => {
    const pending = await createCompany();
    const seen = await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.companies where id = $1", [pending]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });

  it("still gives nobody a way to write, however much they can read", async () => {
    const analystActor = await createUser(db, { staff: ["analyst"] });
    const approved = await createCompany();
    await db.query("select public.review_company($1, $2, 'approved')", [approved, reviewer]);

    await asUser(db, analystActor, async () => {
      const update = await expectSqlError(
        db.query("update public.companies set name = 'Owned' where id = $1", [approved]),
      );
      expect(update.code).toBe("42501");

      const insert = await expectSqlError(
        db.query("insert into public.companies (name, slug, listing_status) values ('X', 'x-co', 'listed')"),
      );
      expect(insert.code).toBe("42501");

      const identifier = await expectSqlError(
        db.query(
          "insert into public.instrument_identifiers (instrument_id, scheme, value) values (gen_random_uuid(), 'ngx_symbol', 'OWNED')",
        ),
      );
      expect(identifier.code).toBe("42501");
    });
  });
});

describe("6. the redirect chain cannot loop or leave the site", () => {
  it("never returns the address it was asked about", async () => {
    const id = await createCompany();
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    const { rows } = await db.query<{ slug: string }>("select slug from public.companies where id = $1", [id]);
    const current = rows[0].slug;

    const { rows: resolved } = await db.query<{ slug: string | null }>(
      "select public.company_slug_for_former_slug($1) as slug",
      [current],
    );
    // If it ever returned its own input the page would redirect to itself for ever.
    expect(resolved[0].slug).toBeNull();
  });

  it("always resolves to an address that serves a page directly", async () => {
    const id = await createCompany();
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
    const { rows: before } = await db.query<{ slug: string }>("select slug from public.companies where id = $1", [id]);
    const former = before[0].slug;

    counter += 1;
    const renamed = `redirect-target-${counter}`;
    await db.query(
      `select public.upsert_company_profile(
         $1, 'Redirect Target Plc', $2, 'pre_listing', $3, null, null, null, null, null, null, null, 'Renamed'
       )`,
      [analyst, renamed, id],
    );

    const { rows: hop } = await db.query<{ slug: string | null }>(
      "select public.company_slug_for_former_slug($1) as slug",
      [former],
    );
    expect(hop[0].slug).toBe(renamed);

    // The destination is an approved company's current address, so the next
    // request is served rather than redirected again — one hop, never a chain.
    const { rows: lands } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.companies where slug = $1 and review_status = 'approved'",
      [renamed],
    );
    expect(lands[0].n).toBe(1);

    const { rows: again } = await db.query<{ slug: string | null }>(
      "select public.company_slug_for_former_slug($1) as slug",
      [renamed],
    );
    expect(again[0].slug).toBeNull();
  });

  it("can only ever name an address that is inert in a URL", async () => {
    // Whatever the history holds, the function returns companies.slug, which
    // carries the slug CHECK. There is no column it could return that an
    // attacker controls freely.
    const { rows } = await db.query<{ slug: string }>("select slug from public.companies");
    for (const row of rows) {
      expect(row.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("7. offboarding stays possible", () => {
  it("deletes a staff account that wrote and reviewed profiles", async () => {
    const leaver = await createUser(db, { staff: ["analyst"] });
    const first = await createCompany({ actor: leaver });
    const second = await createCompany({ actor: leaver });
    await db.query("select public.review_company($1, $2, 'approved')", [first, leaver]);
    await db.query("select public.review_company($1, $2, 'rejected', 'withdrawn application')", [second, leaver]);

    // A guard that refused every update would block the foreign keys' own
    // ON DELETE SET NULL and make a person impossible to remove.
    await db.query("delete from auth.users where id = $1", [leaver]);

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.company_profile_versions where changed_by is not null and company_id = any($1)",
      [[first, second]],
    );
    expect(rows[0].n).toBe(0);
  });

  it("does not claim independent review once the editor's account is gone", async () => {
    // The stage 2c lesson: deriving "someone else reviewed this" from a null
    // actor asserts a second pair of eyes nobody can show. Unknown authorship
    // must count as self-reviewed, not as independently reviewed.
    const leaver = await createUser(db, { staff: ["analyst"] });
    const id = await createCompany({ actor: leaver });
    await db.query("delete from auth.users where id = $1", [leaver]);

    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);

    const { rows } = await db.query<{ review_self_approved: boolean }>(
      "select review_self_approved from public.companies where id = $1",
      [id],
    );
    expect(rows[0].review_self_approved).toBe(true);
  });
});
