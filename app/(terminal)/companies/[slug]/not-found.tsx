import Link from "next/link";

/**
 * Reached when an address matches no company, no former address of one, and no
 * live ticker. Worth its own page rather than the generic 404: whoever is here
 * wanted a particular company, and the directory is the next thing they need.
 */
export default function CompanyNotFound() {
  return (
    <div className="error-state">
      <span className="page-code">CO</span>
      <h1>No such company</h1>
      <p>
        A company page can be reached by its address, such as /companies/dangote-cement, or by its
        NGX ticker. Nothing matches either here, and no company has previously used this address.
      </p>
      <div className="error-actions">
        <Link className="btn btn-primary" href="/companies">
          Company directory
        </Link>
      </div>
    </div>
  );
}
