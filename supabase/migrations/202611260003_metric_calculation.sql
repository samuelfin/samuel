-- Samuel Terminal — the calculation: ratios from approved figures, in the database.
--
-- One number, one place. The company page, the charts, the five-year download
-- and the methodology page all read these views; nothing else divides anything.
-- The lesson of 3c was that two pieces of code computing the same number
-- eventually disagree, and the cheapest way to make that impossible is to leave
-- only one of them.
--
-- Why views, and why security_invoker
-- -----------------------------------
-- Every view here is SECURITY INVOKER, so the figures it reads are the figures
-- the caller may read. That is not a detail. A figure displays only while an
-- active data_licences row permits the dataset it came through, and that gate
-- lives in the row-level security policy on financial_statements. A definer view
-- would compute return on equity from figures whose licence had been switched
-- off, and the ratio would outlive the right to show its inputs. Switching a
-- dataset off has to take the ratios with it, in the same instant.
--
-- What a calculation may not mix
-- ------------------------------
-- A basis is chosen per company and period: consolidated where any consolidated
-- figures exist, otherwise company-only, and the currency carrying the most
-- figures on that basis. Every input must come from that basis. A series is
-- partitioned by basis too, so a consolidated 2022 never measures its growth
-- against a company-only 2021; the consolidated series simply has no prior year
-- yet, and says so. Predecessor entities are not joined at all: these views key
-- on company_id, and a succession link is a link, never a splice.
--
-- Nothing is estimated, interpolated or carried forward. A missing input, a zero
-- denominator or a first year without an opening balance sheet produces
-- 'not_available' and a reason code, never a zero and never a guess.
--
-- A negative denominator is not an answer either
-- ---------------------------------------------
-- Dividing by a loss, by negative equity or by negative operating income
-- produces a number that reads like a ratio and means nothing: a payout ratio of
-- −40% does not say that 40% of earnings were paid out. Every denominator in
-- this library is a quantity that is meaningful only when positive, so a
-- denominator at or below zero is reported as not applicable with its reason.

-- ---------------------------------------------------------------------------
-- 1. The figures a calculation may use
-- ---------------------------------------------------------------------------

-- Approved annual figures of approved companies, one row per figure, latest
-- version per period and basis. Interim periods are excluded: stage 3d measures
-- financial years, and a ratio built from a half-year beside a full year is a
-- different quantity wearing the same name.
create or replace view public.approved_fy_figures
with (security_invoker = true) as
select distinct on (s.company_id, s.period_end, s.consolidated, s.currency, l.line_item)
  s.company_id,
  s.period_end,
  (extract(year from s.period_end))::int as financial_year,
  s.consolidated,
  s.currency,
  s.audited,
  s.statement_type,
  s.id as statement_id,
  s.version,
  s.document_id,
  l.line_item,
  l.value_standardised,
  l.value_reported,
  l.reported_magnitude,
  l.source_page,
  l.as_restated,
  l.ai_assisted
from public.financial_statements s
join public.financial_statement_lines l on l.statement_id = s.id
join public.companies c on c.id = s.company_id
where s.review_status = 'approved'
  and c.review_status = 'approved'
  and s.period_type = 'FY'
order by s.company_id, s.period_end, s.consolidated, s.currency, l.line_item, s.version desc, s.id;

-- The basis each period is read on. Consolidated wins where it exists, because
-- that is the figure set an issuer presents as the group's results; the currency
-- is the one carrying the most figures on that basis, with ties broken by code so
-- the choice is deterministic rather than whatever the planner returned first.
create or replace view public.company_fy_basis
with (security_invoker = true) as
with periods as (
  select company_id, period_end, financial_year, bool_or(consolidated) as consolidated
    from public.approved_fy_figures
   group by company_id, period_end, financial_year
), weighted as (
  select p.company_id, p.period_end, p.financial_year, p.consolidated, f.currency,
         count(*) as figures
    from periods p
    join public.approved_fy_figures f
      on f.company_id = p.company_id
     and f.period_end = p.period_end
     and f.consolidated = p.consolidated
   group by p.company_id, p.period_end, p.financial_year, p.consolidated, f.currency
)
select distinct on (company_id, period_end)
  company_id, period_end, financial_year, consolidated, currency
from weighted
order by company_id, period_end, figures desc, currency;

-- The year before, within the same series. Partitioned by basis and currency on
-- purpose: a company-only year is not the prior year of a consolidated one, and
-- a series that changed basis starts again rather than measuring across the
-- change.
create or replace view public.company_fy_periods
with (security_invoker = true) as
select
  b.company_id,
  b.period_end,
  b.financial_year,
  b.consolidated,
  b.currency,
  lag(b.period_end) over w as prior_period_end,
  lag(b.financial_year) over w as prior_financial_year
from public.company_fy_basis b
window w as (partition by b.company_id, b.consolidated, b.currency order by b.period_end);

-- ---------------------------------------------------------------------------
-- 2. Which figure each formula asks for, and whether it is there
-- ---------------------------------------------------------------------------

-- One row per company, period, metric and declared input — with the figure it
-- resolved to, or nothing and the reason it is missing. This is the "how
-- calculated" view: the exact figures a ratio used, each with its statement, its
-- document and its page, so a reader can follow a calculated number back to the
-- filings it came from.
create or replace view public.company_metric_inputs
with (security_invoker = true) as
with scope as (
  select
    p.company_id, p.period_end, p.financial_year, p.consolidated, p.currency,
    p.prior_period_end, p.prior_financial_year,
    t.template_id
  from public.company_fy_periods p
  -- The sector template in force for that period, by the same lookup the entry
  -- desk uses: a company can be re-sectored, and the years already entered keep
  -- reading under the template they were entered against.
  left join lateral (
    select cst.template_id
      from public.company_statement_templates cst
     where cst.company_id = p.company_id
       and cst.valid_from <= p.period_end
       and (cst.valid_to is null or cst.valid_to > p.period_end)
     order by cst.valid_from desc
     limit 1
  ) t on true
), applicable as (
  select
    s.*,
    d.id as definition_id, d.code, d.version as definition_version, d.kind,
    d.result_unit, d.decimals, d.metric_group, d.label, d.window_years,
    d.disclosed_line_item
  from scope s
  join public.metric_definitions d
    on d.is_active
   and d.approved_at is not null
   -- A definition with no template applies everywhere; one with a template
   -- applies only to companies entered under it, so a cement company is not
   -- told that its loan-to-deposit ratio is unavailable.
   and (d.template_id is null or d.template_id = s.template_id)
), wanted as (
  select
    a.*,
    i.role, i.line_item, i.sign, i.use_absolute, i.sort_order,
    pr.period_role,
    case pr.period_role
      when 'current' then a.period_end
      when 'prior' then a.prior_period_end
      else w.window_start
    end as figure_period_end
  from applicable a
  join public.metric_definition_inputs i on i.definition_id = a.definition_id
  -- Which periods this input is needed from. An average ratio needs its
  -- denominator at both balance-sheet dates; a growth needs its base at both;
  -- a compound rate needs the base at the start of the window and now.
  cross join lateral (
    select unnest(
      case
        when a.kind = 'average_ratio' and i.role = 'denominator' then array['current', 'prior']
        when a.kind = 'growth' then array['current', 'prior']
        when a.kind = 'cagr' then array['current', 'window_start']
        else array['current']
      end
    ) as period_role
  ) pr
  -- The earliest period held inside the window, on the same basis. A five-year
  -- rate measured over four years would be a different number under the same
  -- name, so the years actually spanned are carried forward and checked.
  left join lateral (
    select min(q.period_end) as window_start
      from public.company_fy_basis q
     where q.company_id = a.company_id
       and q.consolidated = a.consolidated
       and q.currency = a.currency
       and q.period_end <= a.period_end
       and q.period_end > (a.period_end - make_interval(years => a.window_years))
  ) w on a.kind = 'cagr'
)
select
  w.company_id,
  w.period_end,
  w.financial_year,
  w.consolidated,
  w.currency,
  w.template_id,
  w.definition_id,
  w.code,
  w.definition_version,
  w.kind,
  w.label,
  w.result_unit,
  w.decimals,
  w.metric_group,
  w.window_years,
  w.disclosed_line_item,
  w.role,
  w.line_item,
  w.sign,
  w.use_absolute,
  w.sort_order,
  w.period_role,
  w.figure_period_end,
  f.statement_id,
  f.statement_type,
  f.document_id,
  f.source_page,
  f.value_standardised,
  f.value_reported,
  f.reported_magnitude,
  f.audited,
  f.as_restated,
  f.ai_assisted,
  -- The figure as the arithmetic takes it: its sign applied, and its absolute
  -- size where the formula asked for size rather than direction.
  (w.sign * case when w.use_absolute then abs(f.value_standardised) else f.value_standardised end)
    as contribution,
  -- Why a figure is missing, where it is missing for a reason worth naming. A
  -- line entered only under the other basis, or in another currency, is not an
  -- absent figure: it is a figure this calculation may not use.
  (
    f.statement_id is null and w.figure_period_end is not null and exists (
      select 1 from public.approved_fy_figures o
       where o.company_id = w.company_id
         and o.period_end = w.figure_period_end
         and o.line_item = w.line_item
         and o.currency <> w.currency
    )
  ) as missing_in_other_currency,
  (
    f.statement_id is null and w.figure_period_end is not null and exists (
      select 1 from public.approved_fy_figures o
       where o.company_id = w.company_id
         and o.period_end = w.figure_period_end
         and o.line_item = w.line_item
         and o.currency = w.currency
         and o.consolidated <> w.consolidated
    )
  ) as missing_on_other_basis
from wanted w
left join public.approved_fy_figures f
  on f.company_id = w.company_id
 and f.period_end = w.figure_period_end
 and f.consolidated = w.consolidated
 and f.currency = w.currency
 and f.line_item = w.line_item;

-- ---------------------------------------------------------------------------
-- 3. The answer, or the reason there is none
-- ---------------------------------------------------------------------------

-- One row per company, period and metric. status is 'available' with a value,
-- 'disclosed' where the issuer published the figure itself and this stands
-- aside, or 'not_available' with a reason code — and the reason is the point.
-- "Pending verification" and "Not available: no prior period" are different
-- statements about a company, and a reader is owed the right one.
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
    -- The issuer's own figure, where it published one. Joined on the same basis
    -- and currency as the calculation it replaces.
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
      -- The issuer said it. Theirs is the citable number.
      when s.disclosed_statement_id is not null then 'disclosed'
      -- A shape that needs last year, in a year that has no last year on this
      -- basis. Distinct from a missing figure: nothing is pending, there simply
      -- is no earlier year to average or compare against.
      when s.kind in ('average_ratio', 'growth') and s.prior_period_end is null then 'no_prior_period'
      when s.kind = 'cagr' and (s.window_start_period_end is null or s.window_span < 1)
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
  -- Where the figure came from the filing rather than from arithmetic, the page
  -- it is on. A calculated value has no single page, and its inputs each carry
  -- their own in company_metric_inputs.
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

-- ---------------------------------------------------------------------------
-- 4. Who may read them
-- ---------------------------------------------------------------------------

-- No grants to anon: the terminal is behind a login, and a ratio is a reading of
-- licensed filings. The views are security_invoker, so a signed-in caller sees
-- exactly the figures their own policies allow and the arithmetic over nothing
-- else.
revoke all on
  public.approved_fy_figures,
  public.company_fy_basis,
  public.company_fy_periods,
  public.company_metric_inputs,
  public.company_metric_values
from anon, authenticated;

grant select on
  public.approved_fy_figures,
  public.company_fy_basis,
  public.company_fy_periods,
  public.company_metric_inputs,
  public.company_metric_values
to authenticated, service_role;
