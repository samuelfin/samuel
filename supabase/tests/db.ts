import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

/**
 * In-process PostgreSQL (PGlite) with the minimum of Supabase the migrations rely on:
 * the anon/authenticated/service_role roles, an `auth.users` table and `auth.uid()`
 * reading the JWT subject from a session setting. Every migration is then applied in
 * filename order, exactly as Supabase would.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz not null default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now()
  );
  -- Table privileges are granted on purpose. The storage policies are supposed to
  -- deny the document bucket through row-level security, so the tests must fail for
  -- that reason rather than for a missing GRANT.
  grant select, insert, update, delete on storage.objects to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

/** Run `fn` as a signed-in user (role `authenticated`, auth.uid() = userId), so RLS applies. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

export type StaffRole = "editor" | "analyst" | "fact_checker" | "publisher" | "financial_analyst";

export async function createUser(
  db: PGlite,
  opts: { admin?: boolean; staff?: StaffRole[] } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(0, 8)}@example.test`]);
  if (opts.admin) await db.query("insert into public.platform_admins (user_id, granted_by) values ($1, $1)", [id]);
  for (const role of opts.staff ?? []) {
    await db.query("insert into public.platform_staff (user_id, role, granted_by) values ($1, $2, $1)", [id, role]);
  }
  return id;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Approve the seeded metric library as a platform administrator.
 *
 * The library arrives as proposals and computes nothing until a person approves
 * it, so any test about a calculated figure has to do what the desk does. Only
 * the newest version of each metric is offered: an earlier one no longer
 * supersedes the latest, and the database refuses it for that reason.
 */
export async function approveMetricLibrary(db: PGlite, adminUser: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select d.id from public.metric_definitions d
      where d.approved_at is null
        and d.rejected_at is null
        and d.version = (select max(o.version) from public.metric_definitions o where o.code = d.code)
      order by d.code`,
  );
  for (const row of rows) {
    await db.query("select public.decide_metric_definition($1, $2, 'approved', $3)", [
      row.id,
      adminUser,
      "Approved for the test fixture.",
    ]);
  }
}

/** Insert a source record for a dataset and return its id. */
export async function createSourceRecord(db: PGlite, dataset: string, content: string = randomUUID()): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.source_records (dataset_id, retrieved_at, content_sha256, source_uri) values ($1, now(), $2, 'https://example.test/release') returning id",
    [dataset, sha256(content)],
  );
  return rows[0].id;
}

/** Errors from PGlite carry the SQLSTATE in `code`. */
export async function expectSqlError(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error("Expected the statement to fail, but it succeeded");
}
