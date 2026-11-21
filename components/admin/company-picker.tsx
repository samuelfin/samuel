"use client";

import type { CompanyOption } from "@/lib/data/companies";

/**
 * The issuer selector shared by the document, announcement and editorial desks.
 *
 * It offers only approved companies, and the actions behind it resolve whatever
 * is posted against the register anyway — the list is a convenience, not the
 * control. "Not about one company" is a real answer: a regulator circular, a
 * statistical release or a market-wide piece belongs to no single issuer, and
 * forcing a choice would produce a wrong one.
 */
export function CompanyPicker({
  companies,
  defaultValue,
  label = "Company",
  hint,
}: {
  companies: CompanyOption[];
  defaultValue?: string | null;
  label?: string;
  hint?: string;
}) {
  if (companies.length === 0) {
    return (
      <p className="panel-note">
        No company has been approved yet, so this cannot be attached to one. Add one on the company
        desk first; until then it will not appear on any company page.
      </p>
    );
  }

  return (
    <label>
      {label} <small>{hint ?? "Optional — leave blank if it is not about one company"}</small>
      <select name="companyId" defaultValue={defaultValue ?? ""}>
        <option value="">Not about one company</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.symbol ? `${company.symbol} — ${company.name}` : company.name}
          </option>
        ))}
      </select>
    </label>
  );
}
