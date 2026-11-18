"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODULES, MODULE_GROUPS, moduleForPath } from "@/lib/catalog/modules";
import { useShell } from "./shell-context";

export function SidebarNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const active = moduleForPath(pathname);
  const { navOpen, setNavOpen } = useShell();
  const close = () => setNavOpen(false);

  return (
    <>
      <nav
        id="term-nav"
        className={`term-nav${navOpen ? " is-open" : ""}`}
        aria-label="Terminal modules"
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        {MODULE_GROUPS.map((group) => (
          <div className="nav-group" key={group}>
            <div className="nav-group-label">{group}</div>
            <ul>
              {MODULES.filter((m) => m.group === group).map((m) => {
                const isActive = active?.href === m.href;
                return (
                  <li key={m.code}>
                    <Link
                      href={m.href}
                      className={`nav-link${isActive ? " is-active" : ""}`}
                      aria-current={isActive ? "page" : undefined}
                      title={m.description}
                      onClick={close}
                    >
                      <span className="nav-code">{m.code}</span>
                      <span className="nav-label">{m.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {showAdmin && (
          <div className="nav-group">
            <div className="nav-group-label">SFI</div>
            <ul>
              <li>
                <Link href="/admin" className="nav-link" onClick={close}>
                  <span className="nav-code">ADM</span>
                  <span className="nav-label">Administration</span>
                </Link>
              </li>
            </ul>
          </div>
        )}
      </nav>
      {navOpen && <button type="button" className="term-scrim" aria-label="Close navigation" onClick={close} />}
    </>
  );
}
