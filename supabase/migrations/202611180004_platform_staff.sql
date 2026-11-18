-- Samuel Terminal — internal staff roles.
--
-- Editorial work needs its own roles. Overloading `platform_admins` would hand
-- every copy editor control over licence terms, dataset activation and admin
-- grants, so staff roles are held in a separate table and checked separately.
--
-- A person may hold several roles — an analyst is often also a fact-checker — so
-- the key is (user_id, role) rather than one row per person.
--
-- Like platform_admins, this table has no client write policy. Roles are granted
-- through `set_platform_staff_role`, which only a platform administrator can
-- authorise and which records every change in the audit log.

create table if not exists public.platform_staff (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('editor', 'analyst', 'fact_checker', 'publisher')),
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- True when the current user holds any staff role. Deliberately does not treat a
-- platform administrator as staff: administering the platform and writing for it
-- are different jobs. Policies that want both say so explicitly.
create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff s where s.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_staff_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_staff s
    where s.user_id = (select auth.uid())
      and s.role = any (allowed_roles)
  );
$$;

revoke all on function public.is_platform_staff() from public;
revoke all on function public.has_staff_role(text[]) from public;
grant execute on function public.is_platform_staff() to authenticated;
grant execute on function public.has_staff_role(text[]) to authenticated;

alter table public.platform_staff enable row level security;

revoke all on public.platform_staff from anon, authenticated;
grant select on public.platform_staff to authenticated;
grant all on public.platform_staff to service_role;

-- A person may see the roles they hold; administrators see the whole roster.
-- There is no insert, update or delete policy: see set_platform_staff_role.
drop policy if exists "Users can view their own staff roles" on public.platform_staff;
create policy "Users can view their own staff roles" on public.platform_staff
for select to authenticated using (user_id = (select auth.uid()) or public.is_platform_admin());

create or replace function public.set_platform_staff_role(
  target_user uuid,
  actor_user uuid,
  target_role text,
  should_grant boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_rows integer;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user) then
    raise exception 'Actor is not a platform administrator' using errcode = '42501';
  end if;

  if target_role not in ('editor', 'analyst', 'fact_checker', 'publisher') then
    raise exception 'Unknown staff role: %', target_role using errcode = '22023';
  end if;

  if should_grant then
    insert into public.platform_staff (user_id, role, granted_by)
    values (target_user, target_role, actor_user)
    on conflict (user_id, role) do nothing;
    get diagnostics changed_rows = row_count;
    if changed_rows > 0 then
      insert into public.audit_logs (actor_user_id, subject_user_id, action, details)
      values (actor_user, target_user, 'access.staff_role.granted', jsonb_build_object('role', target_role));
    end if;
  else
    delete from public.platform_staff where user_id = target_user and role = target_role;
    get diagnostics changed_rows = row_count;
    if changed_rows > 0 then
      insert into public.audit_logs (actor_user_id, subject_user_id, action, details)
      values (actor_user, target_user, 'access.staff_role.revoked', jsonb_build_object('role', target_role));
    end if;
  end if;
end;
$$;

revoke all on function public.set_platform_staff_role(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_platform_staff_role(uuid, uuid, text, boolean) to service_role;
