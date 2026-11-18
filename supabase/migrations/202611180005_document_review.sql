-- Samuel Terminal — document review.
--
-- A document is evidence. Once it is stored, its bytes, checksum and location must
-- never change, and the decision to publish or reject it must leave a trail naming
-- who decided and why. Until now `documents.review_status` was a free-form column
-- any writer could set, with a reviewer and a timestamp but no reason and no
-- history.
--
-- This migration makes review a controlled operation:
--   * content fields are immutable after insert, and documents are never deleted;
--   * review_status changes only inside review_document(), which validates the
--     transition and records an append-only event;
--   * a rejection must carry a reason, and an approval must have a stored object;
--   * a superseded document keeps its row, so corrections never erase the record.
--
-- Staff (analysts and editors) gain sight of the review queue here. Readers still
-- see only approved documents.

-- ---------------------------------------------------------------------------
-- 1. Superseding, so a corrected document replaces rather than overwrites
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists supersedes_id uuid references public.documents (id);

alter table public.documents drop constraint if exists documents_review_status_check;
alter table public.documents add constraint documents_review_status_check
  check (review_status in ('pending', 'approved', 'rejected', 'superseded'));

alter table public.documents drop constraint if exists documents_supersedes_not_self;
alter table public.documents add constraint documents_supersedes_not_self
  check (supersedes_id is null or supersedes_id <> id);

create index if not exists documents_supersedes_idx on public.documents (supersedes_id);

-- ---------------------------------------------------------------------------
-- 2. Append-only review history
-- ---------------------------------------------------------------------------

create table if not exists public.document_review_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete restrict,
  from_status text not null check (from_status in ('pending', 'approved', 'rejected', 'superseded')),
  to_status text not null check (to_status in ('pending', 'approved', 'rejected', 'superseded')),
  actor_user_id uuid references auth.users (id) on delete set null,
  reason text check (reason is null or char_length(reason) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (from_status <> to_status)
);

create index if not exists document_review_events_document_idx
  on public.document_review_events (document_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Immutability guards
-- ---------------------------------------------------------------------------

-- The stored object and its identity are fixed at upload. A correction is a new
-- document that supersedes this one, never an edit of this row.
create or replace function public.guard_document_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.sha256 is distinct from old.sha256
     or new.storage_path is distinct from old.storage_path
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.provider_id is distinct from old.provider_id then
    raise exception 'A stored document is immutable; supersede it with a new document instead'
      using errcode = '23514';
  end if;

  -- Review state is a decision, not a field. It moves only through review_document().
  if new.review_status is distinct from old.review_status
     and coalesce(current_setting('sfi.document_review', true), '') <> '1' then
    raise exception 'Use review_document() to change a document''s review status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_guard_immutable on public.documents;
create trigger documents_guard_immutable before update on public.documents
for each row execute function public.guard_document_immutable();

create or replace function public.forbid_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Rows in % are append-only and cannot be deleted', tg_table_name
    using errcode = '42501';
end;
$$;

drop trigger if exists documents_forbid_delete on public.documents;
create trigger documents_forbid_delete before delete on public.documents
for each row execute function public.forbid_delete();

drop trigger if exists document_review_events_forbid_delete on public.document_review_events;
create trigger document_review_events_forbid_delete before delete on public.document_review_events
for each row execute function public.forbid_delete();

create or replace function public.forbid_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Rows in % are append-only and cannot be changed', tg_table_name
    using errcode = '42501';
end;
$$;

drop trigger if exists document_review_events_forbid_update on public.document_review_events;
create trigger document_review_events_forbid_update before update on public.document_review_events
for each row execute function public.forbid_update();

-- ---------------------------------------------------------------------------
-- 4. The review operation
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
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role in ('analyst', 'editor')
     ) then
    raise exception 'Actor may not review documents' using errcode = '42501';
  end if;

  select review_status, storage_path into current_status, stored_path
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

  -- Superseding requires the replacement to exist and to have been approved, so a
  -- document is never withdrawn leaving nothing in its place.
  if new_status = 'superseded' and not exists (
    select 1 from public.documents
    where supersedes_id = target_document and review_status = 'approved'
  ) then
    raise exception 'Nothing approved supersedes this document' using errcode = '23514';
  end if;

  perform set_config('sfi.document_review', '1', true);
  update public.documents
     set review_status = new_status,
         reviewed_by = actor_user,
         reviewed_at = now()
   where id = target_document;
  perform set_config('sfi.document_review', '0', true);

  insert into public.document_review_events (document_id, from_status, to_status, actor_user_id, reason)
  values (target_document, current_status, new_status, actor_user, nullif(btrim(reason), ''));

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'document.review.' || new_status,
    jsonb_build_object('document_id', target_document, 'from', current_status)
  );
end;
$$;

revoke all on function public.guard_document_immutable() from public, anon, authenticated;
revoke all on function public.forbid_delete() from public, anon, authenticated;
revoke all on function public.forbid_update() from public, anon, authenticated;
revoke all on function public.review_document(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_document(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Access
-- ---------------------------------------------------------------------------

alter table public.document_review_events enable row level security;
revoke all on public.document_review_events from anon, authenticated;
grant select on public.document_review_events to authenticated;
grant all on public.document_review_events to service_role;

drop policy if exists "Staff can view document review history" on public.document_review_events;
create policy "Staff can view document review history" on public.document_review_events
for select to authenticated using (
  public.is_platform_admin() or public.has_staff_role(array['analyst', 'editor'])
);

-- Readers see approved documents only. Staff also see the queue they work on; a
-- superseded document stays visible to them as part of the record.
drop policy if exists "Users can view approved documents" on public.documents;
create policy "Users can view approved documents" on public.documents
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst', 'editor'])
  or (review_status = 'approved' and licence_class <> 'unverified')
);
