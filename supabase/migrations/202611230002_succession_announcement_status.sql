-- Samuel Terminal — the succession guard was reading a column announcements does not have.
--
-- 202611230001 checks that a cited announcement is published before a succession
-- may rest on it. It read `review_status`, which is what documents, companies,
-- people and statements all call that column — but announcements call theirs
-- `status`, with values 'published', 'superseded' and 'withdrawn'. plpgsql
-- resolves a column at execution time, so the function was created happily and
-- would have raised 42703 the first time anyone cited an announcement.
--
-- It survived the suite because every succession test cited a document. The
-- announcement branch was written, reviewed and never executed, which is the
-- useful lesson: a guard with two arms needs a test down each one, and "the
-- other table probably spells it the same way" is not a check.
--
-- A withdrawn announcement is excluded as well as a superseded one. The
-- published/superseded/withdrawn vocabulary belongs to the announcement desk,
-- and only the first of the three is something a reader can still follow.

create or replace function public.guard_company_succession_sources()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  doc_status text;
  doc_licence text;
  ann_status text;
begin
  if new.document_id is not null then
    select review_status, licence_class into doc_status, doc_licence
      from public.documents where id = new.document_id;
    if doc_status is null then
      raise exception 'No such document: %', new.document_id using errcode = '23503';
    end if;
    if doc_status <> 'approved' then
      raise exception 'A succession must cite an approved document' using errcode = '23514';
    end if;
    if doc_licence = 'unverified' then
      raise exception 'A succession cannot cite a document whose licence is unverified' using errcode = '23514';
    end if;
  end if;

  if new.announcement_id is not null then
    select status into ann_status from public.announcements where id = new.announcement_id;
    if ann_status is null then
      raise exception 'No such announcement: %', new.announcement_id using errcode = '23503';
    end if;
    if ann_status <> 'published' then
      raise exception 'A succession must cite a published announcement' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_company_succession_sources() from public, anon, authenticated;
