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

-- Ownership note. On a hosted Supabase project the storage tables are owned by
-- `supabase_storage_admin`, and migrations run as `postgres`, which may own
-- neither. Both ENABLE ROW LEVEL SECURITY and CREATE POLICY require ownership, so
-- these statements can fail with 42501 ("must be owner of table objects") through
-- no fault of the policy itself.
--
-- That is tolerated rather than fatal, because the bucket is already closed
-- without this: it is created non-public, and Supabase's storage RLS denies every
-- client role by default when no policy grants access. What is lost when the
-- statements are skipped is only the belt-and-braces guarantee — the restrictive
-- policy that would survive someone later adding a permissive one. The migration
-- warns loudly instead of failing the whole push, and the skip is visible.
--
-- Where the migration role does own the tables — a local database that stubs the
-- storage schema, which is how the test suite runs — the lockdown is applied in
-- full and the tests assert it.

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'objects'
  ) then
    return;
  end if;

  begin
    -- Already enabled on a hosted project; only a stub needs this turned on.
    if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
      execute 'alter table storage.objects enable row level security';
    end if;

    execute 'drop policy if exists "Source documents are server-side only" on storage.objects';
    execute $policy$
      create policy "Source documents are server-side only" on storage.objects
      as restrictive
      for all
      to anon, authenticated
      using (bucket_id <> 'source-documents')
      with check (bucket_id <> 'source-documents')
    $policy$;
  exception
    when insufficient_privilege then
      raise warning 'storage.objects lockdown skipped: this role does not own the table. The private bucket still denies client roles by default, but add the restrictive policy from the Supabase dashboard to make that explicit.';
  end;

  -- Clients have no reason to enumerate buckets or read their configuration
  -- (which includes the size and mime limits). Supabase's own storage API uses
  -- the service key and is unaffected.
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    begin
      if not (select relrowsecurity from pg_class where oid = 'storage.buckets'::regclass) then
        execute 'alter table storage.buckets enable row level security';
      end if;

      execute 'drop policy if exists "The document bucket is not listable by clients" on storage.buckets';
      execute $policy$
        create policy "The document bucket is not listable by clients" on storage.buckets
        as restrictive
        for all
        to anon, authenticated
        using (id <> 'source-documents')
        with check (id <> 'source-documents')
      $policy$;
    exception
      when insufficient_privilege then
        raise warning 'storage.buckets lockdown skipped: this role does not own the table.';
    end;
  end if;
end;
$$;
