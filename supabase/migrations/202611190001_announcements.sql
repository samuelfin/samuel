-- Samuel Terminal — announcements.
--
-- The first record that travels the whole path: a document is uploaded, a
-- reviewer approves it, and an analyst publishes the announcement it evidences.
-- Readers see that announcement in the terminal.
--
-- An announcement is a claim about the world, so it is tied to the evidence for
-- it. Three rules hold at insert:
--   * the cited document must be approved — an announcement can never rest on
--     something pending, rejected or unreviewed;
--   * that document must carry a public source link, because a reader is shown
--     the issuer's own page rather than our stored copy of licensed material;
--   * the source record must belong to that document, so provenance is intact.
--
-- These are checked when the announcement is written, not continuously. A
-- document superseded later does not retract what was true when published; it
-- only stops being usable for new announcements.
--
-- Lifecycle: published -> superseded (a correction replaced it) or withdrawn.
-- Both are terminal, and neither removes anything. There is no pending state:
-- the review happened on the document.

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  -- Null for market-wide notices that belong to no single issuer.
  company_id uuid references public.companies (id),
  document_id uuid not null references public.documents (id),
  source_record_id uuid not null references public.source_records (id),

  category text not null check (category in (
    'results', 'corporate_action', 'board_change', 'agm', 'material_event',
    'suspension', 'delisting', 'regulatory', 'offer', 'other'
  )),
  headline text not null check (char_length(btrim(headline)) between 1 and 300),
  summary text check (summary is null or char_length(summary) <= 4000),
  -- Copied from the document at publication. Held here, not joined, so that a
  -- reader's view of an announcement never depends on whether they may see the
  -- document row — otherwise an announcement could silently vanish from the feed.
  source_uri text not null check (source_uri ~ '^https?://'),
  -- When the issuer announced it, which is not when we recorded it.
  announced_at timestamptz not null,
  is_price_sensitive boolean not null default false,

  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references public.announcements (id),
  correction_reason text check (
    correction_reason is null or char_length(btrim(correction_reason)) between 1 and 2000
  ),

  status text not null default 'published' check (status in ('published', 'superseded', 'withdrawn')),
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz not null default now(),
  -- The publisher also approved the cited document: nobody independent was
  -- involved at any step. Allowed while the desk is one person, never silent.
  self_published boolean not null default false,

  withdrawn_by uuid references auth.users (id) on delete set null,
  withdrawn_at timestamptz,
  withdrawal_reason text check (
    withdrawal_reason is null or char_length(btrim(withdrawal_reason)) between 1 and 2000
  ),

  created_at timestamptz not null default now(),

  check (version = 1 or (supersedes_id is not null and correction_reason is not null)),
  check (supersedes_id is null or supersedes_id <> id),
  -- Withdrawal is all-or-nothing: a withdrawn row always carries when and why.
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (withdrawn_at is null or btrim(coalesce(withdrawal_reason, '')) <> '')
);

-- At most one live announcement per document. The desk publishes from a queue of
-- approved documents, so this is what stops the same document being published
-- twice; a correction supersedes rather than adds.
create unique index if not exists announcements_current_per_document_uidx
  on public.announcements (document_id) where status = 'published';

create index if not exists announcements_feed_idx
  on public.announcements (announced_at desc) where status in ('published', 'withdrawn');
create index if not exists announcements_company_idx
  on public.announcements (company_id, announced_at desc);
create index if not exists announcements_supersedes_idx on public.announcements (supersedes_id);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create or replace function public.guard_announcement_source()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  doc_status text;
  doc_source text;
begin
  select review_status, source_uri into doc_status, doc_source
  from public.documents where id = new.document_id;

  if doc_status is null then
    raise exception 'No such document: %', new.document_id using errcode = '23503';
  end if;

  if doc_status <> 'approved' then
    raise exception 'An announcement must cite an approved document; this one is %', doc_status
      using errcode = '23514';
  end if;

  if doc_source is null or btrim(doc_source) = '' then
    raise exception 'The cited document has no public source link, so readers could not be shown where it came from'
      using errcode = '23514';
  end if;

  -- The stored link must be the document's own, not something supplied alongside it.
  if new.source_uri is distinct from doc_source then
    raise exception 'An announcement must carry the cited document''s source link' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.source_records
    where id = new.source_record_id and document_id = new.document_id
  ) then
    raise exception 'The source record must belong to the cited document' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists announcements_guard_source on public.announcements;
create trigger announcements_guard_source before insert on public.announcements
for each row execute function public.guard_announcement_source();

-- What an announcement says is fixed once published. A correction is a new
-- version; a withdrawal changes its standing, not its words.
create or replace function public.guard_announcement_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id is distinct from old.id
     or new.document_id is distinct from old.document_id
     or new.source_record_id is distinct from old.source_record_id
     or new.source_uri is distinct from old.source_uri
     or new.company_id is distinct from old.company_id
     or new.category is distinct from old.category
     or new.headline is distinct from old.headline
     or new.summary is distinct from old.summary
     or new.announced_at is distinct from old.announced_at
     or new.is_price_sensitive is distinct from old.is_price_sensitive
     or new.version is distinct from old.version
     or new.supersedes_id is distinct from old.supersedes_id
     or new.correction_reason is distinct from old.correction_reason
     or new.self_published is distinct from old.self_published
     or new.published_at is distinct from old.published_at
     or new.created_at is distinct from old.created_at then
    raise exception 'A published announcement is immutable; correct it with a new version'
      using errcode = '23514';
  end if;

  -- Inside publish_announcement() or withdraw_announcement(), changing standing
  -- and naming who did it is the whole point, so the rest does not apply.
  if coalesce(current_setting('sfi.announcement_write', true), '') = '1' then
    return new;
  end if;

  -- Outside those functions, published_by and withdrawn_by may only be cleared,
  -- which is what the foreign keys do when an account is deleted. Learned in
  -- stage 2a: a blanket refusal here would make offboarding impossible.
  if (new.published_by is distinct from old.published_by and new.published_by is not null)
     or (new.withdrawn_by is distinct from old.withdrawn_by and new.withdrawn_by is not null) then
    raise exception 'An announcement cannot be reattributed to another person' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     or new.withdrawn_at is distinct from old.withdrawn_at
     or new.withdrawal_reason is distinct from old.withdrawal_reason then
    raise exception 'Use publish_announcement() or withdraw_announcement() to change an announcement''s standing'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists announcements_guard_immutable on public.announcements;
create trigger announcements_guard_immutable before update on public.announcements
for each row execute function public.guard_announcement_immutable();

drop trigger if exists announcements_forbid_delete on public.announcements;
create trigger announcements_forbid_delete before delete on public.announcements
for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------------------
-- Publishing
-- ---------------------------------------------------------------------------

create or replace function public.publish_announcement(
  actor_user uuid,
  p_document_id uuid,
  p_category text,
  p_headline text,
  p_announced_at timestamptz,
  p_summary text default null,
  p_is_price_sensitive boolean default false,
  p_company_id uuid default null,
  p_supersedes_id uuid default null,
  p_correction_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  doc_reviewer uuid;
  doc_source text;
  source_record uuid;
  previous public.announcements%rowtype;
  next_version integer := 1;
  self_flag boolean := false;
  new_id uuid;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role in ('analyst', 'editor')
     ) then
    raise exception 'Actor may not publish announcements' using errcode = '42501';
  end if;

  -- Approval, source link and provenance are all verified by the insert trigger.
  -- Here we need the reviewer, to work out whether this is self-publishing, and
  -- the source link, which is stored on the announcement rather than joined.
  select reviewed_by, source_uri into doc_reviewer, doc_source
  from public.documents where id = p_document_id;

  select id into source_record
  from public.source_records where document_id = p_document_id
  order by created_at limit 1;

  if source_record is null then
    raise exception 'The cited document has no source record' using errcode = '23503';
  end if;

  if p_supersedes_id is not null then
    select * into previous from public.announcements where id = p_supersedes_id for update;

    if previous.id is null then
      raise exception 'No such announcement to correct: %', p_supersedes_id using errcode = '23503';
    end if;
    if previous.status <> 'published' then
      raise exception 'Only a published announcement can be corrected; this one is %', previous.status
        using errcode = '23514';
    end if;
    if previous.document_id <> p_document_id then
      raise exception 'A correction must cite the same document as the announcement it replaces'
        using errcode = '23514';
    end if;
    if coalesce(btrim(p_correction_reason), '') = '' then
      raise exception 'A correction must record a reason' using errcode = '23514';
    end if;

    next_version := previous.version + 1;

    perform set_config('sfi.announcement_write', '1', true);
    update public.announcements set status = 'superseded' where id = p_supersedes_id;
    perform set_config('sfi.announcement_write', '0', true);
  end if;

  self_flag := doc_reviewer is not null and doc_reviewer = actor_user;

  insert into public.announcements (
    company_id, document_id, source_record_id, source_uri, category, headline, summary,
    announced_at, is_price_sensitive, version, supersedes_id, correction_reason,
    status, published_by, self_published
  )
  values (
    p_company_id, p_document_id, source_record, doc_source, p_category, btrim(p_headline),
    nullif(btrim(coalesce(p_summary, '')), ''), p_announced_at, coalesce(p_is_price_sensitive, false),
    next_version, p_supersedes_id, nullif(btrim(coalesce(p_correction_reason, '')), ''),
    'published', actor_user, self_flag
  )
  returning id into new_id;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    case when p_supersedes_id is null then 'announcement.published' else 'announcement.corrected' end,
    jsonb_build_object(
      'announcement_id', new_id,
      'document_id', p_document_id,
      'version', next_version,
      'self_published', self_flag
    )
  );

  return new_id;
end;
$$;

create or replace function public.withdraw_announcement(
  target_announcement uuid,
  actor_user uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_status text;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role in ('analyst', 'editor')
     ) then
    raise exception 'Actor may not withdraw announcements' using errcode = '42501';
  end if;

  if coalesce(btrim(reason), '') = '' then
    raise exception 'A withdrawal must record a reason' using errcode = '23514';
  end if;

  select status into current_status
  from public.announcements where id = target_announcement for update;

  if current_status is null then
    raise exception 'No such announcement: %', target_announcement using errcode = '23503';
  end if;
  if current_status <> 'published' then
    raise exception 'Only a published announcement can be withdrawn; this one is %', current_status
      using errcode = '23514';
  end if;

  perform set_config('sfi.announcement_write', '1', true);
  update public.announcements
     set status = 'withdrawn',
         withdrawn_by = actor_user,
         withdrawn_at = now(),
         withdrawal_reason = btrim(reason)
   where id = target_announcement;
  perform set_config('sfi.announcement_write', '0', true);

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'announcement.withdrawn',
    jsonb_build_object('announcement_id', target_announcement)
  );
end;
$$;

revoke all on function public.guard_announcement_source() from public, anon, authenticated;
revoke all on function public.guard_announcement_immutable() from public, anon, authenticated;
revoke all on function public.publish_announcement(
  uuid, uuid, text, text, timestamptz, text, boolean, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.withdraw_announcement(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.publish_announcement(
  uuid, uuid, text, text, timestamptz, text, boolean, uuid, uuid, text
) to service_role;
grant execute on function public.withdraw_announcement(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.announcements enable row level security;
revoke all on public.announcements from anon, authenticated;
grant select on public.announcements to authenticated;
grant all on public.announcements to service_role;

-- A withdrawn announcement stays visible, marked as withdrawn. Something that
-- was published and then vanished is worse than something openly retracted.
-- Superseded versions are hidden: the reader sees the correction in their place.
drop policy if exists "Readers see live announcements" on public.announcements;
create policy "Readers see live announcements" on public.announcements
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst', 'editor'])
  or status in ('published', 'withdrawn')
);
