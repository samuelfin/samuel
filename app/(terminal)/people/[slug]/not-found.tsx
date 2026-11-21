import Link from "next/link";

/**
 * Reached when an address matches nobody and no former address of anybody — and
 * also when it matches a person who holds no office a reader may see. That
 * second case is deliberate: a page carrying a named private individual and no
 * sourced claim about them is not worth publishing, so an approved name with
 * nothing approved against it is treated as absent rather than shown empty.
 */
export default function PersonNotFound() {
  return (
    <div className="error-state">
      <span className="page-code">LD</span>
      <h1>No such person</h1>
      <p>
        Nobody on the register uses this address, and nobody has used it before. A person appears
        here only once an office they hold has been recorded from a filing and checked, so a name
        alone is never published.
      </p>
      <div className="error-actions">
        <Link className="btn btn-primary" href="/people">
          Leadership directory
        </Link>
        <Link className="btn" href="/companies">
          Company directory
        </Link>
      </div>
    </div>
  );
}
