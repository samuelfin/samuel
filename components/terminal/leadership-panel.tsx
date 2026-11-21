import Link from "next/link";
import { formatTenure, formatTenureDate } from "@/lib/people/validation";
import type { LeadershipMember } from "@/lib/data/people";

/**
 * Who runs a company, on that company's page.
 *
 * Presentational and server-rendered: it receives rows that row-level security
 * has already filtered to approved, non-withdrawn offices held by approved
 * people at an approved company.
 *
 * Every office names the filing page or announcement it rests on, because this
 * is a published statement about a named private individual and a reader has to
 * be able to check it. Where the source carries a public link, the link goes to
 * the issuer's own copy — never to SFI's stored one, which is licensed material
 * behind a signed URL.
 */

function MemberRow({ member }: { member: LeadershipMember }) {
  const tenure = formatTenure(
    member.validFrom,
    member.validFromPrecision,
    member.validTo,
    member.validToPrecision,
  );

  const sourceLabel = member.sourceTitle
    ? member.sourcePage
      ? `${member.sourceTitle}, page ${member.sourcePage}`
      : member.sourceTitle
    : null;

  return (
    <article className="review-row">
      <div className="review-row-main">
        <strong>
          {member.personSlug ? (
            <Link href={`/people/${member.personSlug}`}>
              {member.honorific ? `${member.honorific} ` : ""}
              {member.personName}
            </Link>
          ) : (
            <>
              {member.honorific ? `${member.honorific} ` : ""}
              {member.personName}
            </>
          )}
        </strong>
        <p>
          {member.roleTitle ?? member.roleName}
          {member.isActing ? " (acting)" : ""}
          {tenure ? ` · ${tenure}` : ""}
        </p>
        <p className="review-row-meta">
          {sourceLabel ? (
            member.sourceUri ? (
              <a href={member.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                {sourceLabel}
              </a>
            ) : (
              sourceLabel
            )
          ) : (
            "Source not recorded"
          )}
          {member.lastConfirmedOn
            ? ` · Last confirmed: ${formatTenureDate(member.lastConfirmedOn, "day")}`
            : ""}
        </p>
      </div>
    </article>
  );
}

function Group({ title, members }: { title: string; members: LeadershipMember[] }) {
  if (members.length === 0) return null;
  return (
    <>
      <p className="panel-note">{title}</p>
      <div className="review-list">
        {members.map((member) => (
          <MemberRow member={member} key={member.id} />
        ))}
      </div>
    </>
  );
}

export function LeadershipPanel({ members }: { members: LeadershipMember[] }) {
  if (members.length === 0) {
    return (
      <div className="provider-empty">
        <span className="provider-orbit">◌</span>
        <strong>No data yet</strong>
        <p>
          The board and the executives, with the dates each took office, appear here once an analyst
          has recorded them. Every office cites the filing page or the announcement it comes from,
          so a reader can check it against the company&apos;s own document.
        </p>
      </div>
    );
  }

  const current = members.filter((m) => !m.validTo);
  const former = members.filter((m) => m.validTo);

  // An executive director sits in both groups on a filing; showing them twice
  // would misrepresent the size of the board, so the board takes precedence and
  // the executives list holds those who are not directors.
  const board = current.filter((m) => m.isBoard);
  const executives = current.filter((m) => !m.isBoard && m.isExecutive);
  const others = current.filter((m) => !m.isBoard && !m.isExecutive);

  return (
    <>
      <Group title="BOARD" members={board} />
      <Group title="EXECUTIVES" members={executives} />
      <Group title="OTHER OFFICERS" members={others} />
      <Group title="FORMERLY" members={former} />
      <p className="panel-note">
        Dates are shown exactly as precisely as the source gives them: a filing that says
        &ldquo;2015&rdquo; is shown as 2015, not as a day in January. Offices are recorded as
        reported and are not a judgement of anyone named here.
      </p>
    </>
  );
}
