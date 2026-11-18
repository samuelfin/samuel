-- Samuel Terminal Phase 1 foundation.
-- Apply with Supabase CLI or the Supabase SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organisation_members (
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

-- The table has no client write policy: bootstrap and role changes are controlled
-- through the Supabase dashboard or a trusted server-side administrative process.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  subject_user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 120),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists organisations_set_updated_at on public.organisations;
create trigger organisations_set_updated_at before update on public.organisations
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_admins a where a.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_organisation_member(target_organisation uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.organisation_members m
    where m.organisation_id = target_organisation and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_organisation_role(target_organisation uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.organisation_members m
    where m.organisation_id = target_organisation
      and m.user_id = (select auth.uid())
      and m.role = any (allowed_roles)
  );
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_organisation_member(uuid) from public;
revoke all on function public.has_organisation_role(uuid, text[]) from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_organisation_member(uuid) to authenticated;
grant execute on function public.has_organisation_role(uuid, text[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.platform_admins enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.profiles, public.organisations, public.organisation_members, public.platform_admins, public.audit_logs from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.organisations, public.organisation_members to authenticated;
grant all on public.platform_admins, public.audit_logs to service_role;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile" on public.profiles
for select to authenticated using (id = (select auth.uid()));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "Members can view their organisations" on public.organisations;
create policy "Members can view their organisations" on public.organisations
for select to authenticated using (public.is_organisation_member(id) or public.is_platform_admin());

drop policy if exists "Members can view their organisation roster" on public.organisation_members;
create policy "Members can view their organisation roster" on public.organisation_members
for select to authenticated using (public.is_organisation_member(organisation_id) or public.is_platform_admin());

drop policy if exists "Organisation admins can add members" on public.organisation_members;
create policy "Organisation admins can add members" on public.organisation_members
for insert to authenticated with check (
  public.has_organisation_role(organisation_id, array['owner', 'admin']) or public.is_platform_admin()
);

drop policy if exists "Organisation admins can update members" on public.organisation_members;
create policy "Organisation admins can update members" on public.organisation_members
for update to authenticated using (
  public.has_organisation_role(organisation_id, array['owner', 'admin']) or public.is_platform_admin()
) with check (
  public.has_organisation_role(organisation_id, array['owner', 'admin']) or public.is_platform_admin()
);

drop policy if exists "Organisation admins can remove members" on public.organisation_members;
create policy "Organisation admins can remove members" on public.organisation_members
for delete to authenticated using (
  public.has_organisation_role(organisation_id, array['owner', 'admin']) or public.is_platform_admin()
);

-- Intentionally no client policies on platform_admins. Membership must be granted
-- through a trusted administrative channel, never by an end-user request.

create or replace function public.set_platform_admin(target_user uuid, actor_user uuid, should_grant boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_rows integer;
  admin_count integer;
begin
  lock table public.platform_admins in exclusive mode;

  if not exists (select 1 from public.platform_admins where user_id = actor_user) then
    raise exception 'Actor is not a platform administrator' using errcode = '42501';
  end if;

  if should_grant then
    insert into public.platform_admins (user_id, granted_by)
    values (target_user, actor_user)
    on conflict (user_id) do nothing;
    get diagnostics changed_rows = row_count;
    if changed_rows > 0 then
      insert into public.audit_logs (actor_user_id, subject_user_id, action)
      values (actor_user, target_user, 'access.platform_admin.granted');
    end if;
  else
    select count(*) into admin_count from public.platform_admins;
    if admin_count <= 1 and exists (select 1 from public.platform_admins where user_id = target_user) then
      raise exception 'The last platform administrator cannot be removed' using errcode = '23514';
    end if;

    delete from public.platform_admins where user_id = target_user;
    get diagnostics changed_rows = row_count;
    if changed_rows > 0 then
      insert into public.audit_logs (actor_user_id, subject_user_id, action)
      values (actor_user, target_user, 'access.platform_admin.revoked');
    end if;
  end if;
end;
$$;

revoke all on function public.set_platform_admin(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_platform_admin(uuid, uuid, boolean) to service_role;
