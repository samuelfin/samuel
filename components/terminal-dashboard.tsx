"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";

const navigation = [
  { label: "Overview", icon: "⌂", target: "top" },
  { label: "Markets", icon: "↗", target: "market-glance" },
  { label: "Equities", icon: "▥", target: "market-glance" },
  { label: "Companies", icon: "▦", target: "intelligence" },
  { label: "Economy", icon: "◎", target: "economy" },
  { label: "Fixed Income", icon: "≋", target: "fixed-income" },
  { label: "News", icon: "▤", target: "intelligence" },
  { label: "Research", icon: "⌕", target: "intelligence" },
  { label: "AI Intelligence", icon: "✳", target: "ai-briefing" },
];

const marketPulse = [
  { label: "NGX ALL-SHARE INDEX", key: "NGXASI" },
  { label: "NGX 30", key: "NGX30" },
  { label: "NGX BANKING", key: "NGXBANK" },
  { label: "USD / NGN", key: "FX" },
];

const indicators = ["Inflation", "GDP growth", "Monetary policy rate", "Official exchange rate"];

export default function TerminalDashboard({
  userName,
  isPlatformAdmin,
  isPreview = false,
}: {
  userName: string;
  isPlatformAdmin: boolean;
  isPreview?: boolean;
}) {
  const [active, setActive] = useState("Overview");
  const [query, setQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const filteredNavigation = useMemo(() => {
    if (!query.trim()) return [];
    const needle = query.toLowerCase();
    return navigation.filter((item) => item.label.toLowerCase().includes(needle));
  }, [query]);

  function selectNav(label: string) {
    const item = navigation.find((entry) => entry.label === label);
    setActive(label);
    setQuery("");
    setMobileMenuOpen(false);
    if (item) document.getElementById(item.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    else setNotice(`${label} tools will be available as this workspace is configured.`);
    if (!item) window.setTimeout(() => setNotice(""), 2600);
  }

  return (
    <main className="editorial-shell" id="top">
      <div className="editorial-topline">
        <span>THE BUSINESS OF NIGERIA</span>
        <span>LAGOS · WEST AFRICA TIME (UTC+1)</span>
      </div>

      <header className="editorial-header">
        <div className="editorial-header-main">
          <Link className="editorial-brand" href={isPreview ? "/preview" : "/"} aria-label="Samuel Terminal home">
            <span className="editorial-brand-mark">S<span>•</span></span>
            <span className="editorial-brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span>
          </Link>
          <label className="editorial-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search markets, companies, indicators..."
              aria-label="Search markets, companies and indicators"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="editorial-account">
            <span className="editorial-avatar">{userName.slice(0, 1).toUpperCase()}</span>
            <span className="editorial-user-name">{userName}</span>
            {!isPreview && isPlatformAdmin && <Link className="editorial-admin-link" href="/admin">Admin</Link>}
            {!isPreview && <form action={signOut}><button className="editorial-signout" title="Sign out" aria-label="Sign out">↗</button></form>}
          </div>
          <button
            className="editorial-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? "×" : "☰"}
          </button>
        </div>
        <nav className={`editorial-nav ${mobileMenuOpen ? "is-open" : ""}`} aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.label}
              className={`editorial-nav-item ${active === item.label ? "is-active" : ""}`}
              onClick={() => selectNav(item.label)}
            >
              <span>{item.icon}</span>{item.label}
              {item.label === "AI Intelligence" && <em>AI</em>}
            </button>
          ))}
          <div className="editorial-nav-tools">
            <button onClick={() => selectNav("Watchlists")}>☆ <span>Watchlist</span></button>
            <button onClick={() => selectNav("Alerts")}>♧ <span>Alerts</span></button>
            <button onClick={() => selectNav("Reports")}>▧ <span>Reports</span></button>
          </div>
        </nav>
        {query && (
          <div className="editorial-search-results">
            {filteredNavigation.length ? filteredNavigation.map((item) => (
              <button key={item.label} onClick={() => selectNav(item.label)}><span>{item.icon}</span>{item.label}<small>Workspace</small></button>
            )) : <p>No matching section. Company and market search will appear when an authorized dataset is connected.</p>}
          </div>
        )}
      </header>

      <section className="market-pulse" aria-labelledby="market-pulse-title">
        <div className="market-pulse-inner">
          <div className="market-pulse-heading">
            <div><span className="pulse-dot" /><span className="editorial-kicker">MARKET PULSE</span></div>
            <span className="feed-badge">FEED STATUS · AWAITING CONNECTION</span>
          </div>
          <h2 className="sr-only" id="market-pulse-title">Nigerian market indicators</h2>
          <div className="market-pulse-grid">
            {marketPulse.map((item) => (
              <article className="pulse-metric" key={item.key}>
                <span>{item.label}</span>
                <strong>—</strong>
                <small>Awaiting verified feed <i>{item.key}</i></small>
              </article>
            ))}
          </div>
          <div className="pulse-footnote"><span>Market data appears here only after SFI connects an authorized source.</span><span>NO LIVE FEED CONNECTED</span></div>
        </div>
      </section>

      <div className="editorial-main">
        <section className="editorial-hero" aria-labelledby="hero-title">
          <div className="editorial-hero-copy">
            <div className="editorial-kicker green-kicker">SAMUEL FINANCIAL INTELLIGENCE <span /> NIGERIA</div>
            <h1 id="hero-title">Clarity on markets.<br /><em>Intelligence for capital.</em></h1>
            <p>Market data, company research and economic context for people building a clearer view of Nigeria’s financial markets.</p>
            <div className="editorial-hero-actions">
              <button className="primary-editorial-button" onClick={() => selectNav("Markets")}>Explore the market <span>→</span></button>
              <button className="quiet-editorial-button" onClick={() => selectNav("Research")}>Browse research <span>↗</span></button>
            </div>
            <div className="editorial-hero-note"><span>01</span> TRUSTED SOURCES · TRACEABLE ANALYSIS</div>
          </div>
          <div className="editorial-hero-art" aria-label="Abstract illustration representing market intelligence">
            <div className="art-grid" />
            <div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-ring ring-three" />
            <div className="art-center"><span>SFI</span><small>MARKET<br />INTELLIGENCE</small></div>
            <div className="art-caption"><span>NG · FINANCIAL MARKETS</span><b>INSIGHT, WITH EVIDENCE</b></div>
          </div>
        </section>

        <section className="editorial-section intelligence-section" id="intelligence" aria-labelledby="intelligence-title">
          <div className="section-heading editorial-section-heading">
            <div><span className="editorial-kicker green-kicker">THE INTELLIGENCE BRIEF</span><h2 id="intelligence-title">Context for the moves<br className="desktop-break" /> that matter.</h2></div>
            <p>Independent market information, company analysis and research in one Nigerian financial workspace.</p>
          </div>
          <div className="intelligence-grid">
            <article className="intelligence-card feature-card">
              <div className="feature-visual"><span className="feature-index">SFI / RESEARCH</span><div className="feature-lines"><i /><i /><i /><i /></div><span className="feature-stamp">NIGERIA<br />MARKET<br />INTELLIGENCE</span></div>
              <div className="feature-content"><span className="editorial-kicker green-kicker">RESEARCH & ANALYSIS</span><h3>Evidence-led perspectives on Nigeria’s capital markets.</h3><p>SFI research and verified market commentary will appear here once approved for publication.</p><button onClick={() => selectNav("Research")}>Explore research <span>→</span></button></div>
            </article>
            <article className="intelligence-card story-card">
              <div className="story-card-top"><span className="story-category">MARKET NEWS</span><span className="story-icon">↗</span></div>
              <div><h3>Follow the developments shaping the market.</h3><p>Company announcements and financial news will be listed with their original sources and publication dates.</p></div>
              <div className="empty-editorial-state"><span>—</span><small>No approved stories published yet</small></div>
              <button onClick={() => selectNav("News")}>Visit the news desk <span>→</span></button>
            </article>
            <article className="intelligence-card company-card">
              <div className="story-card-top"><span className="story-category">COMPANY INTELLIGENCE</span><span className="story-icon">▦</span></div>
              <div><h3>Understand the businesses behind the symbols.</h3><p>Traceable financial statements, company profiles and comparisons, organized by issuer and reporting period.</p></div>
              <div className="empty-editorial-state"><span>—</span><small>Company coverage is being prepared</small></div>
              <button onClick={() => selectNav("Companies")}>Explore companies <span>→</span></button>
            </article>
          </div>
        </section>

        <section className="market-glance-section" id="market-glance" aria-labelledby="market-glance-title">
          <div className="section-heading market-section-heading">
            <div><span className="editorial-kicker green-kicker">THE MARKET AT A GLANCE</span><h2 id="market-glance-title">Stocks in focus.</h2></div>
            <button className="market-section-link" onClick={() => selectNav("Equities")}>Explore equities <span>→</span></button>
          </div>
          <div className="market-glance-card">
            <div className="market-table-heading"><span>NGX LISTED COMPANIES</span><span>PRICE & DAILY CHANGE</span><span>DATA SOURCE</span></div>
            <div className="market-empty"><div className="market-empty-mark">◌</div><div><strong>No authorized market feed connected</strong><p>Share prices, daily movements and company coverage will appear here after SFI configures licensed NGX data access.</p></div><span className="pending-label">AWAITING VERIFIED FEED</span></div>
            <div className="market-glance-foot"><span>Quotes are not displayed until their source and redistribution terms are approved.</span><span>NGX · —</span></div>
          </div>
        </section>

        <section className="editorial-data-grid">
          <article className="data-editorial-card economy-card" id="economy">
            <div className="data-card-heading"><div><span className="editorial-kicker green-kicker">ECONOMIC INTELLIGENCE</span><h2>Signals behind the market.</h2></div><span className="data-card-icon">◎</span></div>
            <p>Key Nigerian indicators, published with the period, release date and source attached.</p>
            <div className="indicator-editorial-list">{indicators.map((item) => <div className="indicator-editorial-row" key={item}><span><i />{item}</span><strong>—</strong><small>Awaiting source</small></div>)}</div>
            <div className="data-card-foot"><span>CBN · NBS</span><button onClick={() => selectNav("Economy")}>Explore indicators <b>→</b></button></div>
          </article>
          <article className="data-editorial-card fixed-income-card" id="fixed-income">
            <div className="data-card-heading"><div><span className="editorial-kicker green-kicker">FIXED INCOME</span><h2>Rates, terms and context.</h2></div><span className="data-card-icon">≋</span></div>
            <p>Government and corporate instruments with clear labels for coupons, auction rates and market yields.</p>
            <div className="fixed-income-empty"><span>—</span><strong>Fixed-income data is not connected</strong><small>DMO · FMDQ · Awaiting permitted data access</small></div>
            <div className="data-card-foot"><span>YIELDS · AUCTIONS · INSTRUMENTS</span><button onClick={() => selectNav("Fixed Income")}>Explore fixed income <b>→</b></button></div>
          </article>
        </section>

        <section className="watchlist-editorial" id="watchlists">
          <div className="watchlist-editorial-icon">☆</div>
          <div><span className="editorial-kicker green-kicker">YOUR MARKET, YOUR VIEW</span><h2>Build a watchlist that matters.</h2><p>Keep the companies and indicators you follow close at hand. Watchlists become available when account storage is configured.</p></div>
          <button onClick={() => selectNav("Watchlists")}>Open watchlists <span>→</span></button>
        </section>

        <section className="ai-editorial-section" id="ai-briefing">
          <div className="ai-editorial-icon">✳</div>
          <div className="ai-editorial-copy"><span className="editorial-kicker">SFI INTELLIGENCE · SOURCE-LED</span><h2>Get the signal, with the sources.</h2><p>AI summaries and analysis will be grounded in validated market data and approved documents. Citations and “as of” times stay attached.</p></div>
          <div className="ai-editorial-status"><span /><strong>AWAITING CONNECTED SOURCES</strong><small>AI briefing is not active yet</small></div>
        </section>

        <footer className="editorial-footer">
          <Link className="editorial-brand footer-brand" href="/"><span className="editorial-brand-mark">S<span>•</span></span><span className="editorial-brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link>
          <p>Nigerian financial market intelligence, analytics and research.</p>
          <span className="footer-tagline">CLARITY ON MARKETS. INTELLIGENCE FOR CAPITAL.</span>
          <small>© {new Date().getFullYear()} SAMUEL FINANCIAL INTELLIGENCE</small>
        </footer>
      </div>
      {notice && <div className="editorial-toast" role="status">✓ &nbsp;{notice}</div>}
    </main>
  );
}
