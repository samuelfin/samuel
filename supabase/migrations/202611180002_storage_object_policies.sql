-- Samuel Terminal — private document storage access.
--
-- Source documents (issuer filings, releases, auction results) are commercially
-- licensed or rights-restricted material. They are reachable in exactly one way:
-- a trusted server process, holding the service key, mints a short-lived signed
-- URL for a specific object. No browser client ever reads the bucket directly.
--
-- Two things enforce that here:
--   1. There is no permissive policy on storage.objects for `anon` or
--      `authenticated`, so row-level security denies them by default.
--   2. A RESTRICTIVE policy excludes the bucket outright. Restrictive policies are
--      ANDed with permissive ones, so this keeps the guarantee even if someone
--      later adds a well-meaning "users can read documents" policy.
--
-- `service_role` bypasses row-level security, so server-side signing is unaffected.
-- The bucket itself is created non-public in 202611180001_data_foundation.sql.
--
-- Skipped where the storage schema does not exist (e.g. a test database that does
-- not stub it).

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  execute 'alter table storage.objects enable row level security';

  execute 'drop policy if exists "Source documents are server-side only" on storage.objects';
  execute $policy$
    create policy "Source documents are server-side only" on storage.objects
    as restrictive
    for all
    to anon, authenticated
    using (bucket_id <> 'source-documents')
    with check (bucket_id <> 'source-documents')
  $policy$;

  -- Clients have no reason to enumerate buckets or read their configuration
  -- (which includes the size and mime limits). Supabase's own storage API uses
  -- the service key and is unaffected.
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    execute 'alter table storage.buckets enable row level security';
    execute 'drop policy if exists "The document bucket is not listable by clients" on storage.buckets';
    execute $policy$
      create policy "The document bucket is not listable by clients" on storage.buckets
      as restrictive
      for all
      to anon, authenticated
      using (id <> 'source-documents')
      with check (id <> 'source-documents')
    $policy$;
  end if;
end;
$$;
