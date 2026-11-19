-- Samuel Terminal — corrections to the document review path.
--
-- Three problems found reviewing stage 2a:
--
--   1. The blanket forbid_update trigger on document_review_events also blocked
--      the foreign key's own `on delete set null`, so deleting any user who had
--      ever reviewed a document raised 42501. Offboarding a person was therefore
--      impossible. The decision must stay immutable, but anonymising its actor is
--      exactly what that foreign key is declared to do.
--
--   2. setting_bool was SECURITY DEFINER, took an arbitrary key and was granted to
--      `authenticated`, which read straight past the staff-only select policy on
--      platform_settings. The grant was never needed: review_document is itself a
--      definer function.
--
--   3. setting_bool cast the stored value with no type check, so an administrator
--      writing a non-boolean would make every approval and rejection fail with
--      22P02 until the row was repaired by hand. A settings table must not be able
--      to break the review path.

-- ---------------------------------------------------------------------------
-- 1. A review event is immutable, except for losing its actor
-- ---------------------------------------------------------------------------

create or replace function public.guard_review_event_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- The only change allowed is actor_user_id becoming null, which is what the
  -- foreign key does when the account is deleted. The decision itself — which
  -- document, which transition, the reason, whether it was self-approved, when —
  -- can never change.
  if new.id is distinct from old.id
     or new.document_id is distinct from old.document_id
     or new.from_status is distinct from old.from_status
     or new.to_status is distinct from old.to_status
     or new.reason is distinct from old.reason
     or new.self_approved is distinct from old.self_approved
     or new.created_at is distinct from old.created_at
     or new.actor_user_id is not null then
    raise exception 'A review event is append-only; only its actor may be anonymised'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_review_event_immutable() from public, anon, authenticated;

drop trigger if exists document_review_events_forbid_update on public.document_review_events;
drop trigger if exists document_review_events_guard_immutable on public.document_review_events;
create trigger document_review_events_guard_immutable before update on public.document_review_events
for each row execute function public.guard_review_event_immutable();

-- ---------------------------------------------------------------------------
-- 2. Settings cannot be read past their policy, and cannot break review
-- ---------------------------------------------------------------------------

create or replace function public.setting_bool(setting_key text, fallback boolean)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select case
               when jsonb_typeof(value) = 'boolean' then (value #>> '{}')::boolean
               else null
             end
      from public.platform_settings
      where key = setting_key
    ),
    fallback
  );
$$;

-- Only trusted server code reads settings through this function. Clients that may
-- see settings do so through the table, where the staff-only policy applies.
revoke all on function public.setting_bool(text, boolean) from public, anon, authenticated;
grant execute on function public.setting_bool(text, boolean) to service_role;

-- Reject a value of the wrong shape on the way in, so a mistake is a clear error
-- at the point of the change rather than a surprise later.
create or replace function public.set_platform_setting(
  setting_key text,
  setting_value jsonb,
  actor_user uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  previous jsonb;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user) then
    raise exception 'Actor is not a platform administrator' using errcode = '42501';
  end if;

  select value into previous from public.platform_settings where key = setting_key;
  if previous is null then
    raise exception 'Unknown setting: %', setting_key using errcode = '22023';
  end if;

  if jsonb_typeof(previous) is distinct from jsonb_typeof(setting_value) then
    raise exception 'Setting % is %, not %',
      setting_key, jsonb_typeof(previous), jsonb_typeof(setting_value)
      using errcode = '22023';
  end if;

  update public.platform_settings
     set value = setting_value, updated_by = actor_user, updated_at = now()
   where key = setting_key;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'platform.setting.changed',
    jsonb_build_object('key', setting_key, 'from', previous, 'to', setting_value)
  );
end;
$$;

revoke all on function public.set_platform_setting(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.set_platform_setting(text, jsonb, uuid) to service_role;
