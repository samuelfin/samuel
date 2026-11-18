"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Segment error boundary for the terminal. In this Next.js version the recovery prop is `retry`. */
export default function TerminalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="error-state" role="alert">
      <span className="page-code">ERR</span>
      <h1>This view could not be loaded</h1>
      <p>No partial or cached figures are shown in its place. Try again, or return to the overview.</p>
      {digest && <p className="error-digest">Reference <code>{digest}</code></p>}
      <div className="error-actions">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Try again</button>
        <Link className="btn" href="/">Overview</Link>
      </div>
    </div>
  );
}
