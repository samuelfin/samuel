import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./db";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * PostgREST embeds, checked against the real foreign keys.
 *
 * Where a table holds two foreign keys to the same other table, a bare embed —
 * `documents(title)` — is ambiguous, and PostgREST refuses the *entire* query
 * with "more than one relationship was found" rather than picking one. The page
 * then fails to load in a way no local test can reproduce, because the suite
 * runs on PGlite and there is no PostgREST in it at all.
 *
 * That is exactly what happened at stage 3b.2: company_roles references
 * documents twice, as the evidence for a role and as the source that last
 * confirmed it, and the leadership desk's query worked in every test and failed
 * against the real project.
 *
 * So this derives the ambiguous pairs from the database's own catalogue and
 * checks the data layer's projections against them. It is the same approach as
 * the service_role grant scan: discover the requirement from the code and the
 * schema rather than from a list kept by hand.
 */

let db: PGlite;
/** child table -> referenced table -> how many foreign keys join them. */
let foreignKeys: Map<string, Map<string, number>>;
/** "child->parent" -> the names PostgREST accepts as a hint for it. */
let relationshipNames: Map<string, Set<string>>;

beforeAll(async () => {
  db = await createTestDatabase();
  // One row per foreign key, with the constraint name and the constrained
  // column: either is a hint PostgREST will resolve.
  const { rows } = await db.query<{
    child: string;
    parent: string;
    constraint_name: string;
    column_name: string;
  }>(
    `select con.conrelid::regclass::text as child,
            con.confrelid::regclass::text as parent,
            con.conname as constraint_name,
            att.attname as column_name
       from pg_constraint con
       join pg_namespace n on n.oid = con.connamespace
       join unnest(con.conkey) as k(attnum) on true
       join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
      where con.contype = 'f' and n.nspname = 'public'`,
  );

  foreignKeys = new Map();
  relationshipNames = new Map();
  const counted = new Set<string>();

  for (const row of rows) {
    const child = row.child.replace(/^public\./, "");
    const parent = row.parent.replace(/^public\./, "");

    // A composite key appears once per column, so count constraints, not rows.
    const key = `${child}->${parent}->${row.constraint_name}`;
    if (!counted.has(key)) {
      counted.add(key);
      if (!foreignKeys.has(child)) foreignKeys.set(child, new Map());
      const byParent = foreignKeys.get(child)!;
      byParent.set(parent, (byParent.get(parent) ?? 0) + 1);
    }

    const pair = `${child}->${parent}`;
    if (!relationshipNames.has(pair)) relationshipNames.set(pair, new Set());
    relationshipNames.get(pair)!.add(row.constraint_name);
    relationshipNames.get(pair)!.add(row.column_name);
  }
}, 180_000);

interface Projection {
  file: string;
  table: string;
  projection: string;
}

/** Concatenated string literals, as the projections are written. */
function joinLiterals(expression: string): string | null {
  const parts = [...expression.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  if (parts.length === 0) return null;
  return parts.join("");
}

function collectProjections(): Projection[] {
  const files = [...globSync("lib/data/*.ts", { cwd: REPO_ROOT })].filter((f) => !f.endsWith(".test.ts"));
  const found: Projection[] = [];

  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");

    // Projections are often held in a module constant, so resolve those first.
    const constants = new Map<string, string>();
    for (const match of text.matchAll(
      /const\s+(\w+)\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*\+\s*)*"(?:[^"\\]|\\.)*")\s*;/g,
    )) {
      const value = joinLiterals(match[2]);
      if (value) constants.set(match[1], value);
    }

    // `.from("table")` followed by its `.select(...)` in the same chain. The
    // argument is captured as a run of string literals or as an identifier,
    // rather than up to the closing paren, because a projection containing an
    // embed has parentheses of its own.
    for (const match of text.matchAll(
      /\.from\(\s*"([a-z_]+)"\s*\)[\s\S]{0,400}?\.select\(\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+|\w+)/g,
    )) {
      const table = match[1];
      const argument = match[2].trim();
      const projection = argument.startsWith('"')
        ? joinLiterals(argument)
        : (constants.get(argument) ?? null);
      if (projection) found.push({ file, table, projection });
    }
  }

  return found;
}

interface Embed {
  alias: string | null;
  table: string;
  /** A relationship hint: a column or constraint name. */
  hint: string | null;
}

/**
 * `inner` and `left` are join modifiers, not relationship hints. They say how to
 * join, never which relationship to join through, so an ambiguous pair stays
 * ambiguous with `!inner` on it.
 */
const JOIN_MODIFIERS = new Set(["inner", "left"]);

/** `documents(title)`, `confirmation:documents!last_confirmed_document_id!inner(title)`. */
function embedsIn(projection: string): Embed[] {
  return [
    ...projection.matchAll(/(?:(\w+)\s*:\s*)?([a-z_][a-z0-9_]*)((?:\s*!\s*\w+)*)\s*\(/g),
  ].map((match) => {
    const tokens = [...(match[3] ?? "").matchAll(/!\s*(\w+)/g)].map((m) => m[1]);
    const hint = tokens.find((token) => !JOIN_MODIFIERS.has(token)) ?? null;
    return { alias: match[1] ?? null, table: match[2], hint };
  });
}

describe("every embed the data layer asks for is unambiguous", () => {
  it("finds the projections at all", () => {
    // Guards against the scan silently matching nothing and the suite passing
    // vacuously, which is the failure mode of a test like this.
    const projections = collectProjections();
    expect(projections.length, "found no .from().select() pairs — the scan is not working").toBeGreaterThan(
      10,
    );
    expect(
      projections.some((p) => embedsIn(p.projection).length > 0),
      "found no embeds at all — the embed parser is not working",
    ).toBe(true);
  });

  it("knows which table pairs are ambiguous", () => {
    // company_roles -> documents is the pair that caused this test to exist. If
    // the schema ever stops having it, this assertion should be updated rather
    // than quietly leaving the check with nothing to find.
    expect(foreignKeys.get("company_roles")?.get("documents")).toBe(2);
    expect(foreignKeys.get("company_roles")?.get("announcements")).toBe(2);
  });

  /**
   * The predicate, named so it can be tested against a known-bad projection as
   * well as against the real ones. A guard nobody has watched fail is not a
   * guard, and deleting a hint from the data layer to watch it fail would leave
   * the repository briefly broken.
   */
  function ambiguousEmbeds(file: string, table: string, projection: string): string[] {
    const problems: string[] = [];
    for (const embed of embedsIn(projection)) {
      // An alias on the left names the result, not the relationship; only the
      // hint after `!` disambiguates.
      const count = foreignKeys.get(table)?.get(embed.table) ?? 0;
      if (count > 1 && !embed.hint) {
        problems.push(
          `${file}: selecting from "${table}" embeds "${embed.table}" with no !hint, ` +
            `but ${count} foreign keys join them. PostgREST will refuse the whole query.`,
        );
      }
    }
    return problems;
  }

  it("reports the projection that actually broke the leadership desk", () => {
    // Exactly what lib/data/people.ts asked for before the fix.
    const bad = ambiguousEmbeds("probe", "company_roles", "id, person_id, documents(title)");
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/documents.*no !hint/);

    // And a join modifier is not a disambiguation, so it stays reported.
    expect(ambiguousEmbeds("probe", "company_roles", "id, documents!inner(title)")).toHaveLength(1);

    // The hinted form is accepted, as are the aliased and modified variants.
    for (const projection of [
      "id, documents!document_id(title)",
      "id, evidence:documents!document_id(title)",
      "id, documents!last_confirmed_document_id!inner(title)",
      "id, companies(name)",
    ]) {
      expect(ambiguousEmbeds("probe", "company_roles", projection), projection).toEqual([]);
    }
  });

  it("hints every embed that joins through more than one foreign key", () => {
    const problems = collectProjections().flatMap(({ file, table, projection }) =>
      ambiguousEmbeds(file, table, projection),
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("names a real relationship in every hint it does give", () => {
    // A hint only disambiguates if PostgREST can resolve it, so a mistyped column
    // or constraint name fails the query just as surely as no hint at all. The
    // check is deliberately limited to hints on pairs that genuinely have a
    // foreign key between them: PostgREST also embeds through intermediate
    // tables, and those have no direct key, so flagging them would be wrong.
    const problems: string[] = [];

    for (const { file, table, projection } of collectProjections()) {
      for (const embed of embedsIn(projection)) {
        if (!embed.hint) continue;
        const direct = foreignKeys.get(table)?.get(embed.table) ?? 0;
        if (direct === 0) continue;
        const allowed = relationshipNames.get(`${table}->${embed.table}`) ?? new Set<string>();
        if (!allowed.has(embed.hint)) {
          problems.push(
            `${file}: selecting from "${table}" embeds "${embed.table}!${embed.hint}", but the ` +
              `relationship is named by one of: ${[...allowed].sort().join(", ")}.`,
          );
        }
      }
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
