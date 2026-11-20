-- Samuel Terminal — an announcement does not claim a review it cannot show.
--
-- The last instance of a defect fixed twice already: once in
-- publish_editorial_item (202611200002) and once avoided in review_company
-- (202611200003).
--
-- self_published was derived as `doc_reviewer is not null and doc_reviewer =
-- actor_user`. When the document's reviewer is null — which is what the foreign
-- key leaves behind once that person's account is deleted — the expression is
-- false, so the announcement asserts that somebody independent approved the
-- document it rests on. Nobody can be shown. An unknown reviewer must count as
-- self-published: the flag exists to say "no independent pair of eyes can be
-- demonstrated here", and that is exactly the situation.
--
-- This only affects announcements published after it is applied. Rows already
-- written keep what they recorded, because an announcement is a matter of record
-- and this migration is not entitled to restate one.

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

  -- The one line this migration exists for. An unknown reviewer counts as
  -- self-published, rather than as evidence of independent approval.
  self_flag := doc_reviewer is null or doc_reviewer = actor_user;

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

-- CREATE OR REPLACE keeps existing privileges, but these are restated so the
-- grant does not depend on what an earlier migration happened to leave behind.
revoke all on function public.publish_announcement(
  uuid, uuid, text, text, timestamptz, text, boolean, uuid, uuid, text
) from public, anon, authenticated;

grant execute on function public.publish_announcement(
  uuid, uuid, text, text, timestamptz, text, boolean, uuid, uuid, text
) to service_role;
