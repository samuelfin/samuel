# Storage smoke test

The unit suite runs on PGlite, which has no storage layer. Every SQL rule around
documents is covered there, but the real round trip — object storage, signed URLs,
range requests, a second user being refused — has never run. This script does that
against a live Supabase project.

**Run it before any deployment that will handle real documents.**

## What it checks

1. The `source-documents` bucket exists and is private.
2. An analyst and a reader can be created, and the analyst can hold a staff role.
3. A generated PDF uploads, and `record_uploaded_document` writes the document, its
   ingestion job and its source record, with the checksum matching the bytes.
4. The reader **cannot** see the document while it is pending.
5. Approval works, the review event is written, and the self-approval flag is set
   because the uploader approved their own upload.
6. The reader **can** see it once approved.
7. A signed URL fetches with status 200, the bytes match the checksum, and a
   `Range` request returns 206 with the requested length. (Range support is why the
   TTL is 600s: browser PDF viewers keep fetching while the reader scrolls.)
8. The reader cannot download the object directly, cannot mint their own signed
   URL, and cannot list the bucket.
9. A one-second link works immediately and is refused once expired.

## Before you run it

> **Never point this at production.**
>
> The script reads its own `SFI_SMOKE_*` variables rather than the application's
> `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY`, so a `.env.local` holding
> production credentials cannot feed it by accident. It also refuses a non-local
> host unless you explicitly set `SFI_SMOKE_ALLOW_REMOTE=1`, and refuses to run
> when `NODE_ENV=production`.
>
> **It leaves rows that cannot be deleted.** `documents`, `ingestion_jobs`,
> `source_records`, `document_review_events` and `audit_logs` are append-only by
> design, because a document is evidence. The script removes the users and the
> stored object, but those rows stay. They are titled `SMOKE TEST … — safe to
> ignore`. Use a local stack or a disposable development project.

You need the migrations applied to the target project:

```bash
supabase db reset        # local
# or
supabase db push         # a development project you own
```

## Running against a local Supabase stack

The simplest and safest option — nothing you care about can be touched.

```bash
supabase start           # prints the API URL and keys
```

Then, using the values it printed:

```powershell
# PowerShell
$env:SFI_SMOKE_SUPABASE_URL   = "http://127.0.0.1:54321"
$env:SFI_SMOKE_PUBLISHABLE_KEY = "<anon / publishable key from supabase start>"
$env:SFI_SMOKE_SECRET_KEY      = "<service_role / secret key from supabase start>"
npm run smoke:storage
```

```bash
# bash
export SFI_SMOKE_SUPABASE_URL=http://127.0.0.1:54321
export SFI_SMOKE_PUBLISHABLE_KEY='<anon / publishable key>'
export SFI_SMOKE_SECRET_KEY='<service_role / secret key>'
npm run smoke:storage
```

No `SFI_SMOKE_ALLOW_REMOTE` is needed: `127.0.0.1` is recognised as local.

## Running against a development project

Only a project you are willing to leave smoke-test rows in.

```powershell
$env:SFI_SMOKE_SUPABASE_URL    = "https://<your-dev-ref>.supabase.co"
$env:SFI_SMOKE_PUBLISHABLE_KEY = "sb_publishable_..."
$env:SFI_SMOKE_SECRET_KEY      = "sb_secret_..."
$env:SFI_SMOKE_ALLOW_REMOTE    = "1"
npm run smoke:storage
```

Clear the variables afterwards so a later command cannot reuse the secret key:

```powershell
Remove-Item Env:SFI_SMOKE_SECRET_KEY, Env:SFI_SMOKE_PUBLISHABLE_KEY, Env:SFI_SMOKE_ALLOW_REMOTE
```

## Reading the result

Exit code 0 and `N passed, 0 failed` means the storage path works end to end.

Anything failing is worth stopping for. Two in particular:

- **"range request is honoured" fails with status 200.** The storage layer is
  returning whole files instead of ranges. Large PDFs will load slowly or stall in
  the browser viewer, and the TTL reasoning no longer holds.
- **"reader cannot download the object directly" fails.** A client role can reach
  the bucket. That is the guarantee `202611180002_storage_object_policies.sql`
  exists to provide — check whether a permissive policy was added to
  `storage.objects`.
