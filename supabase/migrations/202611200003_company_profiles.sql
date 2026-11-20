-- Samuel Terminal — company profiles: addressable, versioned, reviewable.
--
-- Listed companies are the centre of the product, so a company needs three things
-- this schema did not give it: a stable web address, a recorded history of every
-- change to its profile, and a listing status that can describe a company which
-- has not listed yet.
--
-- Why the history is a separate table rather than a row per version
-- ----------------------------------------------------------------
-- Observations are versioned by inserting a new row and superseding the old one:
-- that works for market_observations, economic_observations and
-- financial_statements because nothing in the schema points at an individual
-- observation. A company is not an observation, it is an identity. Six tables
-- reference companies.id — company_identifiers, instruments, documents,
-- financial_statements, announcements and editorial_items — so a new row per edit
-- would orphan every one of them.
--
-- So companies keeps the identity and the current profile, and
-- company_profile_versions is the append-only history: one row per change, with
-- the actor, the time, the reason and the full snapshot. Both are written in one
-- transaction by upsert_company_profile. Nothing is lost, every change has an
-- actor and a reason, and the current values stay where six tables expect them.
--
-- Why the address is a slug and not the ticker
-- -------------------------------------------
-- A company awaiting its IPO has no NGX symbol, so a symbol-keyed URL cannot
-- address it at all. The slug can, and it carries the same constraint as the
-- editorial slug: lowercase words joined by single hyphens, which cannot hold a
-- path segment, a scheme or a traversal. The ticker stays where it belongs, in
-- instrument_identifiers with its effective dates, so a rename is recorded rather
-- than overwritten.

-- ---------------------------------------------------------------------------
-- 1. Slug, board, pre-listing status, review fields
-- ---------------------------------------------------------------------------

-- Lowercase words joined by single hyphens, derived from a company name.
-- Immutable so it can be used in an index or a backfill without surprises.
create or replace function public.company_slug_candidate(raw text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9]+', '-', 'g'), '-'), '');
$$;

alter table public.companies add column if not exists slug text;
alter table public.companies add column if not exists listing_board text;
alter table public.companies add column if not exists reviewed_by uuid references auth.users (id) on delete set null;
alter table public.companies add column if not exists reviewed_at timestamptz;
alter table public.companies add column if not exists review_self_approved boolean not null default false;
-- Which version of the profile the reviewer actually saw. An edit does not reset
-- review_status, because a typo fix must not delist a company — but without this
-- the row would assert that a reviewer cleared content they never read.
-- reviewed_version behind the latest version is a precise, queryable
-- "approved, with changes nobody has reviewed since".
alter table public.companies add column if not exists reviewed_version integer;

-- Backfill before the not-null constraint. Collisions are resolved with a
-- counter rather than failing the migration: two companies can legitimately
-- reduce to the same slug ("Transcorp Plc" and "Trans-Corp PLC").
do $$
declare
  target record;
  base text;
  candidate text;
  suffix integer;
begin
  for target in select id, name from public.companies where slug is null loop
    base := coalesce(public.company_slug_candidate(target.name), 'company');
    if char_length(base) < 2 then
      base := base || '-co';
    end if;
    candidate := left(base, 120);
    suffix := 1;
    while exists (select 1 from public.companies where slug = candidate) loop
      suffix := suffix + 1;
      candidate := left(base, 114) || '-' || suffix::text;
    end loop;
    update public.companies set slug = candidate where id = target.id;
  end loop;
end $$;

alter table public.companies alter column slug set not null;

-- Same shape as the editorial slug, for the same reason. Two characters rather
-- than three: "UPDC" reduces to "updc", and a short name should not be forced to
-- carry padding.
alter table public.companies drop constraint if exists companies_slug_check;
alter table public.companies add constraint companies_slug_check
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 120);

create unique index if not exists companies_slug_uidx on public.companies (slug);

-- NGX wound down the Alternative Securities Market (ASeM) with effect from
-- 1 July 2025 and migrated eligible companies to the Growth Board, leaving
-- Premium, Main and Growth as the current boards. Two things are still open: how
-- the Growth Board's segments should be recorded, and that ASeM must stay
-- *recordable* for companies delisted before the wind-down. So this is free
-- reference text with a length bound, not an enumeration — the form offers the
-- known values, and a check constraint lands once the financial lead confirms the
-- list. A wrong enumeration is worse than none: it would reject real history.
alter table public.companies drop constraint if exists companies_listing_board_check;
alter table public.companies add constraint companies_listing_board_check
  check (listing_board is null or char_length(btrim(listing_board)) between 2 and 60);

-- pre_listing is a company with an offer under way and no listing yet, which the
-- IPO centre needs and which 'unlisted' does not describe.
alter table public.companies drop constraint if exists companies_listing_status_check;
alter table public.companies add constraint companies_listing_status_check
  check (listing_status in ('pre_listing', 'listed', 'suspended', 'delisted', 'unlisted'));

-- ---------------------------------------------------------------------------
-- 2. Profile history
-- ---------------------------------------------------------------------------

create table if not exists public.company_profile_versions (
  id uuid primary key default gen_random_uuid(),
  -- Cascade is the honest intent: this history belongs to the company. In
  -- practice companies are never deleted (the guard below refuses, and documents
  -- reference them), so it stands as a statement rather than a code path.
  company_id uuid not null references public.companies (id) on delete cascade,
  version integer not null check (version >= 1),
  name text not null,
  legal_name text,
  slug text not null,
  sector_id text references public.sectors (id),
  industry text,
  description text,
  website text,
  listing_status text not null,
  listing_board text,
  -- Denormalised: the symbol as it stood at this version. Reading it back from
  -- instrument_identifiers would show today's symbol against an old snapshot,
  -- which is exactly the error the history exists to prevent.
  ngx_symbol text,
  change_reason text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (company_id, version)
);

create index if not exists company_profile_versions_company_idx
  on public.company_profile_versions (company_id, version desc);

-- Append-only. Only the actor may be anonymised, which is what the foreign key
-- does when an account is deleted; a blanket refusal would block ON DELETE SET
-- NULL and make offboarding impossible, which is the lesson from the document
-- review stage.
create or replace function public.guard_company_profile_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'company_profile_versions is append-only and records history'
      using errcode = '42501';
  end if;

  -- The actor may go to null, and only to null, and only once that account is
  -- actually gone. Permitting every null-ward change would also let a stray
  -- statement blank the attribution on a version whose author still exists.
  -- During ON DELETE SET NULL the parent row has already been removed, so the
  -- referential action passes this and a gratuitous UPDATE does not.
  if (to_jsonb(new) - 'changed_by'::text) is distinct from (to_jsonb(old) - 'changed_by'::text)
     or (
       new.changed_by is distinct from old.changed_by
       and not (
         new.changed_by is null
         and not exists (select 1 from auth.users where id = old.changed_by)
       )
     ) then
    raise exception 'company_profile_versions rows are immutable; only a departed actor may be anonymised'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists company_profile_versions_guard on public.company_profile_versions;
create trigger company_profile_versions_guard before update or delete on public.company_profile_versions
for each row execute function public.guard_company_profile_version();

-- ---------------------------------------------------------------------------
-- 3. The current row changes only through the function that records the version
-- ---------------------------------------------------------------------------

-- Not a security boundary — the table grants are, and writes are service_role
-- only. This exists so a direct UPDATE from server code cannot quietly leave the
-- history incomplete, which is the one failure the history could not survive.
create or replace function public.guard_company_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Companies are not deleted; set listing_status to delisted'
      using errcode = '42501';
  end if;

  if current_setting('sfi.company_write', true) = '1' then
    return new;
  end if;

  -- updated_at is maintained by its own trigger. reviewed_by is set to null by
  -- the foreign key when an account is deleted, and that must pass — but only
  -- that: blanking the reviewer of an account that still exists would erase who
  -- cleared the profile, which is the attribution this guard is here to keep.
  if (to_jsonb(new) - 'updated_at'::text - 'reviewed_by'::text)
       is distinct from (to_jsonb(old) - 'updated_at'::text - 'reviewed_by'::text)
     or (
       new.reviewed_by is distinct from old.reviewed_by
       and not (
         new.reviewed_by is null
         and not exists (select 1 from auth.users where id = old.reviewed_by)
       )
     ) then
    raise exception 'Company profiles change through upsert_company_profile, which records the version'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Fires before companies_set_updated_at, so it compares what the caller wrote.
drop trigger if exists companies_guard on public.companies;
create trigger companies_guard before update or delete on public.companies
for each row execute function public.guard_company_row();

-- ---------------------------------------------------------------------------
-- 4. Writing a profile
-- ---------------------------------------------------------------------------

create or replace function public.upsert_company_profile(
  actor_user uuid,
  p_name text,
  p_slug text,
  p_listing_status text,
  p_company_id uuid default null,
  p_legal_name text default null,
  p_sector_id text default null,
  p_industry text default null,
  p_description text default null,
  p_website text default null,
  p_listing_board text default null,
  p_ngx_symbol text default null,
  p_change_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  company public.companies%rowtype;
  target_company uuid;
  clean_name text := btrim(coalesce(p_name, ''));
  clean_slug text;
  clean_symbol text;
  clean_board text := nullif(btrim(coalesce(p_listing_board, '')), '');
  clean_reason text := nullif(btrim(coalesce(p_change_reason, '')), '');
  current_symbol text;
  live_symbol text;
  equity_instrument uuid;
  next_version integer := 1;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not edit company profiles' using errcode = '42501';
  end if;

  if clean_name = '' then
    raise exception 'A company needs a name' using errcode = '23514';
  end if;

  clean_slug := coalesce(
    public.company_slug_candidate(p_slug),
    public.company_slug_candidate(clean_name)
  );
  if clean_slug is null then
    raise exception 'That name produces no usable web address; give the address explicitly'
      using errcode = '23514';
  end if;

  -- The same padding and truncation the backfill applies, so a very long or very
  -- short name is handled here rather than reaching companies_slug_check as a
  -- bare constraint violation.
  if char_length(clean_slug) < 2 then
    clean_slug := clean_slug || '-co';
  end if;
  if char_length(clean_slug) > 120 then
    clean_slug := btrim(left(clean_slug, 120), '-');
  end if;

  -- An NGX symbol is upper case letters and digits, sometimes with a dot. The
  -- same shape instrument_identifiers enforces, checked here for a readable
  -- message.
  clean_symbol := nullif(upper(btrim(coalesce(p_ngx_symbol, ''))), '');
  if clean_symbol is not null and clean_symbol !~ '^[A-Z][A-Z0-9.]{1,14}$' then
    raise exception 'That is not a valid NGX symbol' using errcode = '23514';
  end if;

  -- A listed company must be addressable by the symbol a reader knows. One that
  -- has not listed, or no longer trades, need not be.
  if p_listing_status = 'listed' and clean_symbol is null then
    raise exception 'A listed company must have its NGX symbol recorded' using errcode = '23514';
  end if;

  if p_company_id is null then
    perform set_config('sfi.company_write', '1', true);
    insert into public.companies (
      name, legal_name, slug, sector_id, industry, description, website,
      listing_status, listing_board
    )
    values (
      clean_name, nullif(btrim(coalesce(p_legal_name, '')), ''), clean_slug, p_sector_id,
      nullif(btrim(coalesce(p_industry, '')), ''), nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_website, '')), ''), p_listing_status, clean_board
    )
    returning id into target_company;
    perform set_config('sfi.company_write', '0', true);
  else
    select * into company from public.companies where id = p_company_id for update;
    if company.id is null then
      raise exception 'No such company: %', p_company_id using errcode = '23503';
    end if;
    if clean_reason is null then
      raise exception 'Say why the profile is changing; the change is kept as history'
        using errcode = '23514';
    end if;

    select value into current_symbol
      from public.instrument_identifiers ii
      join public.instruments i on i.id = ii.instrument_id
     where i.company_id = company.id and i.asset_class = 'equity'
       and ii.scheme = 'ngx_symbol' and ii.valid_to is null
     limit 1;

    -- Nothing to record is not an error worth a row in the history, but it is
    -- worth saying so rather than reporting a successful save.
    if clean_name = company.name
       and nullif(btrim(coalesce(p_legal_name, '')), '') is not distinct from company.legal_name
       and clean_slug = company.slug
       and p_sector_id is not distinct from company.sector_id
       and nullif(btrim(coalesce(p_industry, '')), '') is not distinct from company.industry
       and nullif(btrim(coalesce(p_description, '')), '') is not distinct from company.description
       and nullif(btrim(coalesce(p_website, '')), '') is not distinct from company.website
       and p_listing_status = company.listing_status
       and clean_board is not distinct from company.listing_board
       and clean_symbol is not distinct from current_symbol then
      raise exception 'Nothing changed' using errcode = '23514';
    end if;

    target_company := company.id;

    perform set_config('sfi.company_write', '1', true);
    update public.companies
       set name = clean_name,
           legal_name = nullif(btrim(coalesce(p_legal_name, '')), ''),
           slug = clean_slug,
           sector_id = p_sector_id,
           industry = nullif(btrim(coalesce(p_industry, '')), ''),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           website = nullif(btrim(coalesce(p_website, '')), ''),
           listing_status = p_listing_status,
           listing_board = clean_board
     where id = target_company;
    perform set_config('sfi.company_write', '0', true);
  end if;

  -- The ticker lives on the equity instrument, with effective dates, so a rename
  -- closes the old symbol and opens a new one rather than overwriting it.
  if clean_symbol is not null then
    select id into equity_instrument
      from public.instruments
     where company_id = target_company and asset_class = 'equity'
     limit 1;

    if equity_instrument is null then
      insert into public.instruments (company_id, asset_class, name, currency)
      values (target_company, 'equity', clean_name, 'NGN')
      returning id into equity_instrument;
    end if;

    select value into current_symbol
      from public.instrument_identifiers
     where instrument_id = equity_instrument and scheme = 'ngx_symbol' and valid_to is null
     limit 1;

    if current_symbol is distinct from clean_symbol then
      update public.instrument_identifiers
         set valid_to = current_date
       where instrument_id = equity_instrument and scheme = 'ngx_symbol' and valid_to is null;

      insert into public.instrument_identifiers (instrument_id, scheme, value, valid_from)
      values (equity_instrument, 'ngx_symbol', clean_symbol, current_date);
    end if;
  end if;

  -- The symbol as it actually stands once the maintenance above has run, not the
  -- argument that was passed. Omitting p_ngx_symbol leaves an existing symbol in
  -- place, so recording the argument would write null into a version whose
  -- company still carries that symbol, and the history would contradict the
  -- register it is supposed to explain.
  select ii.value into live_symbol
    from public.instrument_identifiers ii
    join public.instruments i on i.id = ii.instrument_id
   where i.company_id = target_company and i.asset_class = 'equity'
     and ii.scheme = 'ngx_symbol' and ii.valid_to is null
   limit 1;

  select coalesce(max(version), 0) + 1 into next_version
    from public.company_profile_versions where company_id = target_company;

  insert into public.company_profile_versions (
    company_id, version, name, legal_name, slug, sector_id, industry, description,
    website, listing_status, listing_board, ngx_symbol, change_reason, changed_by
  )
  select target_company, next_version, c.name, c.legal_name, c.slug, c.sector_id, c.industry,
         c.description, c.website, c.listing_status, c.listing_board, live_symbol,
         clean_reason, actor_user
    from public.companies c where c.id = target_company;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    case when p_company_id is null then 'company.created' else 'company.profile_changed' end,
    jsonb_build_object(
      'company_id', target_company,
      'version', next_version,
      'slug', clean_slug,
      'ngx_symbol', live_symbol,
      'listing_status', p_listing_status,
      'reason', clean_reason
    )
  );

  return target_company;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Review
-- ---------------------------------------------------------------------------

create or replace function public.review_company(
  target_company uuid,
  actor_user uuid,
  p_decision text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  company public.companies%rowtype;
  last_editor uuid;
  self_flag boolean := false;
  latest_version integer := 0;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not review company profiles' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'A review decision is approved or rejected' using errcode = '23514';
  end if;

  select * into company from public.companies where id = target_company for update;
  if company.id is null then
    raise exception 'No such company: %', target_company using errcode = '23503';
  end if;

  select coalesce(max(version), 0) into latest_version
    from public.company_profile_versions where company_id = target_company;

  -- An approved profile can be re-cleared once it has changed, which is what
  -- lets two-person review apply to later edits and not only to the first
  -- approval. Re-approving something nobody has touched is a no-op worth saying
  -- so about.
  if company.review_status = 'approved' and p_decision = 'approved'
     and coalesce(company.reviewed_version, 0) >= latest_version then
    raise exception 'That company is already approved, and nothing has changed since it was reviewed'
      using errcode = '23514';
  end if;

  if p_decision = 'rejected' and coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'Say why the profile is being rejected' using errcode = '23514';
  end if;

  -- Self-review is flagged, not blocked, as with documents, announcements and
  -- editorial items. The switch is a setting, not a code change.
  select changed_by into last_editor
    from public.company_profile_versions
   where company_id = target_company
   order by version desc limit 1;

  -- Unknown authorship counts as self-reviewed. If the editor's account has since
  -- been deleted the foreign key has nulled the actor, and deriving "someone
  -- independent reviewed this" from that null would assert a second pair of eyes
  -- nobody can show. The stage 2c lesson, applied here before it can bite.
  self_flag := last_editor is null or last_editor = actor_user;

  if self_flag and public.setting_bool('review.require_two_person', false) then
    raise exception 'Someone other than the person who wrote this profile must review it'
      using errcode = '42501';
  end if;

  perform set_config('sfi.company_write', '1', true);
  update public.companies
     set review_status = p_decision,
         reviewed_by = actor_user,
         reviewed_at = now(),
         review_self_approved = self_flag,
         reviewed_version = latest_version
   where id = target_company;

  -- A symbol that resolves to an unapproved instrument is a company a reader can
  -- see but cannot reach, so the instrument follows the company.
  update public.instruments
     set review_status = case when p_decision = 'approved' then 'approved' else 'rejected' end
   where company_id = target_company and asset_class = 'equity';
  perform set_config('sfi.company_write', '0', true);

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'company.' || p_decision,
    jsonb_build_object(
      'company_id', target_company,
      'self_approved', self_flag,
      'reviewed_version', latest_version,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Access
-- ---------------------------------------------------------------------------

revoke all on function public.company_slug_candidate(text) from public, anon, authenticated;
revoke all on function public.guard_company_profile_version() from public, anon, authenticated;
revoke all on function public.guard_company_row() from public, anon, authenticated;
revoke all on function public.upsert_company_profile(uuid, text, text, text, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.review_company(uuid, uuid, text, text) from public, anon, authenticated;

-- Granted back explicitly. Revoking from PUBLIC removes the implicit grant that
-- service_role otherwise relies on, so without these two lines the server's own
-- calls fail with 42501 while every test still passes: the test harness runs as
-- the migration owner and only ever switches to `authenticated`. The guard
-- functions need no grant — PostgreSQL checks EXECUTE on a trigger function when
-- the trigger is created, not when it fires — and company_slug_candidate is only
-- ever called from inside a security-definer function, which runs as its owner.
grant execute on function public.upsert_company_profile(uuid, text, text, text, uuid, text, text, text, text, text, text, text, text)
  to service_role;
grant execute on function public.review_company(uuid, uuid, text, text) to service_role;

alter table public.company_profile_versions enable row level security;

revoke all on public.company_profile_versions from anon, authenticated;
grant select on public.company_profile_versions to authenticated;
grant all on public.company_profile_versions to service_role;

-- The history is an internal record. A reader sees the current profile; who
-- changed what and why is for the desk.
drop policy if exists "Staff see company profile history" on public.company_profile_versions;
create policy "Staff see company profile history" on public.company_profile_versions
for select to authenticated using (
  public.is_platform_admin() or public.is_platform_staff()
);
