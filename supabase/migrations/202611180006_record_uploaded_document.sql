-- Samuel Terminal — recording a manually uploaded document.
--
-- The first ingestion path is a person uploading an official document. Three rows
-- have to appear together or not at all: the job that explains where it came from,
-- the document itself, and the source record that later observations cite. A
-- document without its source record would be evidence with no provenance, so this
-- is one function and therefore one transaction, rather than three client calls.
--
-- The file is already in private storage by the time this runs. The caller passes
-- the checksum it computed server-side from the bytes it stored; it is never taken
-- from the browser.
--
-- Duplicate uploads are rejected by two existing unique constraints:
-- documents.sha256, and source_records (dataset_id, content_sha256).

create or replace function public.record_uploaded_document(
  actor_user uuid,
  p_dataset_id text,
  p_provider_id text,
  p_kind text,
  p_title text,
  p_storage_path text,
  p_sha256 text,
  p_mime_type text,
  p_size_bytes bigint,
  p_licence_class text,
  p_company_id uuid default null,
  p_source_uri text default null,
  p_published_at timestamptz default null,
  p_period_end date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_job uuid;
  new_document uuid;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role in ('analyst', 'editor')
     ) then
    raise exception 'Actor may not upload documents' using errcode = '42501';
  end if;

  if p_storage_path is null or btrim(p_storage_path) = '' then
    raise exception 'A document must name the object that was stored' using errcode = '23514';
  end if;

  insert into public.ingestion_jobs (
    dataset_id, trigger, status, requested_by, parameters,
    records_received, records_accepted, started_at, finished_at
  )
  values (
    p_dataset_id, 'upload', 'succeeded', actor_user,
    jsonb_build_object('storage_path', p_storage_path),
    1, 1, now(), now()
  )
  returning id into new_job;

  insert into public.documents (
    provider_id, company_id, kind, title, published_at, period_end,
    source_uri, storage_path, sha256, mime_type, size_bytes, licence_class, uploaded_by
  )
  values (
    p_provider_id, p_company_id, p_kind, p_title, p_published_at, p_period_end,
    p_source_uri, p_storage_path, p_sha256, p_mime_type, p_size_bytes, p_licence_class, actor_user
  )
  returning id into new_document;

  insert into public.source_records (
    dataset_id, job_id, document_id, source_uri, retrieved_at, published_at, content_sha256
  )
  values (
    p_dataset_id, new_job, new_document, p_source_uri, now(), p_published_at, p_sha256
  );

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'document.uploaded',
    jsonb_build_object('document_id', new_document, 'dataset_id', p_dataset_id, 'kind', p_kind)
  );

  return new_document;
end;
$$;

revoke all on function public.record_uploaded_document(
  uuid, text, text, text, text, text, text, text, bigint, text, uuid, text, timestamptz, date
) from public, anon, authenticated;
grant execute on function public.record_uploaded_document(
  uuid, text, text, text, text, text, text, text, bigint, text, uuid, text, timestamptz, date
) to service_role;
