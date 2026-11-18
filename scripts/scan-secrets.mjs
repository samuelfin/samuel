#!/usr/bin/env node
/**
 * Secret scan for the Samuel Terminal repository.
 *
 * Deliberately dependency-free: it runs identically on a developer machine and in
 * CI, and cannot break because of an upstream action release. It is tuned to the
 * credentials this stack actually has — above all the Supabase secret key, which
 * bypasses row-level security and would expose licensed data and the audit log.
 *
 * It is a backstop, not a guarantee. A broad scanner (gitleaks, trufflehog) catches
 * shapes this does not; add one in CI when a version and licence are settled.
 *
 * Usage:  node scripts/scan-secrets.mjs [--all]
 *   default   scan files tracked by git
 *   --all     walk the working tree instead (skips node_modules, .next, .git)
 *
 * Suppress a deliberate match by putting `sfi:allow-secret` on the same line.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const ALLOW_PRAGMA = "sfi:allow-secret";

/** Paths never scanned: this script defines the patterns, and lockfiles are noise. */
const SKIP_PATHS = new Set(["scripts/scan-secrets.mjs", "package-lock.json"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "coverage"]);
const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".pdf",
  ".docx", ".xlsx", ".woff", ".woff2", ".ttf", ".zip", ".map",
]);

/**
 * Markers of an obvious placeholder. `.env.example` is meant to carry
 * `sb_secret_your_server_key`, and documentation carries illustrative values.
 */
const PLACEHOLDER = /your|example|placeholder|redacted|changeme|dummy|sample|xxxx|\.\.\.|<|\$\{/i;

const RULES = [
  {
    id: "supabase-secret-key",
    description: "Supabase secret key (bypasses row-level security)",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: "supabase-publishable-key",
    description: "Supabase publishable key committed outside .env.example",
    pattern: /\bsb_publishable_[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: "jwt",
    description: "JSON Web Token (check whether it is a service_role key)",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: "private-key",
    description: "Private key block",
    pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  {
    id: "aws-access-key-id",
    description: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: "public-env-secret",
    description: "Secret-looking value exposed to the browser via NEXT_PUBLIC_",
    pattern: /\bNEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE_KEY|PASSWORD)[A-Z0-9_]*/g,
  },
  {
    id: "assigned-credential",
    description: "Credential assigned inline",
    // Requires a quoted literal, so `const key = process.env.X` does not match.
    // The gap after the name tolerates a TypeScript annotation (`password: string =
    // "…"`) but excludes `(` so that calls such as `t("login.password")` do not match.
    pattern: /\b(?:secret|password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=][^"'`\n;(]{0,40}["'`]([^"'`\n]{8,})["'`]/gi,
  },
];

/** Tracked files that must never exist, whatever they contain. */
function forbiddenPath(path) {
  const name = path.split("/").pop() ?? "";
  if (name === ".env.example") return null;
  if (name === ".env" || name.startsWith(".env.")) {
    return "environment file committed to the repository";
  }
  if (/\.(pem|p12|pfx|keystore|jks)$/i.test(name)) {
    return "key or keystore file committed to the repository";
  }
  return null;
}

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), found);
    } else if (entry.isFile()) {
      found.push(relative(ROOT, join(dir, entry.name)).split(sep).join("/"));
    }
  }
  return found;
}

/** Never print the secret itself: enough to locate it, not enough to use it. */
function redact(value) {
  return `${value.slice(0, 4)}… (${value.length} chars)`;
}

function scanFile(path, findings) {
  const forbidden = forbiddenPath(path);
  if (forbidden) {
    findings.push({ path, line: 0, rule: "forbidden-file", description: forbidden, sample: path });
    return;
  }

  const dot = path.lastIndexOf(".");
  if (dot !== -1 && SKIP_EXTENSIONS.has(path.slice(dot).toLowerCase())) return;

  let text;
  try {
    const info = statSync(join(ROOT, path));
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return;
    text = readFileSync(join(ROOT, path), "utf8");
  } catch {
    return;
  }
  if (text.includes("\u0000")) return; // binary

  text.split(/\r?\n/).forEach((line, index) => {
    if (line.includes(ALLOW_PRAGMA)) return;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(line)) !== null) {
        const value = match[1] ?? match[0];
        if (PLACEHOLDER.test(value) || PLACEHOLDER.test(line)) continue;
        findings.push({
          path,
          line: index + 1,
          rule: rule.id,
          description: rule.description,
          sample: redact(value),
        });
      }
    }
  });
}

function main() {
  const all = process.argv.includes("--all");
  let files;
  if (all) {
    files = walk(ROOT);
  } else {
    try {
      files = listTrackedFiles();
    } catch {
      console.error("Not a git repository; falling back to a working-tree walk.");
      files = walk(ROOT);
    }
  }

  const findings = [];
  for (const path of files) {
    if (SKIP_PATHS.has(path)) continue;
    scanFile(path, findings);
  }

  if (findings.length === 0) {
    console.log(`Secret scan: clean (${files.length} files).`);
    return;
  }

  console.error(`Secret scan: ${findings.length} finding(s).\n`);
  for (const f of findings) {
    const where = f.line > 0 ? `${f.path}:${f.line}` : f.path;
    console.error(`  [${f.rule}] ${where}`);
    console.error(`      ${f.description}`);
    console.error(`      match: ${f.sample}\n`);
  }
  console.error(`If a match is intentional, append "${ALLOW_PRAGMA}" to that line.`);
  process.exit(1);
}

main();
