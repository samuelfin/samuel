import { buildXlsx } from "@/lib/export/xlsx";
import { fiveYearFilename } from "@/lib/export/five-year";
import { companyForTab } from "../shared";
import { fiveYearWorkbook } from "../five-year/data";

/**
 * The five-year comparison as a workbook.
 *
 * Read through the reader's own session, so the file contains exactly what the
 * page would show them: approved figures, of an approved company, whose dataset
 * is licensed for display. Switch the licence off and the figures leave the file
 * at the same moment they leave the screen, because both ask the same views the
 * same way.
 *
 * Not cached. A figure can be corrected, a licence can be withdrawn, and a
 * cached workbook would outlive both.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await companyForTab(slug, "");
  const { sheets, years } = await fiveYearWorkbook(company);
  const bytes = buildXlsx(sheets);

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        'attachment; filename="' + fiveYearFilename(company.slug, years) + '"',
      "content-length": String(bytes.length),
      "cache-control": "no-store, max-age=0",
    },
  });
}
