"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Segment error boundary for administration and the research desk. In this
 * Next.js version the recovery prop is `retry`, not `reset`.
 *
 * The review queue throws rather than rendering an empty list when it cannot be
 * read, because an empty queue and a failed query look the same to a reviewer.
 * This is what they see instead.
 */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    error instanceof Error && "digest" in error
      ? String((error as Error & { digest?: string }).digest ?? "")
      : "";

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="standalone">
      <div className="error-state" role="alert">
        <span className="page-code">ERR</span>
        <h1>This page could not be loaded</h1>
        <p>
          Nothing is shown in its place: an empty review queue would be
          indistinguishable from a working one. Try again, or return to the terminal.
        </p>
        {digest && (
          <p className="error-digest">
            Reference <code>{digest}</code>
          </p>
        )}
        <div className="error-actions">
          <button type="button" className="btn btn-primary" onClick={() => retry()}>
            Try again
          </button>
          <Link className="btn" href="/">
            Terminal
          </Link>
        </div>
      </div>
    </main>
  );
}
