-- Samuel Terminal — a released company address resolves to whoever had it last.
--
-- 202611210001 introduced company_slug_for_former_slug ordered by `v.version
-- desc`, with a comment claiming that "an address released by one company and
-- later taken by another resolves to whoever had it last". It does not. The
-- version number counts within a single company, so comparing it across two
-- companies is meaningless: a company that took the address as its first profile
-- holds it at version 1, and another that took it after three renames holds it at
-- version 4, regardless of which of them had it more recently. The higher number
-- wins, which is arbitrary with respect to time — and on a tie, both at version
-- 1, the answer is whichever row the planner happened to return first.
--
-- changed_at is chronological across the whole table, so it answers the question
-- the function is actually asking. The version number stays as the tiebreaker,
-- where it is meaningful: within one company, two versions written in the same
-- transaction share a timestamp and the later number is the later state.
--
-- Found while writing the equivalent function for people, where two namesakes
-- sharing an address is not a corner case but the expected one.

create or replace function public.company_slug_for_former_slug(former text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.slug
    from public.company_profile_versions v
    join public.companies c on c.id = v.company_id
   where v.slug = former
     and c.slug <> former
     and c.review_status = 'approved'
   order by v.changed_at desc, v.version desc
   limit 1;
$$;

-- Restated because CREATE OR REPLACE keeps the privileges already on the
-- function, and a migration should not depend on what an earlier one happened to
-- leave behind.
revoke all on function public.company_slug_for_former_slug(text) from public, anon;
grant execute on function public.company_slug_for_former_slug(text) to authenticated, service_role;
