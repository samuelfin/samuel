-- Samuel Terminal — two corrections to the metric library, as new versions.
--
-- Both were found by building the stage 3d fixtures, which is what fixtures are
-- for. Neither is fixed by editing anything: a migration that has been applied
-- and a definition that has been recorded are both history, so the catalogue
-- gains a line, three definitions gain a version 2, and the view that computes
-- the answers is replaced wholesale.
--
-- A five-year rate measured over two years
-- ----------------------------------------
-- The compound-rate shape refused only a window it could not measure at all
-- (span < 1). A company with FY2022 and FY2023 therefore published a one-year
-- change under the name "five-year CAGR" — not an arithmetic error, a false
-- statement about the company. A five-year rate spans exactly four years of
-- compounding, so both ends of the window are now required and anything else
-- reads insufficient_history. The years between the endpoints are not used and
-- a gap between them changes nothing, which is why only the ends are checked.
--
-- A return on equity whose two halves belonged to different owners
-- ---------------------------------------------------------------
-- Return on equity divided the group's profit after tax, which includes the
-- non-controlling interest, by equity attributable to the owners of the parent,
-- which does not. For Zenith Bank's FY2023 the two differ by ₦340 million —
-- small, and still a ratio measuring one set of owners' profit against another
-- set's capital. Filings print the parent's share on the face of the income
-- statement, so it becomes a catalogue line like any other and version 2 of the
-- definition divides by it.
--
-- There is deliberately no fallback. Where the line has not been entered, the
-- ratio reads input_missing and names it. Substituting the group's figure would
-- be the same error committed silently, and a reader could not tell which
-- numerator they were looking at. Return on assets is untouched: the group's
-- profit over the group's assets belongs to one set of owners throughout.

-- ---------------------------------------------------------------------------
-- 1. The line the parent's share of profit is entered on
-- ---------------------------------------------------------------------------

-- Signed, because a parent can take a loss, and in the core template because
-- every consolidated filing presents it — but not required, because a company
-- with no subsidiaries does not, and demanding it would make such a filing
-- impossible to enter whole.
insert into public.statement_line_catalogue
  (line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note) values
  ('profit_attributable_to_parent', 'Profit attributable to the parent', 'income', 'currency', 'currency', 'signed',
   'Profit for the year attributable to the equity holders of the parent, as the income statement presents it — the group''s profit after tax less the non-controlling interest. Entered from the page; never derived by subtraction.')
on conflict (line_item) do nothing;

insert into public.statement_template_lines (template_id, line_item, is_headline, is_required, sort_order) values
  ('core', 'profit_attributable_to_parent', false, false, 95)
on conflict (template_id, line_item) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Version 2 of the three definitions
-- ---------------------------------------------------------------------------

-- Retired first. The unique index allows one live version of a metric, which is
-- what makes "which formula produced this number" answerable at all.
update public.metric_definitions set is_active = false
 where code in ('roe', 'revenue_cagr_5y', 'pat_cagr_5y') and version = 1;

insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, approved_by_name,
   approved_at, review_self_approved, sort_order, supersedes_id)
select
  'roe', 2, 'Return on equity',
  'Profit attributable to the equity holders of the parent, as a percentage of average shareholders'' equity, where the average is the opening and closing equity of the year divided by two. The parent''s share is used rather than the group''s profit after tax, because the equity it is divided by excludes the non-controlling interest; where the filing''s parent-share line has not been entered there is no answer, and none is substituted. A company''s first year held has no opening equity, so it reads Not available: no prior period, until the previous year''s balance sheet is entered.',
  'average_ratio', 'percent', 1, 'returns',
  null, null, null, 'Interim: Technical Lead', 'Interim: Technical Lead',
  now(), true, 10, d.id
from public.metric_definitions d where d.code = 'roe' and d.version = 1
on conflict (code, version) do nothing;

insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, approved_by_name,
   approved_at, review_self_approved, sort_order, supersedes_id)
select
  'revenue_cagr_5y', 2, 'Revenue five-year CAGR',
  'The compound annual growth rate of revenue between the latest financial year and the year four years before it — five years of figures, four years of compounding. Both of those years must be held and both must be positive; where either is absent the rate reads Not available rather than being remeasured over a shorter run and published as five years. The years in between are not used, so a gap between the two ends changes nothing.',
  'cagr', 'percent', 1, 'growth',
  null, null, 5, 'Interim: Technical Lead', 'Interim: Technical Lead',
  now(), true, 40, d.id
from public.metric_definitions d where d.code = 'revenue_cagr_5y' and d.version = 1
on conflict (code, version) do nothing;

insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, approved_by_name,
   approved_at, review_self_approved, sort_order, supersedes_id)
select
  'pat_cagr_5y', 2, 'Profit after tax five-year CAGR',
  'The compound annual growth rate of profit after tax between the latest financial year and the year four years before it — five years of figures, four years of compounding. Both of those years must be held and both must be positive; a loss at either end makes the measure meaningless, and a shorter run is not remeasured and published as five years. The years in between are not used.',
  'cagr', 'percent', 1, 'growth',
  null, null, 5, 'Interim: Technical Lead', 'Interim: Technical Lead',
  now(), true, 50, d.id
from public.metric_definitions d where d.code = 'pat_cagr_5y' and d.version = 1
on conflict (code, version) do nothing;

insert into public.metric_definition_inputs (definition_id, role, line_item, sign, use_absolute, sort_order)
select d.id, v.role, v.line_item, 1, false, 10
  from (values
    ('roe',             'numerator',   'profit_attributable_to_parent'),
    ('roe',             'denominator', 'shareholders_equity'),
    ('revenue_cagr_5y', 'base',        'revenue'),
    ('pat_cagr_5y',     'base',        'profit_after_tax')
  ) as v(code, role, line_item)
  join public.metric_definitions d on d.code = v.code and d.version = 2
 where not exists (
   select 1 from public.metric_definition_inputs i
    where i.definition_id = d.id and i.role = v.role and i.line_item = v.line_item
 );

-- ---------------------------------------------------------------------------
-- 3. The view, replaced
-- ---------------------------------------------------------------------------

-- Same columns, same grants, still SECURITY INVOKER so the licence gate on the
-- underlying figures reaches the ratios built from them. One line of the verdict
-- changes: the window a compound rate is measured over must be the window its
-- definition names.
create or replace view public.company_metric_values
with (security_invoker = true) as
with operands as (
  select
    i.company_id,
    i.period_end,
    i.financial_year,
    i.consolidated,
    i.currency,
    i.definition_id,
    i.code,
    i.definition_version,
    i.kind,
    i.result_unit,
    i.window_years,
    i.disclosed_line_item,
    max(i.figure_period_end) filter (where i.period_role = 'prior') as prior_period_end,
    min(i.figure_period_end) filter (where i.period_role = 'window_start') as window_start_period_end,
    sum(i.contribution) filter (where i.role = 'numerator' and i.period_role = 'current') as numerator,
    sum(i.contribution) filter (where i.role = 'denominator' and i.period_role = 'current') as denominator,
    sum(i.contribution) filter (where i.role = 'denominator' and i.period_role = 'prior') as denominator_prior,
    sum(i.contribution) filter (where i.role = 'base' and i.period_role = 'current') as base_now,
    sum(i.contribution) filter (where i.role = 'base' and i.period_role = 'prior') as base_prior,
    sum(i.contribution) filter (where i.role = 'base' and i.period_role = 'window_start') as base_window_start,
    count(*) filter (where i.statement_id is null) as missing_count,
    array_agg(distinct i.line_item) filter (where i.statement_id is null) as missing_inputs,
    bool_or(i.missing_in_other_currency) as any_other_currency,
    bool_or(i.missing_on_other_basis) as any_other_basis,
    bool_and(coalesce(i.audited, true)) as all_audited,
    bool_or(coalesce(i.as_restated, false)) as any_restated,
    bool_or(coalesce(i.ai_assisted, false)) as any_ai_assisted
  from public.company_metric_inputs i
  group by
    i.company_id, i.period_end, i.financial_year, i.consolidated, i.currency,
    i.definition_id, i.code, i.definition_version, i.kind, i.result_unit,
    i.window_years, i.disclosed_line_item
), shaped as (
  select
    o.*,
    f.value_standardised as disclosed_value,
    f.source_page as disclosed_page,
    f.statement_id as disclosed_statement_id,
    f.document_id as disclosed_document_id,
    o.financial_year - (extract(year from o.window_start_period_end))::int as window_span,
    case
      when o.kind = 'average_ratio' and o.denominator is not null and o.denominator_prior is not null
        then (o.denominator + o.denominator_prior) / 2
      else o.denominator
    end as effective_denominator
  from operands o
  left join public.approved_fy_figures f
    on o.disclosed_line_item is not null
   and f.company_id = o.company_id
   and f.period_end = o.period_end
   and f.consolidated = o.consolidated
   and f.currency = o.currency
   and f.line_item = o.disclosed_line_item
), judged as (
  select
    s.*,
    case
      when s.disclosed_statement_id is not null then 'disclosed'
      when s.kind in ('average_ratio', 'growth')
       and (
         s.prior_period_end is null
         or s.financial_year - (extract(year from s.prior_period_end))::int <> 1
       )
        then 'no_prior_period'
      -- A five-year rate is measured between this year and the year four years
      -- before it. Measuring it over whatever shorter run happens to be held
      -- and publishing that as five years is the defect this replaces: the span
      -- must be the span the definition names, and a window with no earlier
      -- endpoint at all has no span.
      when s.kind = 'cagr'
       and (
         s.window_start_period_end is null
         or s.window_span is distinct from s.window_years - 1
       )
        then 'insufficient_history'
      when s.missing_count > 0 and s.any_other_currency then 'currency_mismatch'
      when s.missing_count > 0 and s.any_other_basis then 'basis_mismatch'
      when s.missing_count > 0 then 'input_missing'
      when s.kind = 'sum' then 'ok'
      when s.kind = 'growth' and s.base_prior = 0 then 'denominator_zero'
      when s.kind = 'growth' and s.base_prior < 0 then 'not_applicable'
      when s.kind = 'cagr' and (s.base_window_start <= 0 or s.base_now <= 0) then 'not_applicable'
      when s.kind in ('margin', 'ratio', 'average_ratio') and s.effective_denominator = 0
        then 'denominator_zero'
      when s.kind in ('margin', 'ratio', 'average_ratio') and s.effective_denominator < 0
        then 'not_applicable'
      else 'ok'
    end as verdict
  from shaped s
)
select
  j.company_id,
  j.period_end,
  j.financial_year,
  j.consolidated,
  j.currency,
  j.definition_id,
  j.code,
  j.definition_version,
  j.kind,
  j.result_unit,
  case
    when j.verdict = 'disclosed' then 'disclosed'
    when j.verdict = 'ok' then 'available'
    else 'not_available'
  end as status,
  case when j.verdict in ('ok', 'disclosed') then null else j.verdict end as reason,
  case
    when j.verdict = 'disclosed' then j.disclosed_value
    when j.verdict <> 'ok' then null
    when j.kind = 'sum' then round(j.numerator, 6)
    when j.kind = 'margin' then round(100 * j.numerator / j.effective_denominator, 6)
    when j.kind = 'ratio' then round(j.numerator / j.effective_denominator, 6)
    when j.kind = 'average_ratio' then round(100 * j.numerator / j.effective_denominator, 6)
    when j.kind = 'growth' then round(100 * (j.base_now - j.base_prior) / abs(j.base_prior), 6)
    when j.kind = 'cagr' then round(
      (
        (power(
          (j.base_now / j.base_window_start)::double precision,
          1.0 / j.window_span::double precision
        ) - 1) * 100
      )::numeric,
      6
    )
  end as value,
  case when j.verdict = 'disclosed' then j.disclosed_page end as disclosed_page,
  case when j.verdict = 'disclosed' then j.disclosed_statement_id end as disclosed_statement_id,
  case when j.verdict = 'disclosed' then j.disclosed_document_id end as disclosed_document_id,
  j.disclosed_line_item,
  j.prior_period_end,
  j.window_start_period_end,
  case when j.kind = 'cagr' then j.window_span end as window_span,
  coalesce(j.missing_inputs, array[]::text[]) as missing_inputs,
  j.all_audited,
  j.any_restated,
  j.any_ai_assisted
from judged j;

-- CREATE OR REPLACE keeps the grants; re-stating them is cheaper than someone
-- later wondering whether it does.
revoke all on public.company_metric_values from anon, authenticated;
grant select on public.company_metric_values to authenticated, service_role;
