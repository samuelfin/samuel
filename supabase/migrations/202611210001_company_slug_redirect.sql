-- Samuel Terminal — an address a reader already has keeps working.
--
-- A company's web address is its slug, and renaming a company changes it. Every
-- link already shared — in a message, a bookmark, a cited article — would break.
-- The history already holds the old addresses, so the redirect needs no new
-- table; it needs a way for a reader to ask the question.
--
-- company_profile_versions is staff-only, deliberately: who changed what and why
-- is for the desk. So a reader cannot resolve an old address by querying it. This
-- function answers exactly one question — "which approved company used to live at
-- this address?" — and nothing else. It cannot name a pending or rejected
-- company, and every company it can name is already in the public directory.

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
   -- The most recent version carrying this address wins, so an address released
   -- by one company and later taken by another resolves to whoever had it last.
   order by v.version desc
   limit 1;
$$;

revoke all on function public.company_slug_for_former_slug(text) from public, anon;
grant execute on function public.company_slug_for_former_slug(text) to authenticated, service_role;

create index if not exists company_profile_versions_slug_idx
  on public.company_profile_versions (slug);
