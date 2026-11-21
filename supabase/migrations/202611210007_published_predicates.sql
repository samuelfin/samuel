-- Samuel Terminal — a predicate that answers no more than the row does.
--
-- 202611210006 closed the loose `people` policy with two helpers,
-- person_is_approved(uuid) and person_has_visible_office(uuid). Both are
-- SECURITY DEFINER and both must be executable by `authenticated`, because a
-- policy expression is evaluated as the querying role. That left each of them
-- answering a question about rows the policy hides:
--
--   select public.person_is_approved('<uuid>');
--
-- returns true for a person a reader cannot select. This register's own standard
-- says that is not good enough — "a policy that hides a row but answers
-- questions about it is not hiding it" is the wording of the sibling attack test
-- — so the helpers are replaced rather than defended.
--
-- The shape with no oracle in it is a predicate whose answer *is* the policy's
-- answer. person_is_published(id) returns exactly whether a reader may see that
-- person; company_role_is_published(id) exactly whether a reader may see that
-- office. Calling either with any id discloses nothing a SELECT on the row would
-- not already disclose, because it returns the same bit.
--
-- It also makes true a claim 202611210006 made and did not keep. That migration
-- said no policy on these tables depends on another policy, while the
-- company_roles policy still ran an inline `exists (... public.companies ...)`
-- under the companies policy — so a future companies policy consulting
-- company_roles would have reintroduced 42P17 on every reader's leadership
-- query. Both lookups now sit inside the definer functions, where no policy is
-- consulted at all.

-- ---------------------------------------------------------------------------
-- 1. One predicate per table, each returning what its policy returns
-- ---------------------------------------------------------------------------

-- A published office: approved, not withdrawn, held by an approved person at an
-- approved company. The company test is the one that matters most — without it
-- the register would publish the officers of a company nobody has reviewed.
create or replace function public.company_role_is_published(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.company_roles r
      join public.people p on p.id = r.person_id
      join public.companies c on c.id = r.company_id
     where r.id = target
       and r.review_status = 'approved'
       and r.withdrawn_at is null
       and p.review_status = 'approved'
       and c.review_status = 'approved'
  );
$$;

-- A published person: approved, and holding at least one published office. A
-- name with no sourced claim behind it is the one thing this register must not
-- publish, so the absence of an office is the absence of the person.
create or replace function public.person_is_published(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.people p
      join public.company_roles r on r.person_id = p.id
      join public.companies c on c.id = r.company_id
     where p.id = target
       and p.review_status = 'approved'
       and r.review_status = 'approved'
       and r.withdrawn_at is null
       and c.review_status = 'approved'
  );
$$;

revoke all on function public.company_role_is_published(uuid) from public, anon;
revoke all on function public.person_is_published(uuid) from public, anon;
grant execute on function public.company_role_is_published(uuid) to authenticated, service_role;
grant execute on function public.person_is_published(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The redirect oracle, on the same definition
-- ---------------------------------------------------------------------------

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
     and public.person_is_published(p.id)
   order by v.changed_at desc, v.version desc
   limit 1;
$$;

revoke all on function public.person_slug_for_former_slug(text) from public, anon;
grant execute on function public.person_slug_for_former_slug(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The policies, each one predicate wide
-- ---------------------------------------------------------------------------

drop policy if exists "Readers see approved people" on public.people;
drop policy if exists "Readers see published people" on public.people;
create policy "Readers see published people" on public.people
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst'])
  or public.person_is_published(id)
);

drop policy if exists "Readers see approved leadership" on public.company_roles;
create policy "Readers see approved leadership" on public.company_roles
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst'])
  or public.company_role_is_published(id)
);

-- ---------------------------------------------------------------------------
-- 4. Remove what answered more than it should
-- ---------------------------------------------------------------------------

-- Safe to drop now: nothing above references either one, and leaving them in
-- place would leave the oracle reachable by a reader who knows a uuid.
drop function if exists public.person_is_approved(uuid);
drop function if exists public.person_has_visible_office(uuid);
