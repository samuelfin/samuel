-- Samuel Terminal — two fixes from the stage 3c security review.
--
-- A scale on a figure that has none
-- ---------------------------------
-- record_statement let any non-currency line carry its own scale. That is right
-- for a count or a physical quantity — a filing really does say "77.5 million
-- subscribers" — and wrong for a percentage or a per-share figure. An NPL ratio
-- of 5 is five per cent whatever heading sits above the column, and a scale on
-- it stored 5,000,000,000 while the page showed 5.
--
-- Only the figures desk could reach it and the statement still went to review,
-- so this was not a way in. It was a way to be quietly wrong, which for a
-- register of company results is the worse of the two. The desk now offers the
-- control only where a scale is meaningful, and this refuses it anywhere else
-- rather than ignoring it: a value silently dropped is how a preview and what
-- is stored come to disagree.
--
-- A role that could not be granted
-- --------------------------------
-- 3c added financial_analyst to the platform_staff CHECK, but
-- set_platform_staff_role still whitelisted the four older roles, so the only
-- supported way to grant it refused. It failed closed, so nothing was exposed —
-- but the figures desk could not be staffed, which makes the whole stage
-- unreachable in practice. Found by review rather than by use, because every
-- test inserts into platform_staff directly.

-- ---------------------------------------------------------------------------
-- 1. The scale belongs to money, to counts and to quantities
-- ---------------------------------------------------------------------------

create or replace function public.record_statement(
  actor_user uuid,
  p_company_id uuid,
  p_statement_type text,
  p_period_type text,
  p_period_start date,
  p_period_end date,
  p_audited boolean,
  p_consolidated boolean,
  p_currency text,
  p_magnitude text,
  p_document_id uuid,
  p_lines jsonb,
  p_published_at timestamptz default null,
  p_supersedes_id uuid default null,
  p_restatement_kind text default null,
  p_correction_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_statement uuid;
  source_record uuid;
  company_row public.companies%rowtype;
  doc_status text;
  doc_licence text;
  sector_template text;
  previous public.financial_statements%rowtype;
  next_version integer := 1;
  kind text := coalesce(nullif(btrim(coalesce(p_restatement_kind, '')), ''), 'original');
  clean_reason text := nullif(btrim(coalesce(p_correction_reason, '')), '');
  entry jsonb;
  catalogue public.statement_line_catalogue%rowtype;
  seen text[] := array[]::text[];
  item text;
  reported numeric;
  presentation text;
  magnitude text;
  chosen_magnitude text;
  multiplier numeric;
  signed_value numeric;
  standardised numeric;
  page integer;
  required_missing text;
  any_ai boolean := false;
  line_ai boolean;
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not enter financial figures' using errcode = '42501';
  end if;

  select * into company_row from public.companies where id = p_company_id;
  if company_row.id is null then
    raise exception 'No such company: %', p_company_id using errcode = '23503';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'A reporting period needs a start and a later end' using errcode = '23514';
  end if;

  if p_document_id is null then
    raise exception 'Every figure resolves to a document and a page; name the filing' using errcode = '23514';
  end if;

  select review_status, licence_class into doc_status, doc_licence
    from public.documents where id = p_document_id;
  if doc_status is null then
    raise exception 'No such document: %', p_document_id using errcode = '23503';
  end if;
  if doc_status <> 'approved' then
    raise exception 'Figures must cite an approved document' using errcode = '23514';
  end if;
  if doc_licence = 'unverified' then
    raise exception 'Figures cannot cite a document whose licence is unverified' using errcode = '23514';
  end if;

  select id into source_record
    from public.source_records
   where document_id = p_document_id
   order by retrieved_at, id
   limit 1;
  if source_record is null then
    raise exception 'That document has no provenance record; it cannot support a figure'
      using errcode = '23503';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A statement needs at least one figure' using errcode = '23514';
  end if;

  select coalesce(bool_or(coalesce((e ->> 'ai_assisted')::boolean, false)), false)
    into any_ai
    from jsonb_array_elements(p_lines) e;

  select cst.template_id into sector_template
    from public.company_statement_templates cst
   where cst.company_id = p_company_id
     and cst.valid_from <= p_period_end
     and (cst.valid_to is null or cst.valid_to > p_period_end)
   order by cst.valid_from desc
   limit 1;

  if p_supersedes_id is not null then
    select * into previous from public.financial_statements where id = p_supersedes_id for update;
    if previous.id is null then
      raise exception 'No such statement to supersede: %', p_supersedes_id using errcode = '23503';
    end if;
    if previous.company_id <> p_company_id
       or previous.statement_type <> p_statement_type
       or previous.period_type <> p_period_type
       or previous.period_end <> p_period_end
       or previous.consolidated is distinct from coalesce(p_consolidated, true) then
      raise exception 'A new version must describe the same company, statement, period and basis as the one it replaces'
        using errcode = '23514';
    end if;
    if kind not in ('issuer_restated', 'sfi_correction') then
      raise exception 'Say which this is: the issuer restated its figures, or this desk is correcting its own entry'
        using errcode = '23514';
    end if;
    if clean_reason is null then
      raise exception 'Say why the figures are changing; the reason is published with the correction'
        using errcode = '23514';
    end if;
    next_version := previous.version + 1;
  else
    if kind <> 'original' then
      raise exception 'A first entry is the original reading of the filing; name the statement it supersedes'
        using errcode = '23514';
    end if;
    next_version := 1;
  end if;

  insert into public.financial_statements (
    company_id, statement_type, period_type, period_start, period_end,
    audited, consolidated, currency, magnitude, published_at,
    document_id, source_record_id, template_id, entered_by,
    version, supersedes_id, correction_reason, restatement_kind, ai_assisted
  )
  values (
    p_company_id, p_statement_type, p_period_type, p_period_start, p_period_end,
    coalesce(p_audited, false), coalesce(p_consolidated, true),
    upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'NGN')),
    coalesce(nullif(btrim(coalesce(p_magnitude, '')), ''), 'thousands'), p_published_at,
    p_document_id, source_record, sector_template, actor_user,
    next_version, p_supersedes_id, clean_reason, kind, any_ai
  )
  returning id into new_statement;

  for entry in select * from jsonb_array_elements(p_lines)
  loop
    item := nullif(btrim(coalesce(entry ->> 'line_item', '')), '');
    if item is null then
      raise exception 'Every figure names the line it belongs to' using errcode = '23514';
    end if;
    if item = any (seen) then
      raise exception 'The figure % appears twice in one statement', item using errcode = '23505';
    end if;
    seen := seen || item;

    select * into catalogue from public.statement_line_catalogue c where c.line_item = item;
    if catalogue.line_item is null then
      raise exception 'There is no figure called % in the catalogue', item using errcode = '23503';
    end if;
    if catalogue.statement_type <> p_statement_type then
      raise exception '% belongs to the % statement, not the % one',
        item, catalogue.statement_type, p_statement_type using errcode = '23514';
    end if;

    if not exists (
      select 1
        from public.statement_template_lines tl
        join public.statement_templates t on t.id = tl.template_id
       where tl.line_item = item
         and t.is_active
         and (t.scope = 'core' or t.id = sector_template)
    ) then
      if sector_template is null then
        raise exception '% is a sector figure and this company has no template assigned for that period', item
          using errcode = '23514';
      end if;
      raise exception '% is not part of this company''s template (%)', item, sector_template
        using errcode = '23514';
    end if;

    if jsonb_typeof(entry -> 'value_reported') is distinct from 'number' then
      raise exception 'The figure % needs a reported value', item using errcode = '23514';
    end if;
    reported := (entry ->> 'value_reported')::numeric;

    if jsonb_typeof(entry -> 'source_page') is distinct from 'number' then
      page := null;
    else
      page := (entry ->> 'source_page')::numeric::integer;
    end if;
    if page is null or page <= 0 then
      raise exception 'The figure % needs the page of the filing it appears on', item using errcode = '23514';
    end if;

    presentation := coalesce(nullif(btrim(coalesce(entry ->> 'presentation', '')), ''), 'plain');
    if presentation not in ('plain', 'bracketed', 'negative') then
      raise exception 'The figure % was presented plain, bracketed or negative', item using errcode = '23514';
    end if;

    chosen_magnitude := nullif(btrim(coalesce(entry ->> 'magnitude', '')), '');

    -- A percentage and a per-share figure carry no scale. Refused rather than
    -- ignored: a dropped value is how the desk's preview and the stored figure
    -- come to disagree, and this is the arm that stored a ratio as billions.
    if chosen_magnitude is not null
       and chosen_magnitude <> 'units'
       and catalogue.unit_kind in ('percent', 'per_share') then
      raise exception '% is reported in % and carries no scale; enter it as the filing prints it',
        item, catalogue.unit_label using errcode = '23514';
    end if;

    -- A scale belongs to money, to counts and to physical quantities. Money
    -- inherits the statement's heading; the rest are printed in their own units
    -- unless the filing says otherwise.
    if catalogue.unit_kind in ('currency', 'currency_per_unit') then
      magnitude := coalesce(chosen_magnitude, nullif(btrim(coalesce(p_magnitude, '')), ''), 'thousands');
    else
      magnitude := coalesce(chosen_magnitude, 'units');
    end if;
    if magnitude not in ('units', 'thousands', 'millions', 'billions') then
      raise exception 'The figure % has an unknown magnitude: %', item, magnitude using errcode = '23514';
    end if;
    multiplier := case magnitude
      when 'units' then 1
      when 'thousands' then 1000
      when 'millions' then 1000000
      else 1000000000
    end;

    signed_value := case
      when presentation in ('bracketed', 'negative') then -abs(reported)
      else reported
    end;

    standardised := case catalogue.standard_sign
      when 'positive' then case when signed_value < 0 then null else signed_value end
      when 'negative' then -abs(signed_value)
      else signed_value
    end;
    if standardised is null then
      raise exception '% cannot be negative; check the figure and how it was presented', item
        using errcode = '23514';
    end if;
    standardised := standardised * multiplier;

    line_ai := coalesce((entry ->> 'ai_assisted')::boolean, false);

    insert into public.financial_statement_lines (
      statement_id, line_item, value_standardised, value_reported,
      reported_magnitude, reported_presentation, source_page,
      as_restated, ai_assisted, note
    )
    values (
      new_statement, item, standardised, reported,
      magnitude, presentation, page,
      coalesce((entry ->> 'as_restated')::boolean, false),
      line_ai,
      nullif(btrim(coalesce(entry ->> 'note', '')), '')
    );
  end loop;

  select string_agg(c.label, ', ' order by tl.sort_order) into required_missing
    from public.statement_template_lines tl
    join public.statement_templates t on t.id = tl.template_id
    join public.statement_line_catalogue c on c.line_item = tl.line_item
   where tl.is_required
     and t.is_active
     and (t.scope = 'core' or t.id = sector_template)
     and c.statement_type = p_statement_type
     and not exists (
       select 1 from public.financial_statement_lines l
        where l.statement_id = new_statement and l.line_item = tl.line_item
     );
  if required_missing is not null then
    raise exception 'This statement is missing figures the template requires: %', required_missing
      using errcode = '23514';
  end if;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    case when p_supersedes_id is null then 'statement.recorded' else 'statement.revised' end,
    jsonb_build_object(
      'statement_id', new_statement,
      'company_id', p_company_id,
      'statement_type', p_statement_type,
      'period_end', p_period_end,
      'version', next_version,
      'restatement_kind', kind,
      'lines', jsonb_array_length(p_lines),
      'ai_assisted', any_ai,
      'reason', clean_reason
    )
  );

  return new_statement;
end;
$$;

-- The grants are re-stated because CREATE OR REPLACE keeps them, and saying so
-- is cheaper than someone later wondering whether it does.
revoke all on function public.record_statement(
  uuid, uuid, text, text, date, date, boolean, boolean, text, text, uuid, jsonb, timestamptz, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.record_statement(
  uuid, uuid, text, text, date, date, boolean, boolean, text, text, uuid, jsonb, timestamptz, uuid, text, text
) to service_role;

-- The same rule applied to a proposal, so the queue cannot offer the desk a
-- figure record_statement would then refuse.
create or replace function public.guard_figure_suggestion_scale()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  kind text;
  unit text;
begin
  if new.magnitude is null or new.magnitude = 'units' then
    return new;
  end if;
  select unit_kind, unit_label into kind, unit
    from public.statement_line_catalogue where line_item = new.line_item;
  if kind in ('percent', 'per_share') then
    raise exception '% is reported in % and carries no scale', new.line_item, unit using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_figure_suggestion_scale() from public, anon, authenticated;

drop trigger if exists figure_suggestions_scale_guard on public.figure_suggestions;
create trigger figure_suggestions_scale_guard before insert on public.figure_suggestions
for each row execute function public.guard_figure_suggestion_scale();

-- ---------------------------------------------------------------------------
-- 2. The role the figures desk is staffed from
-- ---------------------------------------------------------------------------

-- The signature is reproduced exactly as 202611180004 declared it:
-- (target_user, actor_user, target_role, should_grant), with no default.
-- CREATE OR REPLACE cannot rename an input parameter, and PostgREST resolves a
-- function by its argument names, so a tidier-looking order here would have
-- failed to apply — which is how I caught it.
create or replace function public.set_platform_staff_role(
  target_user uuid,
  actor_user uuid,
  target_role text,
  should_grant boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  changed_rows integer;
begin
  if not exists (select 1 from public.platform_admins where user_id = actor_user) then
    raise exception 'Actor is not a platform administrator' using errcode = '42501';
  end if;

  -- financial_analyst added for stage 3c. This list and the table's CHECK have
  -- to agree: the CHECK says what may be stored, this says what may be granted,
  -- and a role in one but not the other is a desk that cannot be staffed.
  if target_role not in ('editor', 'analyst', 'fact_checker', 'publisher', 'financial_analyst') then
    raise exception 'Unknown staff role: %', target_role using errcode = '22023';
  end if;

  if should_grant then
    insert into public.platform_staff (user_id, role, granted_by)
    values (target_user, target_role, actor_user)
    on conflict (user_id, role) do nothing;
    get diagnostics changed_rows = row_count;
    if changed_rows > 0 then
      insert into public.audit_logs (actor_user_id, subject_user_id, action, details)
      values (actor_user, target_user, 'access.staff_role.granted', jsonb_build_object('role', target_role));
    end if;
  else
    delete from public.platform_staff where user_id = target_user and role = target_role;
    get diagnostics changed_rows = row_count;
    if changed_rows > 0 then
      insert into public.audit_logs (actor_user_id, subject_user_id, action, details)
      values (actor_user, target_user, 'access.staff_role.revoked', jsonb_build_object('role', target_role));
    end if;
  end if;
end;
$$;

revoke all on function public.set_platform_staff_role(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_platform_staff_role(uuid, uuid, text, boolean) to service_role;
