import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/terminal/ui";
import { companyForTab, companyTabMetadata, panel } from "../shared";
import { fiveYearWorkbook } from "./data";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return companyTabMetadata(slug, "Five-year comparison");
}

/**
 * The printable five-year comparison.
 *
 * The same sheets the workbook carries, rendered as tables: one assembler, two
 * renderings, so the PDF a reader prints and the file they download cannot say
 * different things. Printing is the PDF route for now — a generated PDF is a
 * second layout to keep in step with this one, and this one is already the
 * workbook's content.
 */
export default async function FiveYearPage({ params }: Props) {
  const { slug } = await params;
  const company = await companyForTab(slug, "");
  const workbook = await panel(fiveYearWorkbook(company), "Could not assemble the comparison.");

  return (
    <article className="five-year">
      <header className="five-year-head">
        <div>
          <p className="five-year-eyebrow">Samuel Financial Intelligence</p>
          <h1>{company.name} — five-year comparison</h1>
        </div>
        <nav className="five-year-actions">
          <Link href={"/companies/" + company.slug}>Back to the company</Link>
          <a href={"/companies/" + company.slug + "/five-year.xlsx"}>Download as Excel</a>
          <span>Print this page to save it as a PDF.</span>
        </nav>
      </header>

      {!workbook.ok ? (
        <Notice tone="caution">{workbook.error}</Notice>
      ) : (
        workbook.data.sheets.map((sheet) => (
          <section className="five-year-sheet" key={sheet.name}>
            <h2>{sheet.name}</h2>
            <table className="figure-table">
              <tbody>
                {sheet.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell === null ? "" : String(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </article>
  );
}
