-- Samuel Terminal — corrections to the metric library, recorded as proposals.
--
-- Three things happen here, and none of them publishes anything. The catalogue
-- gains four reported lines, three definitions gain a version 2 awaiting human
-- approval, and the view that computes the answers is replaced.
--
-- A five-year rate measured over two years
-- ----------------------------------------
-- The compound-rate shape refused only a window it could not measure at all
-- (span < 1). A company with FY2022 and FY2023 would therefore have published a
-- one-year change under the name "five-year CAGR" — not an arithmetic error, a
-- false statement about the company. A five-year rate spans exactly four years
-- of compounding, so both ends of the window are now required and anything else
-- reads insufficient_history. The years between the endpoints are not used, so a
-- gap between them changes nothing, which is why only the ends are checked.
--
-- A return on equity whose halves belonged to different owners
-- -----------------------------------------------------------
-- Return on equity divided the group's profit after tax, which includes the
-- non-controlling interest, by equity attributable to the owners of the parent,
-- which does not. For Zenith Bank's FY2023 the two differ by ₦340 million —
-- small, and still a ratio measuring one set of owners' profit against another
-- set's capital. Filings print the parent's share on the face of the income
-- statement, so it becomes a catalogue line and version 2 divides by it.
--
-- There is deliberately no fallback. Where the line has not been entered the
-- ratio reads input_missing and names it; substituting the group's figure would
-- be the same error committed silently, and a reader could not tell which
-- numerator they were looking at. Return on assets is untouched — the group's
-- profit over the group's assets belongs to one set of owners throughout.
--
-- Why version 1 cannot be approved by mistake
-- -------------------------------------------
-- Version 1 of these three is also a proposal, and it is the wrong formula. It
-- is not rejected here, because a rejection names the person who took the
-- decision and a migration is not a person. It cannot be approved either: a
-- version may be approved only while it supersedes the latest one, and once
-- version 2 exists, version 1 no longer does. The rule that stops two competing
-- proposals being approved out of order is the rule that keeps this one buried.
--
-- Labels on a disclosed figure, and on no figure at all
-- ----------------------------------------------------
-- A disclosed row took its audited, restated and AI-assisted labels from the
-- inputs of the calculation that was *not* used, so an unaudited disclosure
-- could be labelled from audited figures nobody divided. They now come from the
-- disclosed figure itself. And an unavailable row read as audited, because
-- bool_and over no rows is true: a figure that does not exist was being
-- described as audited. Those labels are now null unless a figure carries them.

-- ---------------------------------------------------------------------------
-- 1. Four reported lines
-- ---------------------------------------------------------------------------

-- The parent's share of profit is signed, because a parent can take a loss, and
-- sits in the core template because every consolidated filing presents it — but
-- is not required, because a company with no subsidiaries does not present it
-- and demanding it would make such a filing impossible to enter whole.
--
-- Current assets and current liabilities arrive for the liquidity ratios; a
-- current ratio built on them is recorded below as a proposal, not seeded live.
--
-- Depreciation arrives as a reported cost. There is deliberately no amortisation
-- line and no derived EBITDA: EBITDA is already a catalogue line entered from
-- the filing where the issuer states it, and a derived one would need both
-- charges plus a view on what the issuer excluded. Recorded as deferred in the
-- architecture doc rather than half-built here.
insert into public.statement_line_catalogue
  (line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note) values
  ('profit_attributable_to_parent', 'Profit attributable to the parent', 'income', 'currency', 'currency', 'signed',
   'Profit for the year attributable to the equity holders of the parent, as the income statement presents it — the group''s profit after tax less the non-controlling interest. Entered from the page; never derived by subtraction.'),
  ('current_assets', 'Current assets', 'balance_sheet', 'currency', 'currency', 'positive',
   'Total current assets as the balance sheet presents them.'),
  ('current_liabilities', 'Current liabilities', 'balance_sheet', 'currency', 'currency', 'positive',
   'Total current liabilities as the balance sheet presents them.'),
  ('depreciation', 'Depreciation', 'income', 'currency', 'currency', 'negative',
   'Depreciation of property and equipment as presented. Amortisation of intangibles is a separate charge and is not included here; where a filing presents the two together, enter the figure it presents and say so in the note.')
on conflict (line_item) do nothing;

insert into public.statement_template_lines (template_id, line_item, is_headline, is_required, sort_order) values
  ('core', 'profit_attributable_to_parent', false, false, 95),
  ('core', 'depreciation',                  false, false, 55),
  ('core', 'current_assets',                false, false, 240),
  ('core', 'current_liabilities',           false, false, 250)
on conflict (template_id, line_item) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Version 2 of the three definitions, awaiting approval
-- ---------------------------------------------------------------------------

insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, record_reason,
   sort_order, supersedes_id)
select
  'roe', 2, 'Return on equity',
  'Profit attributable to the equity holders of the parent, as a percentage of average shareholders'' equity, where the average is the opening and closing equity of the year divided by two. The parent''s share is used rather than the group''s profit after tax, because the equity it is divided by excludes the non-controlling interest; where the filing''s parent-share line has not been entered there is no answer, and none is substituted. A company''s first year held has no opening equity, so it reads Not available: no prior period, until the previous year''s balance sheet is entered.',
  'average_ratio', 'percent', 1, 'returns',
  null, null, null, 'Interim: Technical Lead',
  'Version 1 divided the group''s profit after tax, which includes the non-controlling interest, by equity attributable to the parent, which does not.',
  10, d.id
from public.metric_definitions d where d.code = 'roe' and d.version = 1
on conflict (code, version) do nothing;

insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, record_reason,
   sort_order, supersedes_id)
select
  'revenue_cagr_5y', 2, 'Revenue five-year CAGR',
  'The compound annual growth rate of revenue between the latest financial year and the year four years before it — five years of figures, four years of compounding. Both of those years must be held and both must be positive; where either is absent the rate reads Not available rather than being remeasured over a shorter run and published as five years. The years in between are not used, so a gap between the two ends changes nothing.',
  'cagr', 'percent', 1, 'growth',
  null, null, 5, 'Interim: Technical Lead',
  'Version 1 refused only a window it could not measure at all, so two years of figures would have published as a five-year rate.',
  40, d.id
from public.metric_definitions d where d.code = 'revenue_cagr_5y' and d.version = 1
on conflict (code, version) do nothing;

insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, record_reason,
   sort_order, supersedes_id)
select
  'pat_cagr_5y', 2, 'Profit after tax five-year CAGR',
  'The compound annual growth rate of profit after tax between the latest financial year and the year four years before it — five years of figures, four years of compounding. Both of those years must be held and both must be positive; a loss at either end makes the measure meaningless, and a shorter run is not remeasured and published as five years. The years in between are not used.',
  'cagr', 'percent', 1, 'growth',
  null, null, 5, 'Interim: Technical Lead',
  'Version 1 refused only a window it could not measure at all, so two years of figures would have published as a five-year rate.',
  50, d.id
from public.metric_definitions d where d.code = 'pat_cagr_5y' and d.version = 1
on conflict (code, version) do nothing;

-- A new metric rather than a correction, and so also a proposal: a current
-- ratio is a claim about liquidity and nobody has approved this one.
insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, record_reason,
   sort_order)
values
  ('current_ratio', 1, 'Current ratio',
   'Current assets divided by current liabilities, as a multiple, both from the balance sheet of the same period. It says how far the assets a company expects to turn into cash within the year cover what it owes within the year, and nothing about the quality of either.',
   'ratio', 'times', 2, 'leverage',
   null, null, null, 'Interim: Technical Lead',
   'Recorded with the current assets and current liabilities lines so the liquidity ratio has a definition to be approved rather than appearing without one.',
   50)
on conflict (code, version) do nothing;

insert into public.metric_definition_inputs (definition_id, role, line_item, sign, use_absolute, sort_order)
select d.id, v.role, v.line_item, 1, false, 10
  from (values
    ('roe',             2, 'numerator',   'profit_attributable_to_parent'),
    ('roe',             2, 'denominator', 'shareholders_equity'),
    ('revenue_cagr_5y', 2, 'base',        'revenue'),
    ('pat_cagr_5y',     2, 'base',        'profit_after_tax'),
    ('current_ratio',   1, 'numerator',   'current_assets'),
    ('current_ratio',   1, 'denominator', 'current_liabilities')
  ) as v(code, version, role, line_item)
  join public.metric_definitions d on d.code = v.code and d.version = v.version
 where not exists (
   select 1 from public.metric_definition_inputs i
    where i.definition_id = d.id and i.role = v.role and i.line_item = v.line_item
 );

-- ---------------------------------------------------------------------------
-- 3. The view, replaced
-- ---------------------------------------------------------------------------

-- Same columns, same grants, still SECURITY INVOKER so the licence gate on the
-- underlying figures reaches the ratios built from them.
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
    -- Only figures that exist can carry a label. bool_and over no rows is true,
    -- which is how a ratio with nothing behind it came to read as audited.
    bool_and(i.audited) filter (where i.statement_id is not null) as inputs_audited,
    bool_or(i.as_restated) filter (where i.statement_id is not null) as inputs_restated,
    bool_or(i.ai_assisted) filter (where i.statement_id is not null) as inputs_ai_assisted
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
    -- A disclosed figure's own labels. The calculation it stands aside for was
    -- not performed, so that calculation's inputs say nothing about what is on
    -- the page.
    f.audited as disclosed_audited,
    f.as_restated as disclosed_restated,
    f.ai_assisted as disclosed_ai_assisted,
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
      -- before it. Measuring it over whatever shorter run happens to be held and
      -- publishing that as five years is the defect this replaces: the span must
      -- be the span the definition names, and a window with no earlier endpoint
      -- has no span at all.
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
  -- A label belongs to the figure it describes: the disclosed one where that is
  -- what is shown, the inputs where a calculation was performed, and nothing at
  -- all where there is no figure to describe.
  case
    when j.verdict = 'disclosed' then j.disclosed_audited
    when j.verdict = 'ok' then j.inputs_audited
  end as all_audited,
  case
    when j.verdict = 'disclosed' then j.disclosed_restated
    when j.verdict = 'ok' then j.inputs_restated
  end as any_restated,
  case
    when j.verdict = 'disclosed' then j.disclosed_ai_assisted
    when j.verdict = 'ok' then j.inputs_ai_assisted
  end as any_ai_assisted
from judged j;

-- CREATE OR REPLACE keeps the grants; re-stating them is cheaper than someone
-- later wondering whether it does.
revoke all on public.company_metric_values from anon, authenticated;
grant select on public.company_metric_values to authenticated, service_role;
