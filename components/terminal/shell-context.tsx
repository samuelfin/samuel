"use client";

import { createContext, use, useState, type ReactNode } from "react";

interface ShellState {
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

/** Client state shared by the shell: currently just the mobile navigation drawer. */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  return <ShellContext value={{ navOpen, setNavOpen }}>{children}</ShellContext>;
}

export function useShell(): ShellState {
  const ctx = use(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

export function NavToggle() {
  const { navOpen, setNavOpen } = useShell();
  return (
    <button
      type="button"
      className="term-nav-toggle"
      aria-controls="term-nav"
      aria-expanded={navOpen}
      aria-label={navOpen ? "Close navigation" : "Open navigation"}
      onClick={() => setNavOpen(!navOpen)}
    >
      <span aria-hidden="true">{navOpen ? "✕" : "☰"}</span>
    </button>
  );
}
