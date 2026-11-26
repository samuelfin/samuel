import "server-only";
import { cache, type ReactNode } from "react";
import Link from "next/link";
import { notFound, permanentRedirect, redirect, unstable_rethrow } from "next/navigation";
import { PageHeader } from "@/components/terminal/ui";
import {
  currentSlugForFormerSlug,
  getCompanyBySlug,
  LISTING_STATUS_LABELS,
  normalizeSlug,
  normalizeSymbol,
  slugForSymbol,
  type CompanyProfile,
} from "@/lib/data/companies";

/**
 * What every tab of a company page shares.
 *
 * The five tabs are five routes rather than one page with state, so each has its
 * own address a reader can send to somebody, and each loads only what it shows.
 * There is deliberately no nested layout: a layout does not re-run on client
 * navigation, and this codebase already makes every page re-verify its session
 * for that reason. A shared frame rendered by each page keeps that property and
 * costs one memoised lookup.
 */

export const COMPANY_TABS = [
  { segment: "", label: "Overview" },
  { segment: "financials", label: "Financials" },
  { segment: "ratios", label: "Ratios" },
  { segment: "dividends", label: "Dividends" },
  { segment: "annual-reports", label: "Annual Reports" },
] as const;

export type CompanyTab = (typeof COMPANY_TABS)[number]["segment"];

function href(slug: string, tab: CompanyTab): string {
  return tab ? `/companies/${slug}/${tab}` : `/companies/${slug}`;
}

/**
 * One address, three ways in.
 *
 * The slug is the company's own address. A slug it used to carry redirects
 * permanently, because the page really has moved. A ticker redirects
 * temporarily, because a ticker can be reassigned to another company and no
 * browser or proxy should cache that mapping for good. Either way the reader
 * lands on the tab they asked for.
 *
 * Memoised for the request, so the frame and the panels share one lookup. React
 * cache is per-request: nothing is held between readers.
 */
const resolve = cache(
  async (
    raw: string,
  ): Promise<{ company: CompanyProfile } | { moved: string; permanent: boolean } | { missing: true }> => {
    const slug = normalizeSlug(raw);

    if (slug) {
      const company = await getCompanyBySlug(slug);
      if (company) return { company };

      const current = await currentSlugForFormerSlug(slug);
      if (current) return { moved: current, permanent: true };
    }

    // A ticker typed into the address bar, which is what an analyst will do.
    const symbol = normalizeSymbol(raw);
    if (symbol) {
      const bySymbol = await slugForSymbol(symbol);
      if (bySymbol) return { moved: bySymbol, permanent: false };
    }

    return { missing: true };
  },
);

/**
 * The company this tab is about, or the redirect that gets the reader there.
 * Called from the page body, never inside a try: redirect() signals by throwing.
 */
export async function companyForTab(raw: string, tab: CompanyTab): Promise<CompanyProfile> {
  const resolved = await resolve(raw);
  if ("missing" in resolved) notFound();
  if ("moved" in resolved) {
    if (resolved.permanent) permanentRedirect(href(resolved.moved, tab));
    redirect(href(resolved.moved, tab));
  }
  return resolved.company;
}

/** A title for the tab, falling back to something honest if the lookup fails. */
export async function companyTabMetadata(raw: string, label: string) {
  const slug = normalizeSlug(raw);
  if (!slug) return { title: "Company" };
  try {
    const company = await getCompanyBySlug(slug);
    return { title: company ? `${company.name} — ${label}` : "Company" };
  } catch (error) {
    unstable_rethrow(error);
    // A title is not worth failing a page over.
    return { title: "Company" };
  }
}

/**
 * A panel's data, or the reason it could not be loaded. Discriminated on `ok`
 * rather than on the error being absent, because an error string could in
 * principle be empty and TypeScript would then narrow neither case.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export function panel<T>(promise: Promise<T>, whatFailed: string): Promise<Loaded<T>> {
  return promise.then<Loaded<T>, Loaded<T>>(
    (data) => ({ ok: true, data }),
    (error: unknown) => {
      // Next signals redirect(), notFound() and prerender bailouts by throwing.
      // Reporting one of those as a panel failure would strand a reader on a
      // half-rendered page instead of sending them to the login screen.
      unstable_rethrow(error);
      return { ok: false, error: error instanceof Error ? error.message : whatFailed };
    },
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(
    new Date(iso),
  );
}

/** The header and the tab bar, identical on every tab. */
export function CompanyFrame({
  company,
  tab,
  children,
}: {
  company: CompanyProfile;
  tab: CompanyTab;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader
        code={company.symbol ?? "CO"}
        title={company.name}
        description={
          [company.sector, company.industry, company.listingBoard].filter(Boolean).join(" · ") ||
          "Sector not yet recorded."
        }
      />

      <nav className="company-tabs" aria-label="Company sections">
        {COMPANY_TABS.map((entry) => {
          const current = entry.segment === tab;
          return (
            <Link
              key={entry.segment || "overview"}
              href={href(company.slug, entry.segment)}
              aria-current={current ? "page" : undefined}
              className={current ? "is-current" : undefined}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </>
  );
}

export { LISTING_STATUS_LABELS };
