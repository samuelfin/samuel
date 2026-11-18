import type { ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import type { SessionUser } from "@/lib/auth/session";
import { connectedDatasetCount } from "@/lib/providers/registry";
import { ShellProvider, NavToggle } from "./shell-context";
import { SidebarNav } from "./sidebar-nav";
import { GlobalSearch } from "./global-search";
import { WatClock } from "./wat-clock";

/** Persistent terminal frame: command bar, module navigation, content and status bar. */
export function TerminalShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const feeds = connectedDatasetCount();
  const isPreview = user.mode === "local_preview";

  return (
    <ShellProvider>
      <div className="term">
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="term-top">
          <NavToggle />
          <Link href="/" className="term-brand" aria-label="Samuel Terminal — Overview">
            <span className="term-mark" aria-hidden="true">S</span>
            <span className="term-brand-text"><strong>SAMUEL</strong> TERMINAL</span>
          </Link>
          <GlobalSearch />
          <div className="term-top-meta">
            <span
              className={`feed-pill ${feeds ? "is-on" : "is-off"}`}
              title={feeds ? `${feeds} authorised datasets connected` : "No authorised market data feed is connected"}
            >
              <i aria-hidden="true" />
              {feeds ? `${feeds} feeds` : "No live feed"}
            </span>
            <WatClock />
            <div className="term-user">
              <span className="term-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="term-user-name">{user.name}</span>
              {isPreview ? (
                <span className="preview-pill" title="Supabase is not configured; running without authentication in development only">Local preview</span>
              ) : (
                <form action={signOut}>
                  <button type="submit" className="term-signout">Sign out</button>
                </form>
              )}
            </div>
          </div>
        </header>
        <SidebarNav showAdmin={user.isPlatformAdmin && !isPreview} />
        <main id="main" className="term-main" tabIndex={-1}>
          {children}
        </main>
        <footer className="term-status">
          <span><b>NG</b> All times WAT (UTC+1)</span>
          <span className="term-status-wide">Values are shown only from authorised, attributed sources. Information only — not investment advice.</span>
          <span>{isPreview ? "LOCAL PREVIEW · AUTH NOT CONFIGURED" : "SFI · v0.1"}</span>
        </footer>
      </div>
    </ShellProvider>
  );
}
