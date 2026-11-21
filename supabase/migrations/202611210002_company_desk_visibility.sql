-- Samuel Terminal — the registry desk can see the queue it is meant to work.
--
-- The only select policy on companies admitted approved rows or a platform
-- administrator:
--
--   using (review_status = 'approved' or public.is_platform_admin())
--
-- is_platform_staff() was never admitted. An analyst who is not also a platform
-- admin therefore saw an always-empty review queue, and following an edit link to
-- a pending company got nothing back — while upsert_company_profile and
-- review_company would have let that same analyst act on it. The desk's entire
-- purpose failed for the one role it was built for.
--
-- Stage 3a's tests could not catch it. They drive the functions as the migration
-- owner, where no policy applies at all, and the one place they did read as a
-- signed-in analyst was company_profile_versions, which the 3a.1 migration gave
-- a staff policy. The table it hangs off never got the matching one.
--
-- The same gap applied to the ticker: an analyst could not see the instrument or
-- the identifier belonging to a company awaiting review, so the desk could not
-- show the symbol it had itself just recorded.
--
-- Readers are unaffected. These policies are additive and admit staff only;
-- anyone without the analyst role still sees approved rows and nothing else.

-- Analysts run the registry; editors do not. Scoped to the role that actually
-- writes these records rather than to staff in general, matching the role check
-- inside upsert_company_profile and review_company.
drop policy if exists "Staff can view every company" on public.companies;
create policy "Staff can view every company" on public.companies
for select to authenticated using (public.has_staff_role(array['analyst']));

drop policy if exists "Staff can view every company identifier" on public.company_identifiers;
create policy "Staff can view every company identifier" on public.company_identifiers
for select to authenticated using (public.has_staff_role(array['analyst']));

-- The ticker lives here, and the desk has to show the symbol it has just
-- recorded against a company nobody has approved yet.
drop policy if exists "Staff can view every instrument" on public.instruments;
create policy "Staff can view every instrument" on public.instruments
for select to authenticated using (public.has_staff_role(array['analyst']));

drop policy if exists "Staff can view every instrument identifier" on public.instrument_identifiers;
create policy "Staff can view every instrument identifier" on public.instrument_identifiers
for select to authenticated using (public.has_staff_role(array['analyst']));

-- And close a gap in the other direction. 202611200003 gave the profile history
-- to is_platform_staff(), which is any staff row at all, so an editor, a
-- fact-checker or a publisher could read the full snapshot of a company nobody
-- has approved — its name, description and symbol — while being unable to see
-- the company row itself. The history is the registry's working record, so it
-- belongs to the role that keeps the registry.
drop policy if exists "Staff see company profile history" on public.company_profile_versions;
create policy "Staff see company profile history" on public.company_profile_versions
for select to authenticated using (
  public.is_platform_admin() or public.has_staff_role(array['analyst'])
);
