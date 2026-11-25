-- Samuel Terminal — the figures desk can see the companies it enters figures for.
--
-- Found by the bounty hunt, and it is the same fault twice in one stage: a role
-- that exists and can reach nothing.
--
-- 202611210002 gave the company registry's rows to `analyst`, the role that
-- writes them. The figures desk needs the same list — a statement has to name a
-- company, including one nobody has approved yet, since figures are entered
-- before a profile is reviewed — and `financial_analyst` was in none of those
-- policies. The page passed its own guard and was then redirected away by the
-- company loader's, which is a desk that cannot be opened by the only role
-- built to use it.
--
-- Fail-closed, so nothing was exposed. But a stage that ships unusable is not
-- shipped, and the previous migration fixed the whitelist that made the role
-- grantable at all — this is the next thing it would have hit.
--
-- Two further things the hunt noticed are fixed here, because each is cheap and
-- each is a way to be quietly wrong rather than a way in.

-- ---------------------------------------------------------------------------
-- 1. The company list, for both desks
-- ---------------------------------------------------------------------------

-- Additive and staff-only, as before: a reader still sees approved rows and
-- nothing else. The array names the two roles that need the registry rather
-- than widening to staff in general — an editor has no reason to see a company
-- nobody has reviewed.
drop policy if exists "Staff can view every company" on public.companies;
create policy "Staff can view every company" on public.companies
for select to authenticated using (public.has_staff_role(array['analyst', 'financial_analyst']));

drop policy if exists "Staff can view every company identifier" on public.company_identifiers;
create policy "Staff can view every company identifier" on public.company_identifiers
for select to authenticated using (public.has_staff_role(array['analyst', 'financial_analyst']));

-- The ticker lives on the instrument, and the desk shows the symbol beside the
-- company it is entering figures for.
drop policy if exists "Staff can view every instrument" on public.instruments;
create policy "Staff can view every instrument" on public.instruments
for select to authenticated using (public.has_staff_role(array['analyst', 'financial_analyst']));

drop policy if exists "Staff can view every instrument identifier" on public.instrument_identifiers;
create policy "Staff can view every instrument identifier" on public.instrument_identifiers
for select to authenticated using (public.has_staff_role(array['analyst', 'financial_analyst']));

-- ---------------------------------------------------------------------------
-- 2. A catalogue label is history once a figure wears it
-- ---------------------------------------------------------------------------

-- The reader panel takes a figure's label from the catalogue rather than from
-- the stored row, so editing a label retroactively relabels every figure
-- already published under it — and the audit entry recorded only the line item,
-- with no before and after. upsert_statement_line already froze unit_kind and
-- standard_sign once figures existed, for exactly this reason; the label and
-- the statement it belongs to were left editable, which is the same mistake
-- with a quieter result.
--
-- Nothing in the application reaches this function — it is service_role only
-- and has no caller in app/ or lib/ — so this is not a reachable fault. It is
-- the kind that becomes one the first time a desk is built on it.
--
-- The statement type is frozen outright once a figure exists: moving a line
-- from the income statement to the balance sheet would orphan every row entered
-- under it. The label may still change, because a clearer wording is a real
-- need, but the old and the new both go into the audit entry.
create or replace function public.upsert_statement_line(
  actor_user uuid,
  p_line_item text,
  p_label text,
  p_statement_type text,
  p_unit_kind text,
  p_unit_label text,
  p_standard_sign text,
  p_definition_note text default null
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  clean_item text := lower(nullif(btrim(coalesce(p_line_item, '')), ''));
  existing public.statement_line_catalogue%rowtype;
  figures_exist boolean;
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not change the figure catalogue' using errcode = '42501';
  end if;
  if clean_item is null then
    raise exception 'A catalogue line needs a code' using errcode = '23514';
  end if;

  select * into existing from public.statement_line_catalogue c where c.line_item = clean_item;
  figures_exist := exists (select 1 from public.financial_statement_lines l where l.line_item = clean_item);

  if existing.line_item is not null and figures_exist then
    -- Every stored standardised value was computed from the unit and the sign.
    if existing.unit_kind <> p_unit_kind or existing.standard_sign <> p_standard_sign then
      raise exception 'Figures have already been entered as %; its unit and sign are fixed. Add a new line instead',
        clean_item using errcode = '42501';
    end if;
    -- And every stored row belongs to a statement of this type.
    if existing.statement_type <> p_statement_type then
      raise exception 'Figures have already been entered as % on the % statement; that cannot move. Add a new line instead',
        clean_item, existing.statement_type using errcode = '42501';
    end if;
  end if;

  insert into public.statement_line_catalogue
    (line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note)
  values
    (clean_item, btrim(coalesce(p_label, '')), p_statement_type, p_unit_kind,
     btrim(coalesce(p_unit_label, '')), p_standard_sign,
     nullif(btrim(coalesce(p_definition_note, '')), ''))
  on conflict (line_item) do update
     set label = excluded.label,
         statement_type = excluded.statement_type,
         unit_kind = excluded.unit_kind,
         unit_label = excluded.unit_label,
         standard_sign = excluded.standard_sign,
         definition_note = excluded.definition_note;

  -- The old wording and the new, because a label change rewrites what every
  -- already-published figure is called, and "it was relabelled" is not an answer.
  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'statement_line.catalogued',
    jsonb_build_object(
      'line_item', clean_item,
      'label', btrim(coalesce(p_label, '')),
      'previous_label', existing.label,
      'figures_entered', figures_exist
    )
  );

  return clean_item;
end;
$$;

revoke all on function public.upsert_statement_line(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_statement_line(uuid, text, text, text, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. A batch may only close against the statement it actually describes
-- ---------------------------------------------------------------------------

-- close_suggestion_batch compared company, statement type and period end, but
-- not the period type. A batch read from a full year could therefore close
-- against a half-year interim of the same company ending on the same date, and
-- the provenance would then say an extractor proposed figures it never saw.
create or replace function public.close_suggestion_batch(
  target_batch uuid,
  actor_user uuid,
  p_statement_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  batch public.figure_suggestion_batches%rowtype;
  statement public.financial_statements%rowtype;
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not close a suggestion batch' using errcode = '42501';
  end if;

  select * into batch from public.figure_suggestion_batches where id = target_batch for update;
  if batch.id is null then
    raise exception 'No such batch: %', target_batch using errcode = '23503';
  end if;
  if batch.status = 'closed' then
    raise exception 'That batch is already closed' using errcode = '23514';
  end if;

  if p_statement_id is not null then
    select * into statement from public.financial_statements where id = p_statement_id;
    if statement.id is null then
      raise exception 'No such statement: %', p_statement_id using errcode = '23503';
    end if;
    if statement.company_id <> batch.company_id
       or statement.statement_type <> batch.statement_type
       or statement.period_end <> batch.period_end
       or statement.period_type <> batch.period_type then
      raise exception 'That statement is for a different company, statement or period than this batch'
        using errcode = '23514';
    end if;
  end if;

  update public.figure_suggestion_batches
     set status = 'closed',
         closed_at = now(),
         statement_id = p_statement_id
   where id = target_batch;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'figure_suggestions.closed',
    jsonb_build_object('batch_id', target_batch, 'statement_id', p_statement_id)
  );
end;
$$;

revoke all on function public.close_suggestion_batch(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_suggestion_batch(uuid, uuid, uuid) to service_role;
