import Link from "next/link";

export default function NotFound() {
  return (
    <main className="standalone">
      <div className="error-state">
        <span className="page-code">404</span>
        <h1>Page not found</h1>
        <p>This address is not part of Samuel Terminal.</p>
        <div className="error-actions">
          <Link className="btn btn-primary" href="/">Go to Overview</Link>
        </div>
      </div>
    </main>
  );
}
