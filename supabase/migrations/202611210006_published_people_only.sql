-- Samuel Terminal — a name is readable only where a sourced claim backs it.
--
-- Stage 3b decided that a page carrying a named private individual and no
-- sourced claim about them is the one thing this register must not publish.
-- Three layers implemented it: /people/[slug] returns 404 when nothing is
-- visible, the directory is built from the offices so a bare name never reaches
-- it, and person_slug_for_former_slug refuses to name anyone whose offices are
-- all unpublished.
--
-- The fourth layer — the row-level security policy, which is the only one that
-- is actually a boundary — did not. It admitted any approved person:
--
--   using (review_status = 'approved' or is_platform_admin() or has_staff_role(...))
--
-- So a signed-in reader querying `people` directly got every approved name,
-- including people whose only office is a claim nobody has reviewed, a claim at
-- a company nobody has approved, or a claim we withdrew *because it was wrong*.
-- The pages were honest and the data was not, which is the wrong way round: the
-- pages are a convention and the policy is the rule.
--
-- Why this needs a function rather than an EXISTS in the policy
-- ------------------------------------------------------------
-- The obvious fix — `exists (select 1 from company_roles ...)` inside the people
-- policy — recurses. The company_roles policy already consults `people`, so each
-- policy would evaluate the other and PostgreSQL raises "infinite recursion
-- detected in policy". A SECURITY DEFINER function runs as its owner, and the
-- owner is not subject to row-level security, so the check terminates. That is
-- the same reason person_slug_for_former_slug spells its visibility test out
-- rather than leaning on the policies.
--
-- Both sides of the relationship now ask a function instead of a policy, so no
-- policy on these tables depends on another policy. That removes the recursion
-- hazard rather than arranging the predicates so it happens not to fire.

-- ---------------------------------------------------------------------------
-- 1. One definition of "published", used everywhere
-- ---------------------------------------------------------------------------

create or replace function public.person_is_approved(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.people p where p.id = target and p.review_status = 'approved');
$$;

-- An office a reader may see: approved, not withdrawn, at an approved company.
-- The company test is the one that matters most — without it the register would
-- publish the officers of a company nobody has reviewed.
create or replace function public.person_has_visible_office(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.company_roles r
      join public.companies c on c.id = r.company_id
     where r.person_id = target
       and r.review_status = 'approved'
       and r.withdrawn_at is null
       and c.review_status = 'approved'
  );
$$;

revoke all on function public.person_is_approved(uuid) from public;
revoke all on function public.person_has_visible_office(uuid) from public;
grant execute on function public.person_is_approved(uuid) to authenticated, service_role;
grant execute on function public.person_has_visible_office(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. A reader sees a person only once something about them is published
-- ---------------------------------------------------------------------------

drop policy if exists "Readers see approved people" on public.people;
drop policy if exists "Readers see published people" on public.people;
create policy "Readers see published people" on public.people
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst'])
  or (review_status = 'approved' and public.person_has_visible_office(id))
);

-- The office policy asks the same question through a function rather than
-- through the people policy. Behaviour is unchanged; what changes is that these
-- two policies no longer evaluate each other.
drop policy if exists "Readers see approved leadership" on public.company_roles;
create policy "Readers see approved leadership" on public.company_roles
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst'])
  or (
    review_status = 'approved'
    and withdrawn_at is null
    and public.person_is_approved(person_id)
    and exists (
      select 1 from public.companies c where c.id = company_id and c.review_status = 'approved'
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3. The redirect oracle reuses the same definition
-- ---------------------------------------------------------------------------

-- Unchanged in behaviour, restated so that "published person" has exactly one
-- definition in the schema. Two copies of this condition is how the policy and
-- the pages drifted apart in the first place.
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
     and public.person_has_visible_office(p.id)
   order by v.changed_at desc, v.version desc
   limit 1;
$$;

revoke all on function public.person_slug_for_former_slug(text) from public, anon;
grant execute on function public.person_slug_for_former_slug(text) to authenticated, service_role;
