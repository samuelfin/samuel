-- Samuel Terminal — people and leadership: who runs these companies, and since when.
--
-- A company's leadership is the first thing on this platform that is a statement
-- about a named private individual rather than about a corporate entity, and that
-- changes what the schema has to guarantee. Three differences drive the design.
--
-- Every role must cite its evidence
-- ---------------------------------
-- A figure that cannot be traced is not publishable, and a claim that a named
-- person held an office is held to the same standard: each role resolves to an
-- approved document and the page it appears on, or to a published announcement.
-- The constraint is the one editorial_citations uses, for the same reason — a
-- citation that points at two things supports neither — and a trigger checks the
-- cited source is actually approved, so the desk cannot offer a source the
-- database then refuses with a bare 23514.
--
-- Precision is recorded, not invented
-- -----------------------------------
-- Older annual reports say "appointed 2015", not "appointed 12 March 2015".
-- Storing 2015-01-01 for that would fabricate a precision the filing does not
-- have, and it would be invisible afterwards because the column looks like any
-- other date. So each tenure boundary carries its own precision and the page
-- renders only what the source actually said. This is cheap now and a
-- re-read-every-filing problem if it arrives later.
--
-- A wrong claim about a person is withdrawn, not kept on display
-- -------------------------------------------------------------
-- Everywhere else on this platform a correction stays visible: a withdrawn
-- announcement is still shown, labelled, because something that vanishes is worse
-- than something openly retracted. Personal data inverts that. If we said someone
-- was CFO and they never were, continuing to publish the claim is the accuracy
-- failure, so a withdrawn role leaves the published leadership record and survives
-- in the history and the desk. Nothing is deleted; the reader simply stops seeing
-- a statement we no longer stand behind.
--
-- Deliberately absent: date of birth, address, family, photographs, nationality,
-- gender, education, remuneration. Not "not yet" — the columns do not exist, so no
-- desk can quietly begin collecting them. Role and tenure taken from a company's
-- own filings is the narrowest personal data that answers the question, and
-- widening it is a decision for the CEO and counsel, not a migration.

-- ---------------------------------------------------------------------------
-- 1. The role catalogue
-- ---------------------------------------------------------------------------

-- A catalogue table rather than a CHECK constraint, following sectors: this list
-- will grow, and a new office should not need a migration that rewrites a
-- constraint. The two booleans let the company page split executives from the
-- board without a hard-coded list in TypeScript — an executive director is both,
-- a chairman is board but not executive, a company secretary sits with the
-- executives on a filing without being a director.
create table if not exists public.person_role_catalogue (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text not null unique check (char_length(btrim(name)) between 2 and 80),
  is_executive boolean not null default false,
  is_board boolean not null default false,
  sort_order integer not null default 100
);

-- The offices Nigerian filings actually name. "Group Managing Director/CEO" is
-- how the banks title the role and it is not interchangeable with a plain
-- managing director, so it is its own code. The independent/non-independent
-- director split matters for governance reporting and is painful to separate
-- afterwards, so it is recorded from the start.
insert into public.person_role_catalogue (id, name, is_executive, is_board, sort_order) values
  ('chair',                              'Chairman',                           false, true,  10),
  ('vice_chair',                         'Vice Chairman',                      false, true,  20),
  ('ceo',                                'Chief Executive Officer',            true,  false, 30),
  ('gmd_ceo',                            'Group Managing Director/CEO',        true,  true,  31),
  ('md',                                 'Managing Director',                  true,  false, 32),
  ('deputy_md',                          'Deputy Managing Director',           true,  false, 33),
  ('executive_director',                 'Executive Director',                 true,  true,  40),
  ('cfo',                                'Chief Financial Officer',            true,  false, 50),
  ('coo',                                'Chief Operating Officer',            true,  false, 51),
  ('chief_risk_officer',                 'Chief Risk Officer',                 true,  false, 52),
  ('chief_compliance_officer',           'Chief Compliance Officer',           true,  false, 53),
  ('head_internal_audit',                'Head of Internal Audit',             true,  false, 54),
  ('company_secretary',                  'Company Secretary',                  true,  false, 60),
  ('non_executive_director',             'Non-Executive Director',             false, true,  70),
  ('independent_non_executive_director', 'Independent Non-Executive Director', false, true,  71)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. People
-- ---------------------------------------------------------------------------

-- Lowercase words joined by single hyphens, derived from a person's name. Kept
-- separate from company_slug_candidate deliberately: the two differ in how a
-- collision is handled. Two companies reducing to the same slug is resolved with
-- a counter, because "Transcorp Plc" and "Trans-Corp PLC" are genuinely different
-- registrants. Two people sharing a name is the identity problem this platform
-- must never guess at, so it is refused and handed back to the analyst.
create or replace function public.person_slug_candidate(raw text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9]+', '-', 'g'), '-'), '');
$$;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 120),
  -- A control character in a name is never a name. The TypeScript layer checks
  -- this too, but personal data earns the belt and the braces: this value is
  -- published beside a company's figures, and a field like this is where a
  -- smuggled newline would hide.
  full_name text not null check (char_length(btrim(full_name)) between 2 and 200 and full_name !~ '[[:cntrl:]]'),
  -- Chief, Dr, Alhaji, HRM. Public, carried on the filing itself, and omitting it
  -- means the stored record does not match its source — the opposite of the "as
  -- reported" discipline everything else here follows.
  honorific text check (honorific is null or (char_length(btrim(honorific)) between 1 and 40 and honorific !~ '[[:cntrl:]]')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_self_approved boolean not null default false,
  -- Which version the reviewer actually read. An edit does not reset
  -- review_status — correcting a spelling must not unpublish a person — so
  -- without this the row would assert clearance of content nobody saw.
  reviewed_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists people_slug_uidx on public.people (slug);
create index if not exists people_review_idx on public.people (review_status);

create table if not exists public.person_versions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  version integer not null check (version >= 1),
  slug text not null,
  full_name text not null,
  honorific text,
  change_reason text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (person_id, version)
);

create index if not exists person_versions_person_idx
  on public.person_versions (person_id, version desc);

-- ---------------------------------------------------------------------------
-- 3. Roles held at companies
-- ---------------------------------------------------------------------------

create table if not exists public.company_roles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role_code text not null references public.person_role_catalogue (id),
  -- The title exactly as the filing gives it, beside the canonical code. Both
  -- matter: the code makes the record queryable, the title keeps it faithful to
  -- the document a reader will check it against.
  role_title text check (role_title is null or (char_length(btrim(role_title)) between 2 and 200 and role_title !~ '[[:cntrl:]]')),
  -- An acting appointment is a different fact from a substantive one, and during
  -- a handover a company legitimately has both. Recorded, never inferred.
  is_acting boolean not null default false,

  valid_from date not null,
  valid_from_precision text not null default 'day' check (valid_from_precision in ('day', 'month', 'year')),
  valid_to date,
  valid_to_precision text check (valid_to_precision in ('day', 'month', 'year')),
  check (valid_to is null or valid_to >= valid_from),
  -- A precision without a date, or a date without its precision, would leave the
  -- page unable to say how much the source actually told us.
  check ((valid_to is null) = (valid_to_precision is null)),

  -- The evidence for the role itself. Exactly one source, as with an editorial
  -- citation: a citation pointing at two things supports neither.
  document_id uuid references public.documents (id),
  source_page integer check (source_page is null or source_page > 0),
  announcement_id uuid references public.announcements (id),
  check ((document_id is not null)::integer + (announcement_id is not null)::integer = 1),
  check (announcement_id is null or source_page is null),
  -- A document citation without a page is not checkable. An announcement is one
  -- document about one event, so it needs none.
  check (document_id is null or source_page is not null),

  -- When this role was last verified as still current, and what verified it. A
  -- board list in last year's annual report is evidence that someone held office
  -- then, not that they hold it now, and a register that cannot tell those apart
  -- goes quietly stale.
  last_confirmed_on date,
  last_confirmed_document_id uuid references public.documents (id),
  last_confirmed_source_page integer check (last_confirmed_source_page is null or last_confirmed_source_page > 0),
  last_confirmed_announcement_id uuid references public.announcements (id),
  check (
    case
      when last_confirmed_on is null then
        last_confirmed_document_id is null
        and last_confirmed_announcement_id is null
        and last_confirmed_source_page is null
      else
        (last_confirmed_document_id is not null)::integer
        + (last_confirmed_announcement_id is not null)::integer = 1
    end
  ),
  check (last_confirmed_announcement_id is null or last_confirmed_source_page is null),
  check (last_confirmed_document_id is null or last_confirmed_source_page is not null),
  -- Nothing can confirm a role before it began.
  check (last_confirmed_on is null or last_confirmed_on >= valid_from),

  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_self_approved boolean not null default false,
  reviewed_version integer,

  -- An approved role later found to be wrong. It leaves the published record and
  -- stays in the history: see the header — for personal data, continuing to
  -- display a claim we no longer stand behind is the accuracy failure.
  withdrawn_at timestamptz,
  withdrawal_reason text,
  check ((withdrawn_at is null) = (withdrawal_reason is null)),
  check (withdrawal_reason is null or char_length(btrim(withdrawal_reason)) between 1 and 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The same person cannot hold the same office at the same company from the same
-- date twice. Re-appointment after a gap is a second row with its own start,
-- which is the point of effective dating. Overlapping tenures in the same office
-- are *not* blocked: during a handover, or with an acting appointment, a company
-- really does have two, and a constraint that refuses reality gets worked around
-- by fudging dates. The desk flags the overlap instead.
create unique index if not exists company_roles_unique_tenure_uidx
  on public.company_roles (person_id, company_id, role_code, valid_from);

create index if not exists company_roles_company_idx on public.company_roles (company_id, role_code);
create index if not exists company_roles_person_idx on public.company_roles (person_id);
-- Supports the desk's "current roles nobody has confirmed in 12 months" queue.
create index if not exists company_roles_stale_idx
  on public.company_roles (last_confirmed_on) where valid_to is null;

create table if not exists public.company_role_versions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.company_roles (id) on delete cascade,
  version integer not null check (version >= 1),
  person_id uuid not null,
  company_id uuid not null,
  role_code text not null,
  role_title text,
  is_acting boolean not null,
  valid_from date not null,
  valid_from_precision text not null,
  valid_to date,
  valid_to_precision text,
  -- Referenced, not copied: a document may not be deleted while this history
  -- cites it as the evidence for a statement about a person. No ON DELETE action,
  -- so the attempt is refused rather than silently erasing the citation.
  document_id uuid references public.documents (id),
  source_page integer,
  announcement_id uuid references public.announcements (id),
  last_confirmed_on date,
  last_confirmed_document_id uuid references public.documents (id),
  last_confirmed_source_page integer,
  last_confirmed_announcement_id uuid references public.announcements (id),
  change_reason text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  unique (role_id, version)
);

create index if not exists company_role_versions_role_idx
  on public.company_role_versions (role_id, version desc);

-- ---------------------------------------------------------------------------
-- 4. The cited source must be one a reader could actually check
-- ---------------------------------------------------------------------------

-- Modelled on guard_editorial_citation. An 'unverified' document is excluded for
-- the reason the editorial desk learned: a licence a reader cannot act on is not
-- evidence they can follow, and offering one in the picker hands the analyst a
-- source the trigger then rejects as a bare constraint violation.
create or replace function public.guard_company_role_sources()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.document_id is not null and not exists (
    select 1 from public.documents
     where id = new.document_id
       and review_status = 'approved'
       and licence_class <> 'unverified'
  ) then
    raise exception 'A role must rest on an approved, citable document' using errcode = '23514';
  end if;

  if new.announcement_id is not null and not exists (
    select 1 from public.announcements where id = new.announcement_id and status = 'published'
  ) then
    raise exception 'A role must rest on a published announcement' using errcode = '23514';
  end if;

  if new.last_confirmed_document_id is not null and not exists (
    select 1 from public.documents
     where id = new.last_confirmed_document_id
       and review_status = 'approved'
       and licence_class <> 'unverified'
  ) then
    raise exception 'A confirmation must rest on an approved, citable document' using errcode = '23514';
  end if;

  if new.last_confirmed_announcement_id is not null and not exists (
    select 1 from public.announcements where id = new.last_confirmed_announcement_id and status = 'published'
  ) then
    raise exception 'A confirmation must rest on a published announcement' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists company_roles_source_guard on public.company_roles;
create trigger company_roles_source_guard before insert or update on public.company_roles
for each row execute function public.guard_company_role_sources();

-- ---------------------------------------------------------------------------
-- 5. History is append-only; the live rows change only through the functions
-- ---------------------------------------------------------------------------

create or replace function public.guard_person_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'person_versions is append-only and records history' using errcode = '42501';
  end if;

  -- The actor may go to null, and only to null, and only once that account is
  -- actually gone. A blanket refusal would block ON DELETE SET NULL and make
  -- offboarding impossible; permitting every null-ward change would let a stray
  -- statement blank the attribution on a version whose author still exists.
  if (to_jsonb(new) - 'changed_by'::text) is distinct from (to_jsonb(old) - 'changed_by'::text)
     or (
       new.changed_by is distinct from old.changed_by
       and not (
         new.changed_by is null
         and not exists (select 1 from auth.users where id = old.changed_by)
       )
     ) then
    raise exception 'person_versions rows are immutable; only a departed actor may be anonymised'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists person_versions_guard on public.person_versions;
create trigger person_versions_guard before update or delete on public.person_versions
for each row execute function public.guard_person_version();

create or replace function public.guard_company_role_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'company_role_versions is append-only and records history' using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'changed_by'::text) is distinct from (to_jsonb(old) - 'changed_by'::text)
     or (
       new.changed_by is distinct from old.changed_by
       and not (
         new.changed_by is null
         and not exists (select 1 from auth.users where id = old.changed_by)
       )
     ) then
    raise exception 'company_role_versions rows are immutable; only a departed actor may be anonymised'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists company_role_versions_guard on public.company_role_versions;
create trigger company_role_versions_guard before update or delete on public.company_role_versions
for each row execute function public.guard_company_role_version();

-- Not a security boundary — the table grants are, and writes are service_role
-- only. These exist so a direct UPDATE from server code cannot leave the history
-- incomplete, which is the one failure the history could not survive.
create or replace function public.guard_person_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'People are not deleted; withdraw the roles and reject the record'
      using errcode = '42501';
  end if;

  if current_setting('sfi.person_write', true) = '1' then
    return new;
  end if;

  if (to_jsonb(new) - 'updated_at'::text - 'reviewed_by'::text)
       is distinct from (to_jsonb(old) - 'updated_at'::text - 'reviewed_by'::text)
     or (
       new.reviewed_by is distinct from old.reviewed_by
       and not (
         new.reviewed_by is null
         and not exists (select 1 from auth.users where id = old.reviewed_by)
       )
     ) then
    raise exception 'People change through upsert_person, which records the version'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists people_guard on public.people;
create trigger people_guard before update or delete on public.people
for each row execute function public.guard_person_row();

drop trigger if exists people_set_updated_at on public.people;
create trigger people_set_updated_at before update on public.people
for each row execute function public.set_updated_at();

create or replace function public.guard_company_role_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Roles are not deleted; withdraw the role with a reason'
      using errcode = '42501';
  end if;

  if current_setting('sfi.person_write', true) = '1' then
    return new;
  end if;

  if (to_jsonb(new) - 'updated_at'::text - 'reviewed_by'::text)
       is distinct from (to_jsonb(old) - 'updated_at'::text - 'reviewed_by'::text)
     or (
       new.reviewed_by is distinct from old.reviewed_by
       and not (
         new.reviewed_by is null
         and not exists (select 1 from auth.users where id = old.reviewed_by)
       )
     ) then
    raise exception 'Roles change through upsert_company_role, which records the version'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists company_roles_guard on public.company_roles;
create trigger company_roles_guard before update or delete on public.company_roles
for each row execute function public.guard_company_role_row();

drop trigger if exists company_roles_set_updated_at on public.company_roles;
create trigger company_roles_set_updated_at before update on public.company_roles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Writing a person
-- ---------------------------------------------------------------------------

create or replace function public.upsert_person(
  actor_user uuid,
  p_full_name text,
  p_person_id uuid default null,
  p_slug text default null,
  p_honorific text default null,
  p_change_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  person public.people%rowtype;
  target_person uuid;
  clean_name text := btrim(coalesce(p_full_name, ''));
  clean_honorific text := nullif(btrim(coalesce(p_honorific, '')), '');
  clean_slug text;
  clean_reason text := nullif(btrim(coalesce(p_change_reason, '')), '');
  clash uuid;
  next_version integer := 1;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not edit people' using errcode = '42501';
  end if;

  if char_length(clean_name) < 2 then
    raise exception 'A person needs a name' using errcode = '23514';
  end if;

  clean_slug := coalesce(
    public.person_slug_candidate(p_slug),
    public.person_slug_candidate(clean_name)
  );
  if clean_slug is null then
    raise exception 'That name produces no usable web address; give the address explicitly'
      using errcode = '23514';
  end if;
  if char_length(clean_slug) < 2 then
    clean_slug := clean_slug || '-x';
  end if;
  if char_length(clean_slug) > 120 then
    clean_slug := btrim(left(clean_slug, 120), '-');
  end if;

  -- Two people really do share a name, and merging two records that turn out to
  -- be different people is worse than never merging them. So a collision is
  -- refused and handed back, for a person to decide: the same individual, or a
  -- namesake who needs a distinct address.
  select id into clash from public.people where slug = clean_slug and id is distinct from p_person_id;
  if clash is not null then
    raise exception 'The address % already belongs to another person; give this one a distinct address', clean_slug
      using errcode = '23505';
  end if;

  if p_person_id is null then
    perform set_config('sfi.person_write', '1', true);
    insert into public.people (slug, full_name, honorific)
    values (clean_slug, clean_name, clean_honorific)
    returning id into target_person;
    perform set_config('sfi.person_write', '0', true);
  else
    select * into person from public.people where id = p_person_id for update;
    if person.id is null then
      raise exception 'No such person: %', p_person_id using errcode = '23503';
    end if;
    if clean_reason is null then
      raise exception 'Say why the record is changing; the change is kept as history'
        using errcode = '23514';
    end if;

    if clean_name = person.full_name
       and clean_slug = person.slug
       and clean_honorific is not distinct from person.honorific then
      raise exception 'Nothing changed' using errcode = '23514';
    end if;

    target_person := person.id;

    perform set_config('sfi.person_write', '1', true);
    update public.people
       set slug = clean_slug,
           full_name = clean_name,
           honorific = clean_honorific
     where id = target_person;
    perform set_config('sfi.person_write', '0', true);
  end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.person_versions where person_id = target_person;

  insert into public.person_versions (
    person_id, version, slug, full_name, honorific, change_reason, changed_by
  )
  select target_person, next_version, p.slug, p.full_name, p.honorific, clean_reason, actor_user
    from public.people p where p.id = target_person;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    case when p_person_id is null then 'person.created' else 'person.changed' end,
    jsonb_build_object(
      'person_id', target_person,
      'version', next_version,
      'slug', clean_slug,
      'reason', clean_reason
    )
  );

  return target_person;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Writing a role
-- ---------------------------------------------------------------------------

create or replace function public.upsert_company_role(
  actor_user uuid,
  p_person_id uuid,
  p_company_id uuid,
  p_role_code text,
  p_valid_from date,
  p_role_id uuid default null,
  p_role_title text default null,
  p_is_acting boolean default false,
  p_valid_from_precision text default 'day',
  p_valid_to date default null,
  p_valid_to_precision text default null,
  p_document_id uuid default null,
  p_source_page integer default null,
  p_announcement_id uuid default null,
  p_last_confirmed_on date default null,
  p_last_confirmed_document_id uuid default null,
  p_last_confirmed_source_page integer default null,
  p_last_confirmed_announcement_id uuid default null,
  p_change_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  role_row public.company_roles%rowtype;
  target_role uuid;
  clean_title text := nullif(btrim(coalesce(p_role_title, '')), '');
  clean_reason text := nullif(btrim(coalesce(p_change_reason, '')), '');
  to_precision text;
  clash uuid;
  next_version integer := 1;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not record leadership' using errcode = '42501';
  end if;

  if not exists (select 1 from public.people where id = p_person_id) then
    raise exception 'No such person: %', p_person_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'No such company: %', p_company_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.person_role_catalogue where id = p_role_code) then
    raise exception 'No such role: %', p_role_code using errcode = '23503';
  end if;

  if p_valid_from is null then
    raise exception 'A role needs a start date' using errcode = '23514';
  end if;
  if coalesce(p_valid_from_precision, 'day') not in ('day', 'month', 'year') then
    raise exception 'Date precision is day, month or year' using errcode = '23514';
  end if;

  -- A future-dated appointment is real: a company announces in November that
  -- someone takes office in January. A future end is equally real for a notified
  -- retirement, so neither boundary is capped.
  if p_valid_to is not null and p_valid_to < p_valid_from then
    raise exception 'A role cannot end before it began' using errcode = '23514';
  end if;

  to_precision := case
    when p_valid_to is null then null
    else coalesce(p_valid_to_precision, 'day')
  end;
  if to_precision is not null and to_precision not in ('day', 'month', 'year') then
    raise exception 'Date precision is day, month or year' using errcode = '23514';
  end if;

  -- Exactly one source, checked here for a readable message before the
  -- constraint reports it as a bare violation.
  if (p_document_id is not null and p_announcement_id is not null)
     or (p_document_id is null and p_announcement_id is null) then
    raise exception 'A role cites either a document page or an announcement, and exactly one'
      using errcode = '23514';
  end if;
  if p_document_id is not null and p_source_page is null then
    raise exception 'Give the page the role appears on, so a reader can check it'
      using errcode = '23514';
  end if;
  if p_announcement_id is not null and p_source_page is not null then
    raise exception 'An announcement has no page reference' using errcode = '23514';
  end if;

  -- The confirmation is optional, but a date without a source would assert that
  -- somebody checked without saying what they checked.
  if p_last_confirmed_on is null then
    if p_last_confirmed_document_id is not null
       or p_last_confirmed_announcement_id is not null
       or p_last_confirmed_source_page is not null then
      raise exception 'A confirming source needs the date it confirmed' using errcode = '23514';
    end if;
  else
    if (p_last_confirmed_document_id is not null and p_last_confirmed_announcement_id is not null)
       or (p_last_confirmed_document_id is null and p_last_confirmed_announcement_id is null) then
      raise exception 'A confirmation cites either a document page or an announcement, and exactly one'
        using errcode = '23514';
    end if;
    if p_last_confirmed_document_id is not null and p_last_confirmed_source_page is null then
      raise exception 'Give the page the confirmation appears on' using errcode = '23514';
    end if;
    if p_last_confirmed_announcement_id is not null and p_last_confirmed_source_page is not null then
      raise exception 'An announcement has no page reference' using errcode = '23514';
    end if;
    if p_last_confirmed_on > current_date then
      raise exception 'A role cannot have been confirmed in the future' using errcode = '23514';
    end if;
    if p_last_confirmed_on < p_valid_from then
      raise exception 'A role cannot have been confirmed before it began' using errcode = '23514';
    end if;
  end if;

  select id into clash
    from public.company_roles
   where person_id = p_person_id
     and company_id = p_company_id
     and role_code = p_role_code
     and valid_from = p_valid_from
     and id is distinct from p_role_id;
  if clash is not null then
    raise exception 'That person already holds that office at that company from that date'
      using errcode = '23505';
  end if;

  if p_role_id is null then
    perform set_config('sfi.person_write', '1', true);
    insert into public.company_roles (
      person_id, company_id, role_code, role_title, is_acting,
      valid_from, valid_from_precision, valid_to, valid_to_precision,
      document_id, source_page, announcement_id,
      last_confirmed_on, last_confirmed_document_id, last_confirmed_source_page,
      last_confirmed_announcement_id
    )
    values (
      p_person_id, p_company_id, p_role_code, clean_title, coalesce(p_is_acting, false),
      p_valid_from, coalesce(p_valid_from_precision, 'day'), p_valid_to, to_precision,
      p_document_id, p_source_page, p_announcement_id,
      p_last_confirmed_on, p_last_confirmed_document_id, p_last_confirmed_source_page,
      p_last_confirmed_announcement_id
    )
    returning id into target_role;
    perform set_config('sfi.person_write', '0', true);
  else
    select * into role_row from public.company_roles where id = p_role_id for update;
    if role_row.id is null then
      raise exception 'No such role: %', p_role_id using errcode = '23503';
    end if;
    if clean_reason is null then
      raise exception 'Say why the role is changing; the change is kept as history'
        using errcode = '23514';
    end if;
    if role_row.withdrawn_at is not null then
      raise exception 'That role has been withdrawn; record a new one rather than reviving it'
        using errcode = '42501';
    end if;

    -- Who, where and which office *are* the claim. Correcting a date or a title
    -- on an approved role is a refinement of the same assertion, and keeping the
    -- approval (with reviewed_version recording that clearance is behind) is the
    -- same latitude a company profile gets. Changing the subject is not a
    -- refinement: it is a different statement about a different human being, and
    -- letting it inherit the old approval would publish a claim about someone no
    -- reviewer ever saw. That correction belongs on the withdrawal path, where the
    -- record says plainly that we got it wrong.
    if role_row.review_status = 'approved'
       and (
         role_row.person_id is distinct from p_person_id
         or role_row.company_id is distinct from p_company_id
         or role_row.role_code is distinct from p_role_code
       ) then
      raise exception 'An approved role cannot be re-pointed at another person, company or office; withdraw it and record the correct one'
        using errcode = '42501';
    end if;

    if role_row.person_id = p_person_id
       and role_row.company_id = p_company_id
       and role_row.role_code = p_role_code
       and role_row.role_title is not distinct from clean_title
       and role_row.is_acting = coalesce(p_is_acting, false)
       and role_row.valid_from = p_valid_from
       and role_row.valid_from_precision = coalesce(p_valid_from_precision, 'day')
       and role_row.valid_to is not distinct from p_valid_to
       and role_row.valid_to_precision is not distinct from to_precision
       and role_row.document_id is not distinct from p_document_id
       and role_row.source_page is not distinct from p_source_page
       and role_row.announcement_id is not distinct from p_announcement_id
       and role_row.last_confirmed_on is not distinct from p_last_confirmed_on
       and role_row.last_confirmed_document_id is not distinct from p_last_confirmed_document_id
       and role_row.last_confirmed_source_page is not distinct from p_last_confirmed_source_page
       and role_row.last_confirmed_announcement_id is not distinct from p_last_confirmed_announcement_id then
      raise exception 'Nothing changed' using errcode = '23514';
    end if;

    target_role := role_row.id;

    perform set_config('sfi.person_write', '1', true);
    update public.company_roles
       set person_id = p_person_id,
           company_id = p_company_id,
           role_code = p_role_code,
           role_title = clean_title,
           is_acting = coalesce(p_is_acting, false),
           valid_from = p_valid_from,
           valid_from_precision = coalesce(p_valid_from_precision, 'day'),
           valid_to = p_valid_to,
           valid_to_precision = to_precision,
           document_id = p_document_id,
           source_page = p_source_page,
           announcement_id = p_announcement_id,
           last_confirmed_on = p_last_confirmed_on,
           last_confirmed_document_id = p_last_confirmed_document_id,
           last_confirmed_source_page = p_last_confirmed_source_page,
           last_confirmed_announcement_id = p_last_confirmed_announcement_id
     where id = target_role;
    perform set_config('sfi.person_write', '0', true);
  end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.company_role_versions where role_id = target_role;

  insert into public.company_role_versions (
    role_id, version, person_id, company_id, role_code, role_title, is_acting,
    valid_from, valid_from_precision, valid_to, valid_to_precision,
    document_id, source_page, announcement_id,
    last_confirmed_on, last_confirmed_document_id, last_confirmed_source_page,
    last_confirmed_announcement_id, change_reason, changed_by
  )
  select target_role, next_version, r.person_id, r.company_id, r.role_code, r.role_title,
         r.is_acting, r.valid_from, r.valid_from_precision, r.valid_to, r.valid_to_precision,
         r.document_id, r.source_page, r.announcement_id,
         r.last_confirmed_on, r.last_confirmed_document_id, r.last_confirmed_source_page,
         r.last_confirmed_announcement_id, clean_reason, actor_user
    from public.company_roles r where r.id = target_role;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    case when p_role_id is null then 'company_role.created' else 'company_role.changed' end,
    jsonb_build_object(
      'role_id', target_role,
      'version', next_version,
      'person_id', p_person_id,
      'company_id', p_company_id,
      'role_code', p_role_code,
      'is_acting', coalesce(p_is_acting, false),
      'reason', clean_reason
    )
  );

  return target_role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Review and withdrawal
-- ---------------------------------------------------------------------------

create or replace function public.review_person(
  target_person uuid,
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
  person public.people%rowtype;
  last_editor uuid;
  self_flag boolean := false;
  latest_version integer := 0;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not review people' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'A review decision is approved or rejected' using errcode = '23514';
  end if;

  select * into person from public.people where id = target_person for update;
  if person.id is null then
    raise exception 'No such person: %', target_person using errcode = '23503';
  end if;

  select coalesce(max(version), 0) into latest_version
    from public.person_versions where person_id = target_person;

  if person.review_status = 'approved' and p_decision = 'approved'
     and coalesce(person.reviewed_version, 0) >= latest_version then
    raise exception 'That person is already approved, and nothing has changed since it was reviewed'
      using errcode = '23514';
  end if;

  if p_decision = 'rejected' and coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'Say why the record is being rejected' using errcode = '23514';
  end if;

  select changed_by into last_editor
    from public.person_versions
   where person_id = target_person
   order by version desc limit 1;

  -- Unknown authorship counts as self-reviewed. If the editor's account has since
  -- been deleted the foreign key has nulled the actor, and reading "someone
  -- independent reviewed this" out of that null would assert a second pair of
  -- eyes nobody can show.
  self_flag := last_editor is null or last_editor = actor_user;

  if self_flag and public.setting_bool('review.require_two_person', false) then
    raise exception 'Someone other than the person who wrote this record must review it'
      using errcode = '42501';
  end if;

  perform set_config('sfi.person_write', '1', true);
  update public.people
     set review_status = p_decision,
         reviewed_by = actor_user,
         reviewed_at = now(),
         review_self_approved = self_flag,
         reviewed_version = latest_version
   where id = target_person;
  perform set_config('sfi.person_write', '0', true);

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'person.' || p_decision,
    jsonb_build_object(
      'person_id', target_person,
      'self_approved', self_flag,
      'reviewed_version', latest_version,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end;
$$;

create or replace function public.review_company_role(
  target_role uuid,
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
  role_row public.company_roles%rowtype;
  last_editor uuid;
  self_flag boolean := false;
  latest_version integer := 0;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not review leadership' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'A review decision is approved or rejected' using errcode = '23514';
  end if;

  select * into role_row from public.company_roles where id = target_role for update;
  if role_row.id is null then
    raise exception 'No such role: %', target_role using errcode = '23503';
  end if;
  if role_row.withdrawn_at is not null then
    raise exception 'That role has been withdrawn' using errcode = '42501';
  end if;

  select coalesce(max(version), 0) into latest_version
    from public.company_role_versions where role_id = target_role;

  if role_row.review_status = 'approved' and p_decision = 'approved'
     and coalesce(role_row.reviewed_version, 0) >= latest_version then
    raise exception 'That role is already approved, and nothing has changed since it was reviewed'
      using errcode = '23514';
  end if;

  if p_decision = 'rejected' and coalesce(btrim(coalesce(p_reason, '')), '') = '' then
    raise exception 'Say why the role is being rejected' using errcode = '23514';
  end if;

  select changed_by into last_editor
    from public.company_role_versions
   where role_id = target_role
   order by version desc limit 1;

  self_flag := last_editor is null or last_editor = actor_user;

  if self_flag and public.setting_bool('review.require_two_person', false) then
    raise exception 'Someone other than the person who recorded this role must review it'
      using errcode = '42501';
  end if;

  perform set_config('sfi.person_write', '1', true);
  update public.company_roles
     set review_status = p_decision,
         reviewed_by = actor_user,
         reviewed_at = now(),
         review_self_approved = self_flag,
         reviewed_version = latest_version
   where id = target_role;
  perform set_config('sfi.person_write', '0', true);

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'company_role.' || p_decision,
    jsonb_build_object(
      'role_id', target_role,
      'person_id', role_row.person_id,
      'company_id', role_row.company_id,
      'self_approved', self_flag,
      'reviewed_version', latest_version,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end;
$$;

-- Withdrawal is the correction path the personal-data standard requires: a claim
-- we published and no longer stand behind stops being published. It is not a
-- delete — the row, its history and this audit entry all survive — and it is not
-- reversible, because reviving a withdrawn claim about a person should be a fresh
-- record resting on fresh evidence.
create or replace function public.withdraw_company_role(
  target_role uuid,
  actor_user uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  role_row public.company_roles%rowtype;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user)
     and not exists (
       select 1 from public.platform_staff
       where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not withdraw leadership' using errcode = '42501';
  end if;

  if clean_reason is null then
    raise exception 'Say why the role is being withdrawn' using errcode = '23514';
  end if;

  select * into role_row from public.company_roles where id = target_role for update;
  if role_row.id is null then
    raise exception 'No such role: %', target_role using errcode = '23503';
  end if;
  if role_row.withdrawn_at is not null then
    raise exception 'That role is already withdrawn' using errcode = '23514';
  end if;

  perform set_config('sfi.person_write', '1', true);
  update public.company_roles
     set withdrawn_at = now(),
         withdrawal_reason = clean_reason
   where id = target_role;
  perform set_config('sfi.person_write', '0', true);

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'company_role.withdrawn',
    jsonb_build_object(
      'role_id', target_role,
      'person_id', role_row.person_id,
      'company_id', role_row.company_id,
      'reason', clean_reason
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Access
-- ---------------------------------------------------------------------------

revoke all on function public.person_slug_candidate(text) from public, anon, authenticated;
revoke all on function public.guard_company_role_sources() from public, anon, authenticated;
revoke all on function public.guard_person_version() from public, anon, authenticated;
revoke all on function public.guard_company_role_version() from public, anon, authenticated;
revoke all on function public.guard_person_row() from public, anon, authenticated;
revoke all on function public.guard_company_role_row() from public, anon, authenticated;
revoke all on function public.upsert_person(uuid, text, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.upsert_company_role(
  uuid, uuid, uuid, text, date, uuid, text, boolean, text, date, text, uuid, integer, uuid,
  date, uuid, integer, uuid, text
) from public, anon, authenticated;
revoke all on function public.review_person(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_company_role(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_company_role(uuid, uuid, text) from public, anon, authenticated;

-- Granted back explicitly. Revoking from PUBLIC removes the implicit grant that
-- service_role otherwise relies on, so without these the server's own calls fail
-- with 42501 while every test still passes: the harness runs as the migration
-- owner and only ever switches to `authenticated`. The guard functions need no
-- grant — PostgreSQL checks EXECUTE on a trigger function when the trigger is
-- created, not when it fires — and person_slug_candidate is only ever called from
-- inside a security-definer function, which runs as its owner.
grant execute on function public.upsert_person(uuid, text, uuid, text, text, text) to service_role;
grant execute on function public.upsert_company_role(
  uuid, uuid, uuid, text, date, uuid, text, boolean, text, date, text, uuid, integer, uuid,
  date, uuid, integer, uuid, text
) to service_role;
grant execute on function public.review_person(uuid, uuid, text, text) to service_role;
grant execute on function public.review_company_role(uuid, uuid, text, text) to service_role;
grant execute on function public.withdraw_company_role(uuid, uuid, text) to service_role;

alter table public.person_role_catalogue enable row level security;
alter table public.people enable row level security;
alter table public.person_versions enable row level security;
alter table public.company_roles enable row level security;
alter table public.company_role_versions enable row level security;

revoke all on
  public.person_role_catalogue, public.people, public.person_versions,
  public.company_roles, public.company_role_versions
from anon, authenticated;

grant select on
  public.person_role_catalogue, public.people, public.person_versions,
  public.company_roles, public.company_role_versions
to authenticated;

grant all on
  public.person_role_catalogue, public.people, public.person_versions,
  public.company_roles, public.company_role_versions
to service_role;

-- The role list is reference data, like sectors.
drop policy if exists "Signed-in users can view the role catalogue" on public.person_role_catalogue;
create policy "Signed-in users can view the role catalogue" on public.person_role_catalogue
for select to authenticated using (true);

-- Readers see an approved person. Analysts run the register, so they see the
-- queue they are meant to work — the policy stage 3a shipped without, which left
-- the company desk permanently empty for the one role it was built for.
drop policy if exists "Readers see approved people" on public.people;
create policy "Readers see approved people" on public.people
for select to authenticated using (
  review_status = 'approved'
  or public.is_platform_admin()
  or public.has_staff_role(array['analyst'])
);

-- A role is visible only when the role, the person and the company are all
-- approved, and it has not been withdrawn. The company test is the one that
-- matters most: without it the leadership panel would publish the officers of a
-- company nobody has reviewed yet.
drop policy if exists "Readers see approved leadership" on public.company_roles;
create policy "Readers see approved leadership" on public.company_roles
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst'])
  or (
    review_status = 'approved'
    and withdrawn_at is null
    and exists (
      select 1 from public.people p where p.id = person_id and p.review_status = 'approved'
    )
    and exists (
      select 1 from public.companies c where c.id = company_id and c.review_status = 'approved'
    )
  )
);

-- The history is the register's working record, so it belongs to the role that
-- keeps the register — not to staff in general. Stage 3a shipped this as
-- is_platform_staff() and had to tighten it: an editor could read the full
-- snapshot of a company nobody had approved while being unable to see the company
-- row itself. Written correctly here the first time.
drop policy if exists "Staff see person history" on public.person_versions;
create policy "Staff see person history" on public.person_versions
for select to authenticated using (
  public.is_platform_admin() or public.has_staff_role(array['analyst'])
);

drop policy if exists "Staff see leadership history" on public.company_role_versions;
create policy "Staff see leadership history" on public.company_role_versions
for select to authenticated using (
  public.is_platform_admin() or public.has_staff_role(array['analyst'])
);
