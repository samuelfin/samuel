#!/usr/bin/env node
// Check the pilot universe against the NGX directory. Changes nothing.
//
//   node scripts/verify-ngx-directory.mjs                    # what we hold, and the changes already found
//   node scripts/verify-ngx-directory.mjs ngx-directory.csv  # compare against a directory export
//
// A wrong ticker is a wrong company. Everything in stage 3c hangs off the
// identity in scripts/pilot-companies.json — five years of figures, the
// documents, the leadership — so it is checked against the exchange's own list
// before anything is seeded, and the differences go to the CEO rather than being
// resolved here.
//
// Why a local export rather than a fetch: the NGX directory is a web page with
// its own terms, and a scraper pointed at it would be both fragile and a
// licensing question nobody has answered. Export or save the issuer list, pass
// the file, and this compares the two. It expects a name column and a symbol
// column under any of the usual headings; a JSON array of objects works too.
//
// Exits non-zero when something differs, so it can gate the seed.
import { readFileSync } from "node:fs";

const PILOT = "scripts/pilot-companies.json";

function loadPilot() {
  return JSON.parse(readFileSync(PILOT, "utf8"));
}

/** A ticker as the exchange writes it, compared case- and space-insensitively. */
function normaliseTicker(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * A company name reduced to what two records must agree on. "Plc", "Limited",
 * accents and punctuation all vary between the exchange, the issuer and the
 * press, and none of them changes which company it is.
 */
function normaliseName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(plc|limited|ltd|company|holdings?|holdco)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

const NAME_HEADINGS = ["company", "company name", "name", "security", "issuer", "description"];
const TICKER_HEADINGS = ["symbol", "ticker", "code", "security code", "trading symbol"];

function loadDirectory(path) {
  const text = readFileSync(path, "utf8");
  const trimmed = text.trimStart();

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.companies ?? []);
    return rows.map((row) => ({
      name: row.name ?? row.company ?? row.companyName ?? row.issuer ?? row.security ?? "",
      ticker: row.symbol ?? row.ticker ?? row.code ?? row.securityCode ?? "",
    }));
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const headings = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameAt = headings.findIndex((h) => NAME_HEADINGS.includes(h));
  const tickerAt = headings.findIndex((h) => TICKER_HEADINGS.includes(h));
  if (nameAt === -1 || tickerAt === -1) {
    throw new Error(
      `Could not find a name column and a symbol column in ${path}. ` +
        `Headings read: ${headings.join(", ")}. Expected one of ${NAME_HEADINGS.join("/")} ` +
        `and one of ${TICKER_HEADINGS.join("/")}.`,
    );
  }
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return { name: (cells[nameAt] ?? "").trim(), ticker: (cells[tickerAt] ?? "").trim() };
  });
}

const pilot = loadPilot();
const companies = pilot.companies;
const directoryPath = process.argv[2];

let problems = 0;
const report = (line) => console.log(line);

report("");
report(`Pilot universe — ${companies.length} companies, ${pilot.period.from} to ${pilot.period.to}`);
report(`Basis: ${pilot.period.basis}`);
report("");

// Internal consistency first. These are faults in our own file, and no
// directory is needed to find them.
const seenTickers = new Map();
const seenNames = new Map();
for (const company of companies) {
  const ticker = normaliseTicker(company.ticker);
  if (!ticker) {
    report(`  PROBLEM  ${company.name} has no ticker`);
    problems += 1;
  }
  if (seenTickers.has(ticker)) {
    report(`  PROBLEM  ${company.ticker} is used by both ${seenTickers.get(ticker)} and ${company.name}`);
    problems += 1;
  }
  seenTickers.set(ticker, company.name);

  const name = normaliseName(company.name);
  if (seenNames.has(name)) {
    report(`  PROBLEM  ${company.name} and ${seenNames.get(name)} reduce to the same name`);
    problems += 1;
  }
  seenNames.set(name, company.name);
}

// Changes we already know about, so the CEO can sign them off rather than
// discover them when a figure lands under the wrong company.
const changed = companies.filter((c) => c.priorName || c.priorTicker);
if (changed.length > 0) {
  report("Changed since the coverage document was written:");
  report("");
  for (const company of changed) {
    report(`  ${company.priorName ?? company.name} -> ${company.name}`);
    if (company.priorTicker && normaliseTicker(company.priorTicker) !== normaliseTicker(company.ticker)) {
      report(`    ticker ${company.priorTicker} -> ${company.ticker}`);
    }
    report(`    evidence: ${company.source ?? "none recorded"}`);
    if (company.note) report(`    note: ${company.note}`);
    report("");
  }
}

for (const excluded of pilot.excluded ?? []) {
  report(`Excluded: ${excluded.name} (${excluded.ticker})`);
  report(`  ${excluded.reason}`);
  report(`  evidence: ${excluded.source ?? "none recorded"}`);
  report("");
}

if (!directoryPath) {
  report("No directory export given, so the tickers were not checked against the exchange.");
  report("Save or export the NGX issuer list and run:");
  report("  npm run verify:ngx -- path/to/ngx-directory.csv");
  report("");
  report(problems === 0 ? "The file is internally consistent." : `${problems} problem(s) in the file itself.`);
  process.exit(problems === 0 ? 0 : 1);
}

const directory = loadDirectory(directoryPath);
report(`Directory export: ${directory.length} rows from ${directoryPath}`);
report("");

const byTicker = new Map(directory.map((row) => [normaliseTicker(row.ticker), row]));
const byName = new Map(directory.map((row) => [normaliseName(row.name), row]));

for (const company of companies) {
  const ticker = normaliseTicker(company.ticker);
  const onTicker = byTicker.get(ticker);
  const onName = byName.get(normaliseName(company.name));

  if (!onTicker && !onName) {
    report(`  MISSING  ${company.name} (${company.ticker}) is not in the directory at all`);
    problems += 1;
    continue;
  }

  if (!onTicker) {
    report(
      `  TICKER   ${company.name}: we hold ${company.ticker}, the directory lists ${onName.ticker} for that name`,
    );
    problems += 1;
    continue;
  }

  if (normaliseName(onTicker.name) !== normaliseName(company.name)) {
    report(`  NAME     ${company.ticker}: we hold "${company.name}", the directory says "${onTicker.name}"`);
    problems += 1;
    continue;
  }

  report(`  ok       ${company.ticker} — ${onTicker.name}`);
}

// A company we excluded that is still listed is as much a problem as one we
// included that is not.
for (const excluded of pilot.excluded ?? []) {
  if (byTicker.has(normaliseTicker(excluded.ticker))) {
    report(`  EXCLUDED ${excluded.name} (${excluded.ticker}) is still in the directory, but we excluded it`);
    problems += 1;
  }
}

report("");
if (problems === 0) {
  report("Every company matches the directory on name and ticker. Nothing was changed.");
} else {
  report(`${problems} difference(s) to resolve. Nothing was changed; this needs sign-off.`);
}
process.exit(problems === 0 ? 0 : 1);
