import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError } from "./db";

/**
 * Staff roles are held apart from platform administration on purpose: an editor
 * must be able to write and review without gaining control of licence terms,
 * dataset activation or admin grants.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
}, 180_000);

async function roleOf(userId: string): Promise<string[]> {
  const { rows } = await db.query<{ role: string }>(
    "select role from public.platform_staff where user_id = $1 order by role",
    [userId],
  );
  return rows.map((r) => r.role);
}

describe("staff roles are distinct from administration", () => {
  it("does not make an editor a platform administrator", async () => {
    const editor = await createUser(db, { staff: ["editor"] });

    const [isStaff, isAdmin] = await asUser(db, editor, async () => {
      const staff = await db.query<{ v: boolean }>("select public.is_platform_staff() as v");
      const admin = await db.query<{ v: boolean }>("select public.is_platform_admin() as v");
      return [staff.rows[0].v, admin.rows[0].v];
    });

    expect(isStaff).toBe(true);
    expect(isAdmin).toBe(false);
  });

  it("does not make a platform administrator staff", async () => {
    const admin = await createUser(db, { admin: true });

    const isStaff = await asUser(db, admin, async () => {
      const { rows } = await db.query<{ v: boolean }>("select public.is_platform_staff() as v");
      return rows[0].v;
    });

    expect(isStaff).toBe(false);
  });

  it("lets one person hold several roles", async () => {
    const user = await createUser(db, { staff: ["analyst", "fact_checker"] });
    expect(await roleOf(user)).toEqual(["analyst", "fact_checker"]);

    const matches = await asUser(db, user, async () => {
      const { rows } = await db.query<{ a: boolean; b: boolean }>(
        "select public.has_staff_role(array['fact_checker']) as a, public.has_staff_role(array['publisher']) as b",
      );
      return rows[0];
    });

    expect(matches.a).toBe(true);
    expect(matches.b).toBe(false);
  });

  it("rejects a role outside the allowed set", async () => {
    const user = await createUser(db);
    const error = await expectSqlError(
      db.query("insert into public.platform_staff (user_id, role) values ($1, 'superuser')", [user]),
    );
    expect(error.code).toBe("23514");
  });
});

describe("roles are granted only through the trusted function", () => {
  it("refuses a direct write from a signed-in user", async () => {
    const user = await createUser(db);
    const error = await asUser(db, user, () =>
      expectSqlError(db.query("insert into public.platform_staff (user_id, role) values ($1, 'editor')", [user])),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses a direct write from a platform administrator's session", async () => {
    const admin = await createUser(db, { admin: true });
    const error = await asUser(db, admin, () =>
      expectSqlError(db.query("insert into public.platform_staff (user_id, role) values ($1, 'publisher')", [admin])),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses to grant when the actor is not an administrator", async () => {
    const actor = await createUser(db);
    const target = await createUser(db);
    const error = await expectSqlError(
      db.query("select public.set_platform_staff_role($1, $2, 'editor', true)", [target, actor]),
    );
    expect(error.code).toBe("42501");
  });

  it("grants, revokes and records both in the audit log", async () => {
    const admin = await createUser(db, { admin: true });
    const target = await createUser(db);

    await db.query("select public.set_platform_staff_role($1, $2, 'editor', true)", [target, admin]);
    expect(await roleOf(target)).toEqual(["editor"]);

    await db.query("select public.set_platform_staff_role($1, $2, 'editor', false)", [target, admin]);
    expect(await roleOf(target)).toEqual([]);

    const { rows } = await db.query<{ action: string; details: { role: string } }>(
      "select action, details from public.audit_logs where subject_user_id = $1 order by created_at",
      [target],
    );
    expect(rows.map((r) => r.action)).toEqual(["access.staff_role.granted", "access.staff_role.revoked"]);
    expect(rows[0].details.role).toBe("editor");
  });

  it("does not log a grant that changed nothing", async () => {
    const admin = await createUser(db, { admin: true });
    const target = await createUser(db);

    await db.query("select public.set_platform_staff_role($1, $2, 'analyst', true)", [target, admin]);
    await db.query("select public.set_platform_staff_role($1, $2, 'analyst', true)", [target, admin]);

    const { rows } = await db.query<{ n: string }>(
      "select count(*) as n from public.audit_logs where subject_user_id = $1",
      [target],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("rejects an unknown role even from an administrator", async () => {
    const admin = await createUser(db, { admin: true });
    const target = await createUser(db);
    const error = await expectSqlError(
      db.query("select public.set_platform_staff_role($1, $2, 'superuser', true)", [target, admin]),
    );
    expect(error.code).toBe("22023");
  });
});

describe("the roster is not readable by everyone", () => {
  it("shows a person only their own roles", async () => {
    const editor = await createUser(db, { staff: ["editor"] });
    const other = await createUser(db, { staff: ["publisher"] });

    const visible = await asUser(db, editor, async () => {
      const { rows } = await db.query<{ user_id: string }>("select user_id from public.platform_staff");
      return rows.map((r) => r.user_id);
    });

    expect(visible).toEqual([editor]);
    expect(visible).not.toContain(other);
  });

  it("shows an administrator the whole roster", async () => {
    const admin = await createUser(db, { admin: true });
    await createUser(db, { staff: ["editor"] });

    const count = await asUser(db, admin, async () => {
      const { rows } = await db.query<{ n: string }>("select count(*) as n from public.platform_staff");
      return Number(rows[0].n);
    });

    const { rows } = await db.query<{ n: string }>("select count(*) as n from public.platform_staff");
    expect(count).toBe(Number(rows[0].n));
    expect(count).toBeGreaterThan(0);
  });
});
