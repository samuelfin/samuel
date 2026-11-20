-- Samuel Terminal — editorial.
--
-- SFI's own writing: articles and analysis that cite the evidence behind every
-- claim, plus a lightweight video kind that is a link to YouTube and nothing
-- more. No uploads, no streaming, no media pipeline.
--
-- The lifecycle mirrors announcements, with one addition: a draft is freely
-- editable, a published item is not. That single rule removes the need for a
-- separate revision table — the versions are the history.
--
--   draft -> published -> superseded (a correction replaced it) | withdrawn
--
-- Nothing is edited in place after publication and nothing is deleted. Because
-- this stage leans on audit_logs as the record of who did what, that table is
-- made append-only here too.
--
-- Shapes chosen to remove attack surface rather than defend it:
--   * a video stores an 11-character YouTube *id*, never a URL, so no arbitrary
--     link can reach an href;
--   * a slug is lowercase alphanumeric and hyphens only, so it cannot carry a
--     path segment, a scheme or a traversal;
--   * body text is plain prose rendered as paragraphs, never markup.

-- ---------------------------------------------------------------------------
-- 1. The audit log becomes append-only
-- ---------------------------------------------------------------------------

create or replace function public.guard_audit_log_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- The only permitted change is an actor or subject becoming null, which is
  -- what the foreign keys do when an account is deleted. Everything the entry
  -- asserts — action, details, time — is fixed.
  if new.id is distinct from old.id
     or new.action is distinct from old.action
     or new.details is distinct from old.details
     or new.created_at is distinct from old.created_at
     or (new.actor_user_id is distinct from old.actor_user_id and new.actor_user_id is not null)
     or (new.subject_user_id is distinct from old.subject_user_id and new.subject_user_id is not null) then
    raise exception 'The audit log is append-only; only an actor may be anonymised'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_audit_log_immutable() from public, anon, authenticated;

drop trigger if exists audit_logs_guard_immutable on public.audit_logs;
create trigger audit_logs_guard_immutable before update on public.audit_logs
for each row execute function public.guard_audit_log_immutable();

drop trigger if exists audit_logs_forbid_delete on public.audit_logs;
create trigger audit_logs_forbid_delete before delete on public.audit_logs
for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------------------
-- 2. Editorial items
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('article', 'analysis', 'video')),

  -- Appears in a URL. Lowercase words joined by single hyphens and nothing else:
  -- no slash, dot, percent or colon can be stored, so a slug cannot become a
  -- path segment, a traversal or a scheme.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 120),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  standfirst text check (standfirst is null or char_length(standfirst) <= 400),

  body_text text,
  -- A YouTube video id, never a URL. The link and the thumbnail are built from
  -- it, so no arbitrary address can reach an href or an img src.
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  guest_name text check (guest_name is null or char_length(btrim(guest_name)) between 1 and 120),

  company_id uuid references public.companies (id),

  status text not null default 'draft' check (status in ('draft', 'published', 'superseded', 'withdrawn')),
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references public.editorial_items (id),
  correction_reason text check (
    correction_reason is null or char_length(btrim(correction_reason)) between 1 and 2000
  ),

  author_id uuid references auth.users (id) on delete set null,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  -- Published by its own author, with nobody else reading it first.
  self_reviewed boolean not null default false,

  withdrawn_by uuid references auth.users (id) on delete set null,
  withdrawn_at timestamptz,
  withdrawal_reason text check (
    withdrawal_reason is null or char_length(btrim(withdrawal_reason)) between 1 and 2000
  ),

  -- Governance: an AI-assisted item must name the model, and readers are shown
  -- an "AI-assisted" label.
  ai_assisted boolean not null default false,
  ai_model text check (ai_model is null or char_length(btrim(ai_model)) between 1 and 120),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A video is a video id and a guest; everything else is prose.
  check ((kind = 'video') = (video_id is not null)),
  check (kind = 'video' or guest_name is null),
  check (kind = 'video' or btrim(coalesce(body_text, '')) <> ''),
  check (kind <> 'video' or body_text is null),

  check (version = 1 or (supersedes_id is not null and correction_reason is not null)),
  check (supersedes_id is null or supersedes_id <> id),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (withdrawn_at is null or btrim(coalesce(withdrawal_reason, '')) <> ''),
  check ((status <> 'draft') = (published_at is not null)),
  check (not ai_assisted or ai_model is not null)
);

-- One live item per slug. Withdrawn items keep theirs, because the URL a reader
-- followed yesterday must still explain what happened.
create unique index if not exists editorial_items_live_slug_uidx
  on public.editorial_items (slug) where status in ('published', 'withdrawn');

create index if not exists editorial_items_feed_idx
  on public.editorial_items (published_at desc) where status in ('published', 'withdrawn');
create index if not exists editorial_items_company_idx on public.editorial_items (company_id);
create index if not exists editorial_items_drafts_idx
  on public.editorial_items (updated_at desc) where status = 'draft';

drop trigger if exists editorial_items_set_updated_at on public.editorial_items;
create trigger editorial_items_set_updated_at before update on public.editorial_items
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Citations
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_citations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.editorial_items (id) on delete cascade,
  claim text not null check (char_length(btrim(claim)) between 1 and 500),
  document_id uuid references public.documents (id),
  announcement_id uuid references public.announcements (id),
  source_page integer check (source_page is null or source_page > 0),
  created_at timestamptz not null default now(),
  -- Exactly one source. A citation that points at two things supports neither.
  check ((document_id is not null)::integer + (announcement_id is not null)::integer = 1),
  check (announcement_id is null or source_page is null)
);

create index if not exists editorial_citations_item_idx on public.editorial_citations (item_id);

-- A citation may only rest on evidence a reader could themselves reach: an
-- approved document, or a published announcement. Checked when written, like an
-- announcement's own source check.
create or replace function public.guard_editorial_citation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
begin
  select status into parent_status from public.editorial_items where id = new.item_id;
  if parent_status is null then
    raise exception 'No such editorial item: %', new.item_id using errcode = '23503';
  end if;
  if parent_status <> 'draft' then
    raise exception 'Citations can only be changed while the item is a draft' using errcode = '42501';
  end if;

  if new.document_id is not null and not exists (
    select 1 from public.documents where id = new.document_id and review_status = 'approved'
  ) then
    raise exception 'A citation must rest on an approved document' using errcode = '23514';
  end if;

  if new.announcement_id is not null and not exists (
    select 1 from public.announcements where id = new.announcement_id and status = 'published'
  ) then
    raise exception 'A citation must rest on a published announcement' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists editorial_citations_guard on public.editorial_citations;
create trigger editorial_citations_guard before insert or update on public.editorial_citations
for each row execute function public.guard_editorial_citation();

-- Removing a citation from something already published would quietly strip the
-- evidence out from under a claim.
create or replace function public.guard_editorial_citation_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
begin
  select status into parent_status from public.editorial_items where id = old.item_id;
  -- Null when the parent is being cascaded away, which cannot happen for a
  -- published item because editorial items are never deleted.
  if parent_status is not null and parent_status <> 'draft' then
    raise exception 'Citations cannot be removed once the item is published' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists editorial_citations_guard_delete on public.editorial_citations;
create trigger editorial_citations_guard_delete before delete on public.editorial_citations
for each row execute function public.guard_editorial_citation_delete();

-- ---------------------------------------------------------------------------
-- 4. A draft is editable, a published item is not
-- ---------------------------------------------------------------------------

create or replace function public.guard_editorial_item()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- Inside publish_editorial_item() or withdraw_editorial_item().
  if coalesce(current_setting('sfi.editorial_write', true), '') = '1' then
    return new;
  end if;

  -- Checked first so that an attempt to change an item's standing is told to use
  -- the function, rather than being turned away for whichever bookkeeping column
  -- the same statement happened to touch.
  if new.status is distinct from old.status
     or new.withdrawn_at is distinct from old.withdrawn_at
     or new.withdrawal_reason is distinct from old.withdrawal_reason
     or new.published_at is distinct from old.published_at
     or new.self_reviewed is distinct from old.self_reviewed
     or new.version is distinct from old.version then
    raise exception 'Use publish_editorial_item() or withdraw_editorial_item() to change an item''s standing'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'That field is not editable' using errcode = '23514';
  end if;

  if (new.published_by is distinct from old.published_by and new.published_by is not null)
     or (new.withdrawn_by is distinct from old.withdrawn_by and new.withdrawn_by is not null)
     or (new.author_id is distinct from old.author_id and new.author_id is not null) then
    raise exception 'An editorial item cannot be reattributed to another person' using errcode = '42501';
  end if;

  -- A draft is a work in progress; everything else is a matter of record.
  if old.status <> 'draft' then
    if new.kind is distinct from old.kind
       or new.slug is distinct from old.slug
       or new.title is distinct from old.title
       or new.standfirst is distinct from old.standfirst
       or new.body_text is distinct from old.body_text
       or new.video_id is distinct from old.video_id
       or new.guest_name is distinct from old.guest_name
       or new.company_id is distinct from old.company_id
       or new.supersedes_id is distinct from old.supersedes_id
       or new.correction_reason is distinct from old.correction_reason
       or new.ai_assisted is distinct from old.ai_assisted
       or new.ai_model is distinct from old.ai_model then
      raise exception 'A published item is immutable; correct it with a new version'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists editorial_items_guard on public.editorial_items;
create trigger editorial_items_guard before update on public.editorial_items
for each row execute function public.guard_editorial_item();

drop trigger if exists editorial_items_forbid_delete on public.editorial_items;
create trigger editorial_items_forbid_delete before delete on public.editorial_items
for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------------------
-- 5. Publishing
-- ---------------------------------------------------------------------------

create or replace function public.publish_editorial_item(
  target_item uuid,
  actor_user uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  item public.editorial_items%rowtype;
  previous public.editorial_items%rowtype;
  citation_count integer := 0;
  next_version integer := 1;
  self_flag boolean := false;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role in ('analyst', 'editor')
     ) then
    raise exception 'Actor may not publish editorial items' using errcode = '42501';
  end if;

  select * into item from public.editorial_items where id = target_item for update;
  if item.id is null then
    raise exception 'No such editorial item: %', target_item using errcode = '23503';
  end if;
  if item.status <> 'draft' then
    raise exception 'Only a draft can be published; this one is %', item.status using errcode = '23514';
  end if;

  -- An article or analysis makes claims, so it must show its evidence. A video
  -- carries a guest rather than a filing and is exempt.
  if item.kind in ('article', 'analysis') then
    select count(*) into citation_count from public.editorial_citations where item_id = target_item;
    if citation_count = 0 then
      raise exception 'An article or analysis must cite at least one source before publication'
        using errcode = '23514';
    end if;
  end if;

  if item.supersedes_id is not null then
    select * into previous from public.editorial_items where id = item.supersedes_id for update;

    if previous.id is null then
      raise exception 'No such item to correct: %', item.supersedes_id using errcode = '23503';
    end if;
    if previous.status <> 'published' then
      raise exception 'Only a published item can be corrected; that one is %', previous.status
        using errcode = '23514';
    end if;
    -- The correction takes the original's place at the same address.
    if previous.slug <> item.slug then
      raise exception 'A correction must keep the slug of the item it replaces' using errcode = '23514';
    end if;
    if coalesce(btrim(item.correction_reason), '') = '' then
      raise exception 'A correction must record a reason' using errcode = '23514';
    end if;

    next_version := previous.version + 1;

    perform set_config('sfi.editorial_write', '1', true);
    update public.editorial_items set status = 'superseded' where id = previous.id;
  else
    perform set_config('sfi.editorial_write', '1', true);
  end if;

  self_flag := item.author_id is not null and item.author_id = actor_user;

  update public.editorial_items
     set status = 'published',
         version = next_version,
         published_by = actor_user,
         published_at = now(),
         self_reviewed = self_flag
   where id = target_item;
  perform set_config('sfi.editorial_write', '0', true);

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    case when item.supersedes_id is null then 'editorial.published' else 'editorial.corrected' end,
    jsonb_build_object(
      'item_id', target_item,
      'kind', item.kind,
      'slug', item.slug,
      'version', next_version,
      'self_reviewed', self_flag,
      'ai_assisted', item.ai_assisted
    )
  );
end;
$$;

create or replace function public.withdraw_editorial_item(
  target_item uuid,
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
    raise exception 'Actor may not withdraw editorial items' using errcode = '42501';
  end if;

  if coalesce(btrim(reason), '') = '' then
    raise exception 'A withdrawal must record a reason' using errcode = '23514';
  end if;

  select status into current_status from public.editorial_items where id = target_item for update;
  if current_status is null then
    raise exception 'No such editorial item: %', target_item using errcode = '23503';
  end if;
  if current_status <> 'published' then
    raise exception 'Only a published item can be withdrawn; this one is %', current_status
      using errcode = '23514';
  end if;

  perform set_config('sfi.editorial_write', '1', true);
  update public.editorial_items
     set status = 'withdrawn',
         withdrawn_by = actor_user,
         withdrawn_at = now(),
         withdrawal_reason = btrim(reason)
   where id = target_item;
  perform set_config('sfi.editorial_write', '0', true);

  insert into public.audit_logs (actor_user_id, action, details)
  values (actor_user, 'editorial.withdrawn', jsonb_build_object('item_id', target_item));
end;
$$;

revoke all on function public.guard_editorial_item() from public, anon, authenticated;
revoke all on function public.guard_editorial_citation() from public, anon, authenticated;
revoke all on function public.guard_editorial_citation_delete() from public, anon, authenticated;
revoke all on function public.publish_editorial_item(uuid, uuid) from public, anon, authenticated;
revoke all on function public.withdraw_editorial_item(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.publish_editorial_item(uuid, uuid) to service_role;
grant execute on function public.withdraw_editorial_item(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------------

-- Security definer so the citations policy can ask about an item without
-- recursing through that table's own policy.
create or replace function public.editorial_item_is_live(target_item uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.editorial_items
    where id = target_item and status in ('published', 'withdrawn')
  );
$$;

revoke all on function public.editorial_item_is_live(uuid) from public;
grant execute on function public.editorial_item_is_live(uuid) to authenticated;

alter table public.editorial_items enable row level security;
alter table public.editorial_citations enable row level security;

revoke all on public.editorial_items, public.editorial_citations from anon, authenticated;
grant select on public.editorial_items, public.editorial_citations to authenticated;
grant all on public.editorial_items, public.editorial_citations to service_role;

drop policy if exists "Readers see live editorial" on public.editorial_items;
create policy "Readers see live editorial" on public.editorial_items
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst', 'editor'])
  or status in ('published', 'withdrawn')
);

-- A citation is only as visible as the item it belongs to. Without this a
-- draft's working sources would leak before anything was published.
drop policy if exists "Readers see citations of live editorial" on public.editorial_citations;
create policy "Readers see citations of live editorial" on public.editorial_citations
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst', 'editor'])
  or public.editorial_item_is_live(item_id)
);
