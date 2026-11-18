-- Samuel Terminal — Stage 1 data foundation.
--
-- Principles (docs/ARCHITECTURE_AND_DATA_MODEL.md):
--   * Financial values are `numeric`, never floating point.
--   * Every observation references the source record it came from (provenance).
--   * History is append-only: values are never edited in place. A correction is a new
--     version that supersedes the old one; the old row is kept with its review state.
--   * Only approved rows from active, licensed datasets are readable by end users.
--   * Demo data is never stored in these tables ('demo' is not an allowed status).
--   * Writes come from trusted server processes (service_role); clients only read.

-- ---------------------------------------------------------------------------
-- 1. Source registry: providers, licences/terms, datasets
-- ---------------------------------------------------------------------------

create table if not exists public.data_providers (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null check (char_length(name) between 1 and 160),
  short_name text not null check (char_length(short_name) between 1 and 24),
  website text check (website is null or website ~ '^https://'),
  access_model text not null check (access_model in ('licensed_api', 'official_publications', 'issuer_documents', 'internal')),
  rights_status text not null check (rights_status in ('quote_required', 'terms_unconfirmed', 'per_document', 'owned', 'approved')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Commercial terms are confidential: platform administrators only.
create table if not exists public.data_licences (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.data_providers (id),
  product text not null check (char_length(product) between 1 and 160),
  contract_ref text,
  status text not null default 'draft' check (status in ('draft', 'active', 'expired', 'terminated')),
  allows_display boolean not null default false,
  allows_redistribution boolean not null default false,
  allows_derived_data boolean not null default false,
  allows_ai_processing boolean not null default false,
  allows_export boolean not null default false,
  min_delay_minutes integer check (min_delay_minutes is null or min_delay_minutes >= 0),
  raw_retention_days integer check (raw_retention_days is null or raw_retention_days >= 0),
  attribution_text text,
  valid_from date,
  valid_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table if not exists public.datasets (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$|^[a-z][a-z0-9_]+$'),
  provider_id text not null references public.data_providers (id),
  licence_id uuid references public.data_licences (id),
  description text not null,
  frequency text not null check (frequency in ('intraday', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'per_event')),
  max_age interval,
  is_active boolean not null default false,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists datasets_provider_idx on public.datasets (provider_id);

-- A dataset can only be switched on with a recorded, active licence/terms basis that
-- permits display — except SFI's own internal datasets.
create or replace function public.enforce_dataset_activation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  provider_access text;
  licence_ok boolean;
begin
  if not new.is_active then
    return new;
  end if;
  select access_model into provider_access from public.data_providers where id = new.provider_id;
  if provider_access = 'internal' then
    return new;
  end if;
  select exists (
    select 1 from public.data_licences l
    where l.id = new.licence_id
      and l.provider_id = new.provider_id
      and l.status = 'active'
      and l.allows_display
      and (l.valid_to is null or l.valid_to >= current_date)
  ) into licence_ok;
  if not licence_ok then
    raise exception 'Dataset % cannot be activated without an active licence that permits display', new.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists datasets_enforce_activation on public.datasets;
create trigger datasets_enforce_activation before insert or update on public.datasets
for each row execute function public.enforce_dataset_activation();

-- ---------------------------------------------------------------------------
-- 2. Reference data: sectors, companies, instruments
-- ---------------------------------------------------------------------------

create table if not exists public.sectors (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text not null unique,
  classification text not null default 'ngx'
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  legal_name text,
  sector_id text references public.sectors (id),
  industry text,
  description text,
  website text check (website is null or website ~ '^https?://'),
  listing_status text not null default 'listed' check (listing_status in ('listed', 'suspended', 'delisted', 'unlisted')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_identifiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  scheme text not null check (scheme in ('rc_number', 'lei', 'provider_code')),
  value text not null check (char_length(value) between 1 and 64),
  provider_id text references public.data_providers (id),
  valid_from date not null default current_date,
  valid_to date,
  check (valid_to is null or valid_to >= valid_from),
  check ((scheme = 'provider_code') = (provider_id is not null))
);

create unique index if not exists company_identifiers_current_value_uidx
  on public.company_identifiers (scheme, coalesce(provider_id, ''), value) where valid_to is null;

create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id),
  asset_class text not null check (asset_class in ('equity', 'index', 'etp', 'fgn_bond', 'ntb', 'savings_bond', 'sukuk', 'corporate_bond', 'fx_rate')),
  name text not null check (char_length(name) between 1 and 200),
  currency char(3) not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  issue_date date,
  maturity_date date,
  coupon_rate numeric(12, 6) check (coupon_rate is null or coupon_rate >= 0),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (maturity_date is null or issue_date is null or maturity_date >= issue_date),
  check (asset_class <> 'equity' or company_id is not null)
);

create index if not exists instruments_company_idx on public.instruments (company_id);

-- Symbols and codes change over time (renames, re-listings); keep effective dates.
create table if not exists public.instrument_identifiers (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments (id) on delete cascade,
  scheme text not null check (scheme in ('ngx_symbol', 'isin', 'fmdq_code', 'provider_code')),
  value text not null check (char_length(value) between 1 and 64),
  provider_id text references public.data_providers (id),
  valid_from date not null default current_date,
  valid_to date,
  check (valid_to is null or valid_to >= valid_from),
  check ((scheme = 'provider_code') = (provider_id is not null)),
  check (scheme <> 'ngx_symbol' or value ~ '^[A-Z][A-Z0-9.]{1,14}$'),
  check (scheme <> 'isin' or value ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$')
);

create unique index if not exists instrument_identifiers_current_value_uidx
  on public.instrument_identifiers (scheme, coalesce(provider_id, ''), value) where valid_to is null;
create unique index if not exists instrument_identifiers_current_scheme_uidx
  on public.instrument_identifiers (instrument_id, scheme, coalesce(provider_id, '')) where valid_to is null;

-- ---------------------------------------------------------------------------
-- 3. Documents (stored privately in object storage; metadata here)
-- ---------------------------------------------------------------------------

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references public.data_providers (id),
  company_id uuid references public.companies (id),
  kind text not null check (kind in ('annual_report', 'interim_report', 'financial_statements', 'presentation', 'announcement', 'regulatory_filing', 'statistical_release', 'auction_result', 'circular', 'other')),
  title text not null check (char_length(title) between 1 and 300),
  published_at timestamptz,
  period_end date,
  source_uri text check (source_uri is null or source_uri ~ '^https?://'),
  storage_path text unique,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  licence_class text not null check (licence_class in ('licensed', 'public_official', 'issuer_document', 'sfi_original', 'unverified')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  uploaded_by uuid references auth.users (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists documents_company_idx on public.documents (company_id, published_at desc);
create index if not exists documents_pending_idx on public.documents (created_at) where review_status = 'pending';

-- Machine extraction output. Never authoritative until a reviewer approves the
-- resulting statements/observations.
create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  extractor text not null,
  extractor_version text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  output jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists document_extractions_document_idx on public.document_extractions (document_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Ingestion and provenance
-- ---------------------------------------------------------------------------

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  dataset_id text not null references public.datasets (id),
  trigger text not null check (trigger in ('scheduled', 'manual', 'upload', 'backfill')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled')),
  requested_by uuid references auth.users (id) on delete set null,
  parameters jsonb not null default '{}'::jsonb,
  records_received integer not null default 0 check (records_received >= 0),
  records_accepted integer not null default 0 check (records_accepted >= 0),
  records_quarantined integer not null default 0 check (records_quarantined >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  records_duplicate integer not null default 0 check (records_duplicate >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check (finished_at is null or started_at is null or finished_at >= started_at)
);

create index if not exists ingestion_jobs_dataset_idx on public.ingestion_jobs (dataset_id, created_at desc);
create index if not exists ingestion_jobs_failed_idx on public.ingestion_jobs (created_at desc) where status in ('failed', 'partially_succeeded');

-- One row per record received from a provider or extracted from a document.
-- Identical content for the same dataset is a duplicate and is rejected by the unique key.
create table if not exists public.source_records (
  id uuid primary key default gen_random_uuid(),
  dataset_id text not null references public.datasets (id),
  job_id uuid references public.ingestion_jobs (id) on delete set null,
  document_id uuid references public.documents (id),
  provider_record_id text,
  source_uri text,
  source_page integer check (source_page is null or source_page > 0),
  retrieved_at timestamptz not null,
  published_at timestamptz,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- Raw payload, kept only where the licence permits retention (see data_licences.raw_retention_days).
  payload jsonb,
  created_at timestamptz not null default now(),
  unique (dataset_id, content_sha256)
);

create index if not exists source_records_job_idx on public.source_records (job_id);

create table if not exists public.data_quality_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.ingestion_jobs (id) on delete cascade,
  source_record_id uuid references public.source_records (id) on delete cascade,
  check_name text not null check (char_length(check_name) between 1 and 80),
  outcome text not null check (outcome in ('pass', 'warn', 'fail')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (job_id is not null or source_record_id is not null)
);

create index if not exists data_quality_checks_failures_idx on public.data_quality_checks (created_at desc) where outcome <> 'pass';

-- ---------------------------------------------------------------------------
-- 5. Versioned observations (the historical database)
-- ---------------------------------------------------------------------------

-- Review lifecycle: pending -> approved | rejected; approved -> superseded.
create table if not exists public.market_observations (
  id bigint generated always as identity primary key,
  instrument_id uuid not null references public.instruments (id),
  field text not null check (field in ('open', 'high', 'low', 'close', 'previous_close', 'volume', 'value', 'deals', 'market_cap', 'index_level', 'price', 'yield')),
  observed_at timestamptz not null,
  value numeric not null,
  unit text not null check (unit in ('NGN', 'USD', 'percent', 'percent_per_annum', 'index_points', 'shares', 'count', 'NGN_per_USD')),
  rate_concept text check (rate_concept in ('coupon', 'stop_rate', 'market_yield', 'indicative')),
  status text not null check (status in ('real_time', 'delayed', 'end_of_day', 'historical')),
  source_record_id uuid not null references public.source_records (id),
  version integer not null default 1 check (version >= 1),
  supersedes_id bigint references public.market_observations (id),
  correction_reason text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (instrument_id, field, observed_at, version),
  check (version = 1 or (supersedes_id is not null and correction_reason is not null)),
  check ((field = 'yield') = (rate_concept is not null))
);

create unique index if not exists market_observations_one_approved_uidx
  on public.market_observations (instrument_id, field, observed_at) where review_status = 'approved';
create index if not exists market_observations_series_idx
  on public.market_observations (instrument_id, field, observed_at desc) where review_status = 'approved';
create index if not exists market_observations_pending_idx
  on public.market_observations (created_at) where review_status = 'pending';

create table if not exists public.economic_series (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  dataset_id text not null references public.datasets (id),
  provider_id text not null references public.data_providers (id),
  name text not null,
  unit text not null check (unit in ('NGN', 'USD', 'percent', 'percent_per_annum', 'NGN_per_USD', 'barrels_per_day', 'count')),
  magnitude text not null default 'units' check (magnitude in ('units', 'thousands', 'millions', 'billions', 'trillions')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'per_event')),
  definition text not null,
  caveat text,
  created_at timestamptz not null default now()
);

-- Reference period (period_start..period_end) is distinct from publication date.
-- Revisions by the publisher are new versions; every vintage is retained.
create table if not exists public.economic_observations (
  id bigint generated always as identity primary key,
  series_id text not null references public.economic_series (id),
  period_start date not null,
  period_end date not null,
  value numeric not null,
  published_at timestamptz not null,
  source_record_id uuid not null references public.source_records (id),
  version integer not null default 1 check (version >= 1),
  supersedes_id bigint references public.economic_observations (id),
  correction_reason text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (series_id, period_start, period_end, version),
  check (version = 1 or (supersedes_id is not null and correction_reason is not null))
);

create unique index if not exists economic_observations_one_approved_uidx
  on public.economic_observations (series_id, period_start, period_end) where review_status = 'approved';
create index if not exists economic_observations_series_idx
  on public.economic_observations (series_id, period_end desc) where review_status = 'approved';

-- Company financial statements: one row per statement and reporting period, with lines.
create table if not exists public.financial_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  statement_type text not null check (statement_type in ('income', 'balance_sheet', 'cash_flow')),
  period_type text not null check (period_type in ('FY', 'H1', 'Q1', 'Q2', 'Q3', 'Q4', '9M')),
  period_start date not null,
  period_end date not null,
  audited boolean not null,
  consolidated boolean not null default true,
  currency char(3) not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  magnitude text not null default 'thousands' check (magnitude in ('units', 'thousands', 'millions', 'billions')),
  published_at timestamptz,
  document_id uuid references public.documents (id),
  source_record_id uuid not null references public.source_records (id),
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references public.financial_statements (id),
  correction_reason text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end > period_start),
  unique (company_id, statement_type, period_type, period_end, consolidated, version),
  check (version = 1 or (supersedes_id is not null and correction_reason is not null))
);

create unique index if not exists financial_statements_one_approved_uidx
  on public.financial_statements (company_id, statement_type, period_type, period_end, consolidated) where review_status = 'approved';

create table if not exists public.financial_statement_lines (
  statement_id uuid not null references public.financial_statements (id) on delete restrict,
  line_item text not null check (line_item ~ '^[a-z][a-z0-9_]{1,63}$'),
  value numeric not null,
  source_page integer check (source_page is null or source_page > 0),
  primary key (statement_id, line_item)
);

-- ---------------------------------------------------------------------------
-- 6. History guarantees: immutable values, controlled review transitions
-- ---------------------------------------------------------------------------

-- Values are never edited or deleted. Only review fields may change, and only along
-- allowed transitions. Corrections are inserted as new versions.
create or replace function public.guard_versioned_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  review_cols text[] := array['review_status', 'reviewed_by', 'reviewed_at'];
begin
  if tg_op = 'DELETE' then
    raise exception '% rows are append-only and cannot be deleted', tg_table_name using errcode = '42501';
  end if;

  if (to_jsonb(new) - review_cols) is distinct from (to_jsonb(old) - review_cols) then
    raise exception '% values are immutable; insert a new version to correct them', tg_table_name using errcode = '42501';
  end if;

  if new.review_status is distinct from old.review_status and not (
    (old.review_status = 'pending' and new.review_status in ('approved', 'rejected'))
    or (old.review_status = 'approved' and new.review_status = 'superseded')
  ) then
    raise exception 'Invalid review transition % -> % on %', old.review_status, new.review_status, tg_table_name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- When a row is approved, the previously approved row for the same key becomes
-- 'superseded'. TG_ARGV lists the key columns that identify "the same value".
create or replace function public.supersede_previous_approved()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  key_match text;
begin
  if new.review_status <> 'approved' or old.review_status = 'approved' then
    return new;
  end if;
  select string_agg(format('t.%1$I is not distinct from ($1).%1$I', col), ' and ')
    into key_match
    from unnest(tg_argv) as col;
  execute format(
    'update %I.%I t set review_status = ''superseded'' where t.review_status = ''approved'' and t.id <> ($1).id and %s',
    tg_table_schema, tg_table_name, key_match
  ) using new;
  return new;
end;
$$;

drop trigger if exists market_observations_guard on public.market_observations;
create trigger market_observations_guard before update or delete on public.market_observations
for each row execute function public.guard_versioned_row();
drop trigger if exists market_observations_supersede on public.market_observations;
create trigger market_observations_supersede before update of review_status on public.market_observations
for each row execute function public.supersede_previous_approved('instrument_id', 'field', 'observed_at');

drop trigger if exists economic_observations_guard on public.economic_observations;
create trigger economic_observations_guard before update or delete on public.economic_observations
for each row execute function public.guard_versioned_row();
drop trigger if exists economic_observations_supersede on public.economic_observations;
create trigger economic_observations_supersede before update of review_status on public.economic_observations
for each row execute function public.supersede_previous_approved('series_id', 'period_start', 'period_end');

drop trigger if exists financial_statements_guard on public.financial_statements;
create trigger financial_statements_guard before update or delete on public.financial_statements
for each row execute function public.guard_versioned_row();
drop trigger if exists financial_statements_supersede on public.financial_statements;
create trigger financial_statements_supersede before update of review_status on public.financial_statements
for each row execute function public.supersede_previous_approved('company_id', 'statement_type', 'period_type', 'period_end', 'consolidated');

-- Statement lines belong to one immutable statement version.
create or replace function public.guard_statement_lines()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'financial_statement_lines are immutable; insert a new statement version' using errcode = '42501';
  end if;
  select review_status into parent_status from public.financial_statements where id = new.statement_id;
  if parent_status is distinct from 'pending' then
    raise exception 'Lines can only be added to a pending statement' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists financial_statement_lines_guard on public.financial_statement_lines;
create trigger financial_statement_lines_guard before insert or update or delete on public.financial_statement_lines
for each row execute function public.guard_statement_lines();

-- updated_at maintenance (function from the Phase 1 migration).
drop trigger if exists data_providers_set_updated_at on public.data_providers;
create trigger data_providers_set_updated_at before update on public.data_providers for each row execute function public.set_updated_at();
drop trigger if exists data_licences_set_updated_at on public.data_licences;
create trigger data_licences_set_updated_at before update on public.data_licences for each row execute function public.set_updated_at();
drop trigger if exists datasets_set_updated_at on public.datasets;
create trigger datasets_set_updated_at before update on public.datasets for each row execute function public.set_updated_at();
drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at before update on public.companies for each row execute function public.set_updated_at();
drop trigger if exists instruments_set_updated_at on public.instruments;
create trigger instruments_set_updated_at before update on public.instruments for each row execute function public.set_updated_at();

revoke all on function public.enforce_dataset_activation() from public, anon, authenticated;
revoke all on function public.guard_versioned_row() from public, anon, authenticated;
revoke all on function public.supersede_previous_approved() from public, anon, authenticated;
revoke all on function public.guard_statement_lines() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Access control
-- ---------------------------------------------------------------------------

-- True when the source record belongs to a dataset that is currently active (licensed
-- for display). Deactivating a dataset hides its data from users immediately.
create or replace function public.is_displayable_source(target_source uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.source_records s
    join public.datasets d on d.id = s.dataset_id
    where s.id = target_source and d.is_active
  );
$$;

revoke all on function public.is_displayable_source(uuid) from public;
grant execute on function public.is_displayable_source(uuid) to authenticated;

alter table public.data_providers enable row level security;
alter table public.data_licences enable row level security;
alter table public.datasets enable row level security;
alter table public.sectors enable row level security;
alter table public.companies enable row level security;
alter table public.company_identifiers enable row level security;
alter table public.instruments enable row level security;
alter table public.instrument_identifiers enable row level security;
alter table public.documents enable row level security;
alter table public.document_extractions enable row level security;
alter table public.ingestion_jobs enable row level security;
alter table public.source_records enable row level security;
alter table public.data_quality_checks enable row level security;
alter table public.market_observations enable row level security;
alter table public.economic_series enable row level security;
alter table public.economic_observations enable row level security;
alter table public.financial_statements enable row level security;
alter table public.financial_statement_lines enable row level security;

revoke all on
  public.data_providers, public.data_licences, public.datasets, public.sectors, public.companies,
  public.company_identifiers, public.instruments, public.instrument_identifiers, public.documents,
  public.document_extractions, public.ingestion_jobs, public.source_records, public.data_quality_checks,
  public.market_observations, public.economic_series, public.economic_observations,
  public.financial_statements, public.financial_statement_lines
from anon, authenticated;

-- Clients read only; all writes go through trusted server processes.
grant select on
  public.data_providers, public.data_licences, public.datasets, public.sectors, public.companies,
  public.company_identifiers, public.instruments, public.instrument_identifiers, public.documents,
  public.document_extractions, public.ingestion_jobs, public.source_records, public.data_quality_checks,
  public.market_observations, public.economic_series, public.economic_observations,
  public.financial_statements, public.financial_statement_lines
to authenticated;

grant all on
  public.data_providers, public.data_licences, public.datasets, public.sectors, public.companies,
  public.company_identifiers, public.instruments, public.instrument_identifiers, public.documents,
  public.document_extractions, public.ingestion_jobs, public.source_records, public.data_quality_checks,
  public.market_observations, public.economic_series, public.economic_observations,
  public.financial_statements, public.financial_statement_lines
to service_role;

-- Registry metadata (no commercial terms) is visible to signed-in users.
drop policy if exists "Signed-in users can view providers" on public.data_providers;
create policy "Signed-in users can view providers" on public.data_providers
for select to authenticated using (true);

drop policy if exists "Signed-in users can view datasets" on public.datasets;
create policy "Signed-in users can view datasets" on public.datasets
for select to authenticated using (true);

drop policy if exists "Signed-in users can view sectors" on public.sectors;
create policy "Signed-in users can view sectors" on public.sectors
for select to authenticated using (true);

drop policy if exists "Signed-in users can view series definitions" on public.economic_series;
create policy "Signed-in users can view series definitions" on public.economic_series
for select to authenticated using (true);

-- Licences and pipeline internals: platform administrators only.
drop policy if exists "Admins can view licences" on public.data_licences;
create policy "Admins can view licences" on public.data_licences
for select to authenticated using (public.is_platform_admin());

drop policy if exists "Admins can view ingestion jobs" on public.ingestion_jobs;
create policy "Admins can view ingestion jobs" on public.ingestion_jobs
for select to authenticated using (public.is_platform_admin());

drop policy if exists "Admins can view source records" on public.source_records;
create policy "Admins can view source records" on public.source_records
for select to authenticated using (public.is_platform_admin());

drop policy if exists "Admins can view quality checks" on public.data_quality_checks;
create policy "Admins can view quality checks" on public.data_quality_checks
for select to authenticated using (public.is_platform_admin());

drop policy if exists "Admins can view extractions" on public.document_extractions;
create policy "Admins can view extractions" on public.document_extractions
for select to authenticated using (public.is_platform_admin());

-- Reviewed reference data: users see approved rows; admins see the review queue too.
drop policy if exists "Users can view approved companies" on public.companies;
create policy "Users can view approved companies" on public.companies
for select to authenticated using (review_status = 'approved' or public.is_platform_admin());

drop policy if exists "Users can view identifiers of approved companies" on public.company_identifiers;
create policy "Users can view identifiers of approved companies" on public.company_identifiers
for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.companies c where c.id = company_id and c.review_status = 'approved')
);

drop policy if exists "Users can view approved instruments" on public.instruments;
create policy "Users can view approved instruments" on public.instruments
for select to authenticated using (review_status = 'approved' or public.is_platform_admin());

drop policy if exists "Users can view identifiers of approved instruments" on public.instrument_identifiers;
create policy "Users can view identifiers of approved instruments" on public.instrument_identifiers
for select to authenticated using (
  public.is_platform_admin()
  or exists (select 1 from public.instruments i where i.id = instrument_id and i.review_status = 'approved')
);

drop policy if exists "Users can view approved documents" on public.documents;
create policy "Users can view approved documents" on public.documents
for select to authenticated using (
  public.is_platform_admin()
  or (review_status = 'approved' and licence_class <> 'unverified')
);

-- Observations: approved AND from an active (licensed) dataset.
drop policy if exists "Users can view approved market observations" on public.market_observations;
create policy "Users can view approved market observations" on public.market_observations
for select to authenticated using (
  public.is_platform_admin()
  or (review_status = 'approved' and public.is_displayable_source(source_record_id))
);

drop policy if exists "Users can view approved economic observations" on public.economic_observations;
create policy "Users can view approved economic observations" on public.economic_observations
for select to authenticated using (
  public.is_platform_admin()
  or (review_status = 'approved' and public.is_displayable_source(source_record_id))
);

drop policy if exists "Users can view approved statements" on public.financial_statements;
create policy "Users can view approved statements" on public.financial_statements
for select to authenticated using (
  public.is_platform_admin()
  or (review_status = 'approved' and public.is_displayable_source(source_record_id))
);

drop policy if exists "Users can view lines of approved statements" on public.financial_statement_lines;
create policy "Users can view lines of approved statements" on public.financial_statement_lines
for select to authenticated using (
  public.is_platform_admin()
  or exists (
    select 1 from public.financial_statements s
    where s.id = statement_id and s.review_status = 'approved' and public.is_displayable_source(s.source_record_id)
  )
);

-- ---------------------------------------------------------------------------
-- 8. Private document storage (Supabase Storage). Skipped where the storage
--    schema does not exist (e.g. local test databases).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'source-documents', 'source-documents', false, 52428800,
      array['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']
    )
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Seed reference data (idempotent). Mirrors lib/providers/registry.ts and
--    lib/catalog/*; a unit test keeps them in sync. All datasets start inactive.
-- ---------------------------------------------------------------------------

insert into public.data_providers (id, name, short_name, website, access_model, rights_status) values
  ('ngx', 'Nigerian Exchange Group', 'NGX', 'https://ngxgroup.com/exchange/data/', 'licensed_api', 'quote_required'),
  ('fmdq', 'FMDQ Group', 'FMDQ', 'https://fmdqgroup.com/exchange/market-data/', 'licensed_api', 'quote_required'),
  ('cbn', 'Central Bank of Nigeria', 'CBN', 'https://www.cbn.gov.ng/', 'official_publications', 'terms_unconfirmed'),
  ('nbs', 'National Bureau of Statistics', 'NBS', 'https://www.nigerianstat.gov.ng/', 'official_publications', 'terms_unconfirmed'),
  ('dmo', 'Debt Management Office', 'DMO', 'https://www.dmo.gov.ng/', 'official_publications', 'terms_unconfirmed'),
  ('sec', 'Securities and Exchange Commission Nigeria', 'SEC', 'https://sec.gov.ng/', 'official_publications', 'terms_unconfirmed'),
  ('nuprc', 'Nigerian Upstream Petroleum Regulatory Commission', 'NUPRC', 'https://www.nuprc.gov.ng/', 'official_publications', 'terms_unconfirmed'),
  ('issuer_ir', 'Issuer investor-relations sites', 'Issuers', null, 'issuer_documents', 'per_document'),
  ('sfi', 'Samuel Financial Intelligence', 'SFI', null, 'internal', 'owned')
on conflict (id) do nothing;

insert into public.datasets (id, provider_id, description, frequency) values
  ('equities.indices', 'ngx', 'NGX index levels and changes', 'daily'),
  ('equities.breadth', 'ngx', 'Advancing, declining and unchanged counts', 'daily'),
  ('equities.activity', 'ngx', 'Market capitalisation, volume, value and deals', 'daily'),
  ('equities.prices', 'ngx', 'Listed equity prices, volume and value', 'daily'),
  ('equities.movers', 'ngx', 'Top gainers, losers and most active', 'daily'),
  ('equities.sectors', 'ngx', 'Sector index performance', 'daily'),
  ('companies.reference', 'ngx', 'Listed company and security reference data', 'daily'),
  ('companies.financials', 'issuer_ir', 'Financial statements from issuer filings', 'quarterly'),
  ('companies.documents', 'issuer_ir', 'Issuer reports, presentations and announcements', 'per_event'),
  ('corporate_actions', 'ngx', 'Dividends, bonuses, rights, offers and other corporate actions', 'per_event'),
  ('economy.observations', 'nbs', 'Macroeconomic series (series-level source in economic_series)', 'monthly'),
  ('fixed_income.instruments', 'dmo', 'FGN bond, savings bond and sukuk terms', 'per_event'),
  ('fixed_income.auctions', 'dmo', 'Primary auction offers and results', 'per_event'),
  ('fixed_income.yields', 'fmdq', 'Secondary-market prices and yields', 'daily'),
  ('news.items', 'sfi', 'SFI editorial items and summaries', 'per_event'),
  ('research.reports', 'sfi', 'SFI research reports', 'per_event')
on conflict (id) do nothing;

insert into public.sectors (id, name) values
  ('agriculture', 'Agriculture'),
  ('conglomerates', 'Conglomerates'),
  ('construction_real_estate', 'Construction/Real Estate'),
  ('consumer_goods', 'Consumer Goods'),
  ('financial_services', 'Financial Services'),
  ('healthcare', 'Healthcare'),
  ('ict', 'ICT'),
  ('industrial_goods', 'Industrial Goods'),
  ('natural_resources', 'Natural Resources'),
  ('oil_and_gas', 'Oil and Gas'),
  ('services', 'Services'),
  ('utilities', 'Utilities')
on conflict (id) do nothing;

insert into public.economic_series (id, dataset_id, provider_id, name, unit, magnitude, frequency, definition, caveat) values
  ('cpi-headline-yoy', 'economy.observations', 'nbs', 'Headline inflation', 'percent', 'units', 'monthly', 'Year-on-year change in the all-items Consumer Price Index for the reference month.', 'NBS rebased the CPI in 2025. Compare across the rebasing only with the published linking method.'),
  ('cpi-food-yoy', 'economy.observations', 'nbs', 'Food inflation', 'percent', 'units', 'monthly', 'Year-on-year change in the food sub-index of the CPI for the reference month.', null),
  ('gdp-real-growth-yoy', 'economy.observations', 'nbs', 'Real GDP growth', 'percent', 'units', 'quarterly', 'Year-on-year change in real gross domestic product for the reference quarter.', 'Subject to revision and rebasing. Each published vintage is stored separately.'),
  ('mpr', 'economy.observations', 'cbn', 'Monetary policy rate', 'percent_per_annum', 'units', 'per_event', 'Benchmark policy rate set by the CBN Monetary Policy Committee, effective from the decision date.', null),
  ('usdngn-official', 'economy.observations', 'cbn', 'USD/NGN official rate', 'NGN_per_USD', 'units', 'daily', 'Official naira per US dollar reference rate for the trading day.', 'The exact official series to display must be confirmed with CBN/FMDQ before activation.'),
  ('fx-reserves-gross', 'economy.observations', 'cbn', 'Gross external reserves', 'USD', 'billions', 'daily', 'Gross foreign exchange reserves held by the CBN at the reference date.', null),
  ('trade-balance', 'economy.observations', 'nbs', 'Merchandise trade balance', 'NGN', 'billions', 'quarterly', 'Value of merchandise exports minus imports for the reference quarter.', null),
  ('public-debt-total', 'economy.observations', 'dmo', 'Total public debt', 'NGN', 'trillions', 'quarterly', 'Total public debt stock (federal, state and FCT; domestic and external) at period end.', null),
  ('ntb-364d-stop-rate', 'economy.observations', 'cbn', '364-day NTB stop rate', 'percent_per_annum', 'units', 'per_event', 'Marginal (stop) rate at the primary Nigerian Treasury Bills auction for the 364-day tenor.', 'Primary auction result. Not a secondary-market yield.'),
  ('unemployment-rate', 'economy.observations', 'nbs', 'Unemployment rate', 'percent', 'units', 'quarterly', 'Share of the labour force without work and available for work in the reference period.', 'NBS revised its labour-force methodology in 2023; earlier figures are not directly comparable.'),
  ('crude-oil-production', 'economy.observations', 'nuprc', 'Crude oil production', 'barrels_per_day', 'millions', 'monthly', 'Average daily crude oil production for the reference month.', 'Confirm whether condensate is included in the chosen series.')
on conflict (id) do nothing;
