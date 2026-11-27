-- Samuel Terminal — a company that changed its name is the same company.
--
-- Two of the pilot eighteen have been renamed: FBN Holdings became First
-- HoldCo, and Lafarge Africa became HBM Nigeria. A reader who knows the old
-- name has to find the company, and a reader looking at the new name has to be
-- told what it used to be — with the notice that says so.
--
-- Why this is not a succession
-- ----------------------------
-- company_successions records a restructuring: a different legal entity whose
-- figures stay separate, under binding rule 5. A rename is the opposite claim.
-- Same entity, same registration, same figure history — only the label moved.
-- Recording a rename as a succession would split a continuous series into two
-- companies and publish a discontinuity that never happened; recording a
-- succession as a rename would splice two entities' histories into one. So they
-- are separate tables saying separate things, and the tests hold the line.
--
-- Why it is reviewed, and why it cites a document
-- -----------------------------------------------
-- "Formerly Lafarge Africa Plc (WAPCO), renamed July 2026" is a published claim
-- about a real company, so it carries what every other published claim here
-- carries: a source a reader can check, and a person who approved it. A rename
-- citing neither is refused by a CHECK rather than by a convention.
--
-- The effective date keeps the precision it was given. The exchange's bulletin
-- names a month; printing "1 July 2026" would invent a day nobody published.

create table if not exists public.company_renames (
  id uuid primary key default gen_random_uuid(),
  -- The same company. There is no predecessor column here, on purpose.
  company_id uuid not null references public.companies (id) on delete restrict,
  former_name text not null check (
    char_length(btrim(former_name)) between 2 and 200 and former_name !~ '[[:cntrl:]]'
  ),
  former_legal_name text check (
    former_legal_name is null
    or (char_length(btrim(former_legal_name)) between 2 and 200 and former_legal_name !~ '[[:cntrl:]]')
  ),
  -- The exchange's own shape for a ticker, as instrument_identifiers enforces it.
  former_symbol text check (former_symbol is null or former_symbol ~ '^[A-Z][A-Z0-9.]{1,14}$'),
  -- Stored rather than derived from the name: the redirect is then data a person
  -- checked, not a slugification rule that might change under it.
  former_slug text not null check (former_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  effective_on date not null,
  effective_precision text not null check (effective_precision in ('day', 'month', 'year')),
  document_id uuid references public.documents (id) on delete restrict,
  source_page integer check (source_page is null or source_page > 0),
  announcement_id uuid references public.announcements (id) on delete restrict,
  note text check (
    note is null or (char_length(btrim(note)) between 2 and 500 and note !~ '[[:cntrl:]]')
  ),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  review_reason text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_self_approved boolean not null default false,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- A reader is shown this line; it needs a source they can follow.
  constraint company_renames_source_check check (document_id is not null or announcement_id is not null),
  -- A cited document is cited to a page. "Somewhere in this filing" is not a
  -- citation anybody can check.
  constraint company_renames_page_check check (document_id is null or source_page is not null),
  unique (company_id, former_slug)
);

create index if not exists company_renames_company_idx
  on public.company_renames (company_id, effective_on desc);

create index if not exists company_renames_former_slug_idx
  on public.company_renames (former_slug) where review_status = 'approved';

create index if not exists company_renames_former_symbol_idx
  on public.company_renames (former_symbol) where review_status = 'approved';

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- The same test a succession and a company role get, for the same reason: an
-- unapproved document, or one whose licence is unverified, is not evidence a
-- reader can follow.
create or replace function public.guard_company_rename_sources()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  doc_status text;
  doc_licence text;
  ann_status text;
  company_slug text;
begin
  if new.document_id is not null then
    select review_status, licence_class into doc_status, doc_licence
      from public.documents where id = new.document_id;
    if doc_status is null then
      raise exception 'No such document: %', new.document_id using errcode = '23503';
    end if;
    if doc_status <> 'approved' then
      raise exception 'A rename must cite an approved document' using errcode = '23514';
    end if;
    if doc_licence = 'unverified' then
      raise exception 'A rename cannot cite a document whose licence is unverified' using errcode = '23514';
    end if;
  end if;

  if new.announcement_id is not null then
    select review_status into ann_status from public.announcements where id = new.announcement_id;
    if ann_status is null then
      raise exception 'No such announcement: %', new.announcement_id using errcode = '23503';
    end if;
    if ann_status <> 'published' then
      raise exception 'A rename must cite a published announcement' using errcode = '23514';
    end if;
  end if;

  -- A company cannot have been formerly itself. The address it lives at now is
  -- not a former address, and a redirect from it would be a loop.
  select slug into company_slug from public.companies where id = new.company_id;
  if company_slug is null then
    raise exception 'No such company: %', new.company_id using errcode = '23503';
  end if;
  if company_slug = new.former_slug then
    raise exception 'That is the address the company lives at now, not a former one'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists company_renames_source_guard on public.company_renames;
create trigger company_renames_source_guard before insert or update on public.company_renames
for each row execute function public.guard_company_rename_sources();

-- Fixed once recorded; only the review decision moves. A wrong rename is
-- rejected and recorded again, exactly as a wrong succession is.
create or replace function public.guard_company_rename_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  review_cols text[] := array[
    'review_status', 'review_reason', 'reviewed_by', 'reviewed_at', 'review_self_approved'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'Renames are not deleted; reject the record and record the correct one'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - review_cols) is distinct from (to_jsonb(old) - review_cols) then
    raise exception 'A rename is fixed once recorded; reject it and record the correct one'
      using errcode = '42501';
  end if;

  if new.review_status is distinct from old.review_status
     and not (old.review_status = 'pending' and new.review_status in ('approved', 'rejected')) then
    raise exception 'Invalid review transition % -> % on a rename', old.review_status, new.review_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists company_renames_guard on public.company_renames;
create trigger company_renames_guard before update or delete on public.company_renames
for each row execute function public.guard_company_rename_row();

-- ---------------------------------------------------------------------------
-- Who may read one
-- ---------------------------------------------------------------------------

alter table public.company_renames enable row level security;

revoke all on public.company_renames from anon, authenticated;
grant select on public.company_renames to authenticated;
grant all on public.company_renames to service_role;

-- A reader sees an approved rename of an approved company, because that is a
-- published fact about a company already in the directory. The desk sees the
-- queue it has to work through.
create or replace function public.company_rename_is_published(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.company_renames r
      join public.companies c on c.id = r.company_id
     where r.id = target
       and r.review_status = 'approved'
       and c.review_status = 'approved'
  );
$$;

revoke all on function public.company_rename_is_published(uuid) from public, anon;
grant execute on function public.company_rename_is_published(uuid) to authenticated, service_role;

drop policy if exists "Readers see approved renames" on public.company_renames;
create policy "Readers see approved renames" on public.company_renames
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['analyst', 'financial_analyst'])
  or public.company_rename_is_published(id)
);

-- ---------------------------------------------------------------------------
-- Recording and reviewing one
-- ---------------------------------------------------------------------------

-- A rename is a fact about corporate identity rather than a figure, so the
-- register's own role may record it as well as the figures desk — the same rule
-- a succession follows.
create or replace function public.record_company_rename(
  actor_user uuid,
  p_company_id uuid,
  p_former_name text,
  p_former_slug text,
  p_effective_on date,
  p_effective_precision text,
  p_former_symbol text default null,
  p_former_legal_name text default null,
  p_document_id uuid default null,
  p_source_page integer default null,
  p_announcement_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_row uuid;
  taken text;
begin
  if not public.may_enter_figures(actor_user)
     and not exists (
       select 1 from public.platform_staff
        where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not record a rename' using errcode = '42501';
  end if;

  if p_document_id is null and p_announcement_id is null then
    raise exception 'A rename is published to readers; cite the notice that announced it'
      using errcode = '23514';
  end if;

  -- A former address another approved company lives at now would make the
  -- redirect hand a reader the wrong company. Refused here rather than resolved
  -- later: by the time a reader follows it, nobody is watching.
  select c.name into taken
    from public.companies c
   where c.slug = p_former_slug
     and c.review_status = 'approved'
     and c.id <> p_company_id;
  if taken is not null then
    raise exception '% lives at that address now; a rename cannot claim it', taken
      using errcode = '23505';
  end if;

  insert into public.company_renames (
    company_id, former_name, former_legal_name, former_symbol, former_slug,
    effective_on, effective_precision, document_id, source_page, announcement_id,
    note, recorded_by
  ) values (
    p_company_id,
    btrim(p_former_name),
    nullif(btrim(coalesce(p_former_legal_name, '')), ''),
    nullif(btrim(coalesce(p_former_symbol, '')), ''),
    p_former_slug,
    p_effective_on,
    p_effective_precision,
    p_document_id,
    p_source_page,
    p_announcement_id,
    nullif(btrim(coalesce(p_note, '')), ''),
    actor_user
  )
  returning id into new_row;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user, 'company_rename.recorded',
    jsonb_build_object(
      'rename_id', new_row, 'company_id', p_company_id,
      'former_name', p_former_name, 'former_symbol', p_former_symbol,
      'effective_on', p_effective_on
    )
  );

  return new_row;
end;
$$;

create or replace function public.review_company_rename(
  target_rename uuid,
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
  rename_row public.company_renames%rowtype;
  self_flag boolean := false;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.may_enter_figures(actor_user)
     and not exists (
       select 1 from public.platform_staff
        where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not review a rename' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'A review decision is approved or rejected' using errcode = '23514';
  end if;

  select * into rename_row from public.company_renames where id = target_rename for update;
  if rename_row.id is null then
    raise exception 'No such rename: %', target_rename using errcode = '23503';
  end if;
  if rename_row.review_status <> 'pending' then
    raise exception 'That rename has already been %', rename_row.review_status using errcode = '23514';
  end if;
  if p_decision = 'rejected' and clean_reason is null then
    raise exception 'Say why the rename is being rejected' using errcode = '23514';
  end if;

  -- Unknown authorship counts as self-review, as everywhere else: a null
  -- recorder cannot be shown to be a second pair of eyes.
  self_flag := rename_row.recorded_by is null or rename_row.recorded_by = actor_user;
  if self_flag and public.setting_bool('review.require_two_person', false) then
    raise exception 'Someone other than the person who recorded this rename must check it'
      using errcode = '42501';
  end if;

  update public.company_renames
     set review_status = p_decision,
         review_reason = clean_reason,
         reviewed_by = actor_user,
         reviewed_at = now(),
         review_self_approved = self_flag
   where id = target_rename;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    case when p_decision = 'approved' then 'company_rename.approved' else 'company_rename.rejected' end,
    jsonb_build_object(
      'rename_id', target_rename, 'company_id', rename_row.company_id,
      'self_reviewed', self_flag, 'reason', clean_reason
    )
  );
end;
$$;

revoke all on function public.record_company_rename(
  uuid, uuid, text, text, date, text, text, text, uuid, integer, uuid, text
) from public, anon, authenticated;
revoke all on function public.review_company_rename(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.record_company_rename(
  uuid, uuid, text, text, date, text, text, text, uuid, integer, uuid, text
) to service_role;
grant execute on function public.review_company_rename(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Finding a company by what it used to be called
-- ---------------------------------------------------------------------------

-- Replaces the 3a function. The profile history still answers for addresses the
-- desk changed; an approved rename now answers too, which is what lets a link to
-- /companies/lafarge-africa keep working after a rename no profile version
-- records.
create or replace function public.company_slug_for_former_slug(former text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select slug from (
    -- A recorded rename is the stronger statement: a person checked it against
    -- the notice that announced it.
    select c.slug, 1 as rank, r.effective_on::timestamptz as moved_at
      from public.company_renames r
      join public.companies c on c.id = r.company_id
     where r.former_slug = former
       and r.review_status = 'approved'
       and c.review_status = 'approved'
       and c.slug <> former
    union all
    select c.slug, 2 as rank, v.changed_at as moved_at
      from public.company_profile_versions v
      join public.companies c on c.id = v.company_id
     where v.slug = former
       and c.review_status = 'approved'
       and c.slug <> former
  ) candidates
  -- The most recent claim on this address wins, so an address released by one
  -- company and later taken by another resolves to whoever had it last.
  order by rank, moved_at desc
  limit 1;
$$;

revoke all on function public.company_slug_for_former_slug(text) from public, anon;
grant execute on function public.company_slug_for_former_slug(text) to authenticated, service_role;

-- A ticker a company used to carry. The current symbol is resolved elsewhere and
-- always wins: a ticker can be reassigned, and handing a reader last year's
-- owner of a live symbol would be worse than finding nothing.
create or replace function public.company_slug_for_former_symbol(former text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select c.slug
    from public.company_renames r
    join public.companies c on c.id = r.company_id
   where r.former_symbol = upper(btrim(former))
     and r.review_status = 'approved'
     and c.review_status = 'approved'
     -- Nobody holds it now. The live-symbol lookup has already been tried.
     and not exists (
       select 1
         from public.instrument_identifiers i
        where i.scheme = 'ngx_symbol'
          and i.value = upper(btrim(former))
          and i.valid_to is null
     )
   order by r.effective_on desc
   limit 1;
$$;

revoke all on function public.company_slug_for_former_symbol(text) from public, anon;
grant execute on function public.company_slug_for_former_symbol(text) to authenticated, service_role;
