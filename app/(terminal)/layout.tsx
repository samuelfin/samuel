import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth/session";
import { TerminalShell } from "@/components/terminal/terminal-shell";

/**
 * Shared terminal frame. The layout fetches the user for the shell UI; each page's
 * data services re-verify the session (layouts don't re-run on client navigation).
 */
export default async function TerminalLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <TerminalShell user={user}>{children}</TerminalShell>;
}
