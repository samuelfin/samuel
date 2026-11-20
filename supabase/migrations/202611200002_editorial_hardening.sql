-- Samuel Terminal — hardening found by reviewing stage 2c.
--
-- None of these was reachable from the application, but each is the weakest
-- link if a future caller is less careful than the present one. The point of a
-- guard is that it holds regardless of who calls it.

-- ---------------------------------------------------------------------------
-- 1. A citation cannot be moved off a published item
-- ---------------------------------------------------------------------------
--
-- The guard checked only the parent the row was moving *to*. An update that
-- changed item_id would be judged on the destination draft while silently
-- stripping evidence from the published claim it left behind — routing around
-- the delete guard. It now judges both ends.
--
-- It also now requires a cited document to be one a reader could actually open.
-- "Approved" was not enough: the reader-facing documents policy also excludes
-- licence_class = 'unverified', so citing such a document produced a source a
-- reader could see named but never reach.

create or replace function public.guard_editorial_citation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
  previous_status text;
begin
  select status into parent_status from public.editorial_items where id = new.item_id for update;
  if parent_status is null then
    raise exception 'No such editorial item: %', new.item_id using errcode = '23503';
  end if;
  if parent_status <> 'draft' then
    raise exception 'Citations can only be changed while the item is a draft' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.item_id is distinct from new.item_id then
    select status into previous_status from public.editorial_items where id = old.item_id for update;
    if previous_status is not null and previous_status <> 'draft' then
      raise exception 'A citation cannot be moved off a published item' using errcode = '42501';
    end if;
  end if;

  if new.document_id is not null and not exists (
    select 1 from public.documents
    where id = new.document_id
      and review_status = 'approved'
      -- A reader must be able to reach what is cited; this mirrors the
      -- reader-facing documents policy exactly.
      and licence_class <> 'unverified'
  ) then
    raise exception 'A citation must rest on an approved document that readers can open'
      using errcode = '23514';
  end if;

  if new.announcement_id is not null and not exists (
    select 1 from public.announcements where id = new.announcement_id and status = 'published'
  ) then
    raise exception 'A citation must rest on a published announcement' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Take the same lock publish_editorial_item takes, so a citation cannot be
-- removed in the window between its count being read and the item going live.
create or replace function public.guard_editorial_citation_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
begin
  select status into parent_status from public.editorial_items where id = old.item_id for update;
  -- Null when the parent is being cascaded away, which cannot happen for a
  -- published item because editorial items are never deleted.
  if parent_status is not null and parent_status <> 'draft' then
    raise exception 'Citations cannot be removed once the item is published' using errcode = '42501';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Everything is born a draft
-- ---------------------------------------------------------------------------
--
-- There was no insert-time guard, so a direct insert could have arrived already
-- 'published', with a version, a publisher and a timestamp — skipping the role
-- check, the citation requirement and the audit entry that publish_editorial_item
-- exists to impose. Publication is an act, not an initial value.

create or replace function public.guard_editorial_item_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status <> 'draft'
     or new.version <> 1
     or new.published_at is not null
     or new.published_by is not null
     or new.self_reviewed
     or new.withdrawn_at is not null
     or new.withdrawn_by is not null
     or new.withdrawal_reason is not null then
    raise exception 'An editorial item is created as a draft; publish it with publish_editorial_item()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_editorial_item_insert() from public, anon, authenticated;

drop trigger if exists editorial_items_guard_insert on public.editorial_items;
create trigger editorial_items_guard_insert before insert on public.editorial_items
for each row execute function public.guard_editorial_item_insert();

-- ---------------------------------------------------------------------------
-- 3. An unknown author cannot quietly clear the self-review flag
-- ---------------------------------------------------------------------------
--
-- self_reviewed was derived by comparing author_id with the publisher, so an
-- author_id of null produced "not self-reviewed" — an assertion of independent
-- review that nobody had made. Where authorship is unknown the flag is now set
-- rather than cleared: we do not claim a second pair of eyes we cannot show.

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

  -- Unknown authorship counts as self-reviewed: an absent author is not evidence
  -- that someone else read it.
  self_flag := item.author_id is null or item.author_id = actor_user;

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

revoke all on function public.publish_editorial_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_editorial_item(uuid, uuid) to service_role;
