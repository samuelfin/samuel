-- Samuel Terminal — a person's address keeps working after a rename.
--
-- People get renamed more often than companies do: a married name, a corrected
-- spelling, an honorific added once a filing uses it. The history already holds
-- every address a person has had, so the redirect needs no new table — it needs a
-- way for a reader to ask the question, because person_versions is analyst-only
-- and a reader cannot query it.
--
-- This function answers exactly one question — "which published person used to
-- live at this address?" — and nothing else.
--
-- "Published" is stricter here than it is for a company, and deliberately. A
-- company page is worth showing on the strength of the company record alone. A
-- person page is not: a page carrying a named private individual and no sourced
-- claim about them would be the one thing this register is built not to publish.
-- So a person is resolvable only when at least one office they hold is visible —
-- approved, not withdrawn, at an approved company. That is the same condition
-- /people/[slug] renders on and the same one the directory lists on, so this
-- function can never name somebody a reader could not already see.
--
-- The visibility test is spelled out rather than left to row-level security
-- because a security-definer function runs as its owner and bypasses policies
-- entirely. Relying on them here would publish every approved name on the
-- register.

create or replace function public.person_slug_for_former_slug(former text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.slug
    from public.person_versions v
    join public.people p on p.id = v.person_id
   where v.slug = former
     and p.slug <> former
     and p.review_status = 'approved'
     and exists (
       select 1
         from public.company_roles r
         join public.companies c on c.id = r.company_id
        where r.person_id = p.id
          and r.review_status = 'approved'
          and r.withdrawn_at is null
          and c.review_status = 'approved'
     )
   -- Ordered by when the version was written, not by its number. The number
   -- counts within one person, so comparing it across two people is meaningless:
   -- an address released by one and later taken by a namesake leaves both of them
   -- holding it at their own version 1, and ordering by number picks between them
   -- arbitrarily. changed_at is chronological across the whole table, so the
   -- person who held the address last is the one who wins. The version number
   -- breaks a tie within a single person.
   order by v.changed_at desc, v.version desc
   limit 1;
$$;

revoke all on function public.person_slug_for_former_slug(text) from public, anon;
grant execute on function public.person_slug_for_former_slug(text) to authenticated, service_role;

create index if not exists person_versions_slug_idx on public.person_versions (slug);
