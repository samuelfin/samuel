import { MODULES } from "@/lib/catalog/modules";
import { INDICATORS } from "@/lib/catalog/indicators";
import { NGX_INDICES, NGX_SECTORS } from "@/lib/catalog/markets";
import { INSTRUMENT_CLASSES } from "@/lib/catalog/fixed-income";

/**
 * Global search over the terminal's reference catalogue. Companies, symbols, news,
 * documents and reports join this index once their datasets are connected; until then
 * the search UI says so rather than silently returning nothing.
 */

export type SearchCategory = "Function" | "Index" | "Indicator" | "Fixed income" | "Sector";

export interface SearchEntry {
  id: string;
  category: SearchCategory;
  label: string;
  detail: string;
  href: string;
  code?: string;
  keywords: string[];
}

export interface SearchGroup {
  category: SearchCategory;
  results: SearchEntry[];
}

export function buildSearchIndex(): SearchEntry[] {
  return [
    ...MODULES.map((m): SearchEntry => ({ id: `fn:${m.code}`, category: "Function", label: m.label, detail: m.description, href: m.href, code: m.code, keywords: m.keywords })),
    ...NGX_INDICES.map((i): SearchEntry => ({ id: `idx:${i.id}`, category: "Index", label: i.name, detail: `${i.family} index · NGX`, href: "/markets", keywords: ["ngx", "index"] })),
    ...INDICATORS.map((i): SearchEntry => ({ id: `ind:${i.id}`, category: "Indicator", label: i.name, detail: `${i.category} · ${i.source.toUpperCase()}`, href: `/economy#${i.id}`, keywords: [i.category, i.source] })),
    ...INSTRUMENT_CLASSES.map((c): SearchEntry => ({ id: `fi:${c.id}`, category: "Fixed income", label: c.name, detail: c.issuer, href: `/fixed-income#${c.id}`, keywords: ["bond", "yield", "fixed income"] })),
    ...NGX_SECTORS.map((s): SearchEntry => ({ id: `sec:${s}`, category: "Sector", label: s, detail: "NGX sector", href: "/equities", keywords: ["sector"] })),
  ];
}

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function score(entry: SearchEntry, rawQuery: string): number {
  const q = normalize(rawQuery);
  if (!q) return 0;
  if (entry.code && entry.code.toLowerCase() === q.replace(/\s/g, "")) return 100;
  const label = normalize(entry.label);
  if (label === q) return 90;
  if (label.startsWith(q)) return 70;
  if (label.split(" ").some((w) => w.startsWith(q))) return 55;
  if (label.includes(q)) return 40;
  if (entry.keywords.map(normalize).some((k) => k === q || k.startsWith(q))) return 30;
  if (normalize(entry.detail).includes(q)) return 15;
  return 0;
}

/** Ranked results grouped by category; groups are ordered by their best match. */
export function search(entries: SearchEntry[], query: string, perCategory = 5): SearchGroup[] {
  if (!normalize(query)) return [];
  const ranked = entries
    .map((entry) => ({ entry, score: score(entry, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label));
  const groups = new Map<SearchCategory, SearchEntry[]>();
  for (const { entry } of ranked) {
    const list = groups.get(entry.category) ?? [];
    if (list.length < perCategory) list.push(entry);
    groups.set(entry.category, list);
  }
  return Array.from(groups, ([category, results]) => ({ category, results }));
}

/** Heuristic: an upper-case token shaped like an NGX ticker (e.g. "MTNN", "GTCO"). */
export function looksLikeSymbol(query: string): boolean {
  const q = query.trim();
  return /^[A-Z][A-Z0-9.]{1,14}$/.test(q);
}
