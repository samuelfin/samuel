/**
 * Terminal modules: navigation, function codes and search entries.
 * Function codes can be typed into the command bar (e.g. "ECO" + Enter).
 */

export type ModuleGroup = "Markets" | "Research" | "Workspace";

export interface TerminalModule {
  code: string;
  label: string;
  href: string;
  group: ModuleGroup;
  description: string;
  keywords: string[];
  /** Delivery phase (docs/ROADMAP_AND_COST_MODEL.md) in which the module gets live data. */
  phase: number;
}

export const MODULES: readonly TerminalModule[] = [
  { code: "OVR", label: "Overview", href: "/", group: "Markets", phase: 2, description: "Market summary, movers, indicators and briefing", keywords: ["dashboard", "home", "summary"] },
  { code: "MKT", label: "Markets", href: "/markets", group: "Markets", phase: 2, description: "NGX indices, breadth and market activity", keywords: ["index", "indices", "asi", "all-share", "breadth", "volume"] },
  { code: "EQS", label: "Equities", href: "/equities", group: "Markets", phase: 2, description: "Listed equities and screener", keywords: ["stocks", "shares", "screener", "gainers", "losers"] },
  { code: "CO", label: "Companies", href: "/companies", group: "Markets", phase: 2, description: "Company profiles, financials and documents", keywords: ["issuer", "profile", "financials", "annual report"] },
  { code: "LD", label: "Leadership", href: "/people", group: "Markets", phase: 3, description: "Executives and boards, with the dates each took office", keywords: ["people", "ceo", "chairman", "board", "director", "executive", "management", "tenure"] },
  { code: "ECO", label: "Economy", href: "/economy", group: "Markets", phase: 2, description: "Nigerian macroeconomic indicators", keywords: ["macro", "inflation", "gdp", "cpi", "mpr", "reserves", "fx"] },
  { code: "FI", label: "Fixed Income", href: "/fixed-income", group: "Markets", phase: 3, description: "FGN bonds, Treasury bills, sukuk and corporates", keywords: ["bonds", "yields", "treasury", "ntb", "auction", "sukuk", "coupon"] },
  { code: "NEWS", label: "News", href: "/news", group: "Research", phase: 3, description: "Market news, announcements and corporate actions", keywords: ["announcements", "corporate actions", "ipo", "dividends", "rights issue"] },
  { code: "RES", label: "Research", href: "/research", group: "Research", phase: 3, description: "SFI research reports and analysis", keywords: ["reports", "analysis", "sector"] },
  { code: "AI", label: "AI Intelligence", href: "/ai", group: "Research", phase: 4, description: "Source-grounded research assistant", keywords: ["assistant", "ask", "chat", "analysis", "compare"] },
  { code: "WL", label: "Watchlists", href: "/watchlists", group: "Workspace", phase: 5, description: "Companies and indicators you follow", keywords: ["watch", "follow", "favourites"] },
  { code: "ALRT", label: "Alerts", href: "/alerts", group: "Workspace", phase: 5, description: "Price, announcement and release alerts", keywords: ["notify", "notifications", "price alert"] },
  { code: "RPT", label: "Reports", href: "/reports", group: "Workspace", phase: 3, description: "Exports and generated reports", keywords: ["export", "pdf", "csv", "excel", "download"] },
];

export const MODULE_GROUPS: readonly ModuleGroup[] = ["Markets", "Research", "Workspace"];

export function moduleByCode(code: string): TerminalModule | undefined {
  const needle = code.trim().toUpperCase();
  return MODULES.find((m) => m.code === needle);
}

/** Module that owns a pathname, matching nested routes (e.g. /companies/MTNN → Companies). */
export function moduleForPath(pathname: string): TerminalModule | undefined {
  if (pathname === "/") return MODULES[0];
  return MODULES.find((m) => m.href !== "/" && (pathname === m.href || pathname.startsWith(`${m.href}/`)));
}
