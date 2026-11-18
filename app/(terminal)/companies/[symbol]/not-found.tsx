import Link from "next/link";

export default function CompanyNotFound() {
  return (
    <div className="error-state">
      <span className="page-code">CO</span>
      <h1>Not a valid NGX symbol</h1>
      <p>Symbols use letters and digits, for example a ticker shown on the exchange. Check the symbol and try again.</p>
      <div className="error-actions">
        <Link className="btn btn-primary" href="/companies">Company directory</Link>
      </div>
    </div>
  );
}
