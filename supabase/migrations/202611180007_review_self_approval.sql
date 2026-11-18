-- Samuel Terminal — self-approval, recorded and switchable.
--
-- Two-person review is where this is heading: the person who uploads a document
-- should not be the person who clears it. The desk is too small for that today, so
-- self-approval is allowed — but it is never silent. Every self-approval is marked
-- on the review event, shown in the desk, and carried into the audit log, so the
-- backlog of work that nobody else checked is visible rather than implied.
--
-- `review.require_two_person` turns enforcement on without a code change. When it
-- is true, the uploader is refused and someone else has to decide.
--
-- Self-approval only concerns approval. Rejecting your own upload withdraws your
-- own work and needs no second pair of eyes.

-- ---------------------------------------------------------------------------
-- 1. Platform settings
-- ---------------------------------------------------------------------------

create table if not exists public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  value jsonb not null,
  description text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (key, value, description) values
  (
    'review.require_two_person',
    'false'::jsonb,
    'When true, the uploader of a document may not approve it. Turn on once the desk has two reviewers.'
  )
on conflict (key) do nothing;

create or replace function public.setting_bool(setting_key text, fallback boolean)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select (value #>> '{}')::boolean from public.platform_settings where key = setting_key),
    fallback
  );
$$;

revoke all on function public.setting_bool(text, boolean) from public;
grant execute on function public.setting_bool(text, boolean) to authenticated;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;

-- Staff and administrators can read the rules they work under. Nobody writes from
-- a client session: see set_platform_setting.
drop policy if exists "Staff can read platform settings" on public.platform_settings;
create policy "Staff can read platform settings" on public.platform_settings
for select to authenticated using (
  public.is_platform_admin() or public.is_platform_staff()
);

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

-- ---------------------------------------------------------------------------
-- 2. Mark self-approval on the review event
-- ---------------------------------------------------------------------------

alter table public.document_review_events
  add column if not exists self_approved boolean not null default false;

create index if not exists document_review_events_self_approved_idx
  on public.document_review_events (created_at desc) where self_approved;

-- ---------------------------------------------------------------------------
-- 3. Review, now aware of who uploaded the document
-- ---------------------------------------------------------------------------

create or replace function public.review_document(
  target_document uuid,
  actor_user uuid,
  new_status text,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_status text;
  stored_path text;
  uploader uuid;
  self_approval boolean := false;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role in ('analyst', 'editor')
     ) then
    raise exception 'Actor may not review documents' using errcode = '42501';
  end if;

  select review_status, storage_path, uploaded_by
    into current_status, stored_path, uploader
  from public.documents where id = target_document for update;

  if current_status is null then
    raise exception 'No such document: %', target_document using errcode = '23503';
  end if;

  if current_status = new_status then
    raise exception 'Document is already %', new_status using errcode = '23514';
  end if;

  -- pending -> approved | rejected; approved -> superseded. Rejected and
  -- superseded are terminal: reconsidering means uploading the document again.
  if not (
    (current_status = 'pending' and new_status in ('approved', 'rejected'))
    or (current_status = 'approved' and new_status = 'superseded')
  ) then
    raise exception 'Cannot move a document from % to %', current_status, new_status
      using errcode = '23514';
  end if;

  if new_status = 'rejected' and coalesce(btrim(reason), '') = '' then
    raise exception 'A rejection must record a reason' using errcode = '23514';
  end if;

  if new_status = 'approved' and stored_path is null then
    raise exception 'A document cannot be approved before its file is stored'
      using errcode = '23514';
  end if;

  if new_status = 'superseded' and not exists (
    select 1 from public.documents
    where supersedes_id = target_document and review_status = 'approved'
  ) then
    raise exception 'Nothing approved supersedes this document' using errcode = '23514';
  end if;

  -- Clearing your own upload. Allowed for now, but always recorded, and refused
  -- outright once two-person review is switched on.
  self_approval := new_status = 'approved' and uploader is not null and uploader = actor_user;

  if self_approval and public.setting_bool('review.require_two_person', false) then
    raise exception 'Two-person review is required: the uploader may not approve their own document'
      using errcode = '42501';
  end if;

  perform set_config('sfi.document_review', '1', true);
  update public.documents
     set review_status = new_status,
         reviewed_by = actor_user,
         reviewed_at = now()
   where id = target_document;
  perform set_config('sfi.document_review', '0', true);

  insert into public.document_review_events (
    document_id, from_status, to_status, actor_user_id, reason, self_approved
  )
  values (
    target_document, current_status, new_status, actor_user, nullif(btrim(reason), ''), self_approval
  );

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'document.review.' || new_status,
    jsonb_build_object('document_id', target_document, 'from', current_status, 'self_approved', self_approval)
  );
end;
$$;

revoke all on function public.review_document(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_document(uuid, uuid, text, text) to service_role;
