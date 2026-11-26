-- Samuel Terminal — the metric register: what a formula is, and who answers for it.
--
-- Stage 3c publishes what the filings say. Stage 3d publishes what follows from
-- it arithmetically, and that is a different kind of claim: a reader can check a
-- reported figure against a page, but a calculated one can only be checked
-- against a definition. So the definition is data, it is versioned, it names an
-- owner and an approver, and the page that shows a ratio can show the formula
-- that produced it.
--
-- Declared shapes, not stored expressions
-- ---------------------------------------
-- A formula could be stored as a string and evaluated. It is not, because
-- evaluating a string inside the database that holds every approved figure is a
-- code-execution surface in the worst possible place, and because a string
-- cannot be checked: nothing would stop a definition referring to a line item
-- that does not exist, or to itself.
--
-- Instead a definition declares its shape and its inputs. Six shapes cover the
-- whole library:
--
--   sum            value = Σ signed inputs                 (free cash flow)
--   margin         numerator / denominator, as a percentage (net margin)
--   ratio          numerator / denominator, as a multiple   (debt to equity)
--   average_ratio  numerator / mean(denominator this period and last), percent
--                                                           (return on equity)
--   growth         (base now − base then) / |base then|, percent
--   cagr           compound annual growth of base over the window, percent
--
-- and three input roles — numerator, denominator, base — each a signed sum of
-- catalogue lines, optionally taken as an absolute value. Non-performing loan
-- coverage is then (gross loans − net loans) ÷ non-performing loans without any
-- new machinery, and interest cover divides operating profit by the absolute
-- value of finance costs, which 3c stores negative.
--
-- Adding a seventh shape is a migration with a test. That is the point: the
-- shapes are the part a reviewer must read, and there are six of them.
--
-- A disclosed ratio wins
-- ----------------------
-- 3c stores NPL ratio, capital adequacy, cost-to-income, net interest margin
-- and EBITDA margin as reported disclosures, because an issuer computes them
-- under its own regulator's definition and only that number is citable to a
-- page. Where a definition here would produce a second, different number under
-- the same name, it names the disclosed line in disclosed_line_item. The
-- calculation in the next migration then stands aside for any period where the
-- issuer disclosed the figure, and says so.
--
-- Interim methodology
-- -------------------
-- These definitions are seeded approved, owned by the technical lead, and
-- flagged self-approved — the house rule is flag, don't block, and a ratio
-- library nobody can see is not safer than one labelled honestly. The economist
-- has not reviewed them. review_self_approved carries that on every row, the
-- methodology page says it in words, and economist sign-off is recorded as a
-- launch gate in the architecture doc.

-- ---------------------------------------------------------------------------
-- 1. One catalogue line the bank ratios need
-- ---------------------------------------------------------------------------

-- Cost-to-income is in the catalogue as a disclosure, but nothing in the bank
-- template carries the expense side, so for a bank that does not disclose the
-- ratio there is no honest derived answer. This is the reported line it divides:
-- total operating expenses as the income statement presents them. A reported
-- line, entered from a page like any other, and the reason the catalogue was
-- built to take rows rather than migrations.
insert into public.statement_line_catalogue
  (line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note) values
  ('operating_expenses', 'Operating expenses', 'income', 'currency', 'currency', 'negative',
   'Total operating expenses as presented, before impairment charges where the filing separates them. For a bank this is the expense side of cost-to-income.')
on conflict (line_item) do nothing;

insert into public.statement_template_lines (template_id, line_item, is_headline, is_required, sort_order) values
  ('bank', 'operating_expenses', false, false, 70)
on conflict (template_id, line_item) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The definitions
-- ---------------------------------------------------------------------------

create table if not exists public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  -- Stable across versions. The page addresses a metric by code; the version it
  -- used is recorded beside the number.
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  version integer not null check (version > 0),
  label text not null check (char_length(btrim(label)) between 2 and 80 and label !~ '[[:cntrl:]]'),
  -- Plain language, for a reader who will not read SQL. Required, and long
  -- enough to have said something: a formula with no explanation is a formula
  -- nobody can dispute.
  definition text not null check (char_length(btrim(definition)) between 20 and 1000 and definition !~ '[[:cntrl:]]'),
  kind text not null check (kind in ('sum', 'margin', 'ratio', 'average_ratio', 'growth', 'cagr')),
  -- How to read the answer. 'percent' and 'times' are calculated values;
  -- 'currency' is a sum of reported figures and carries the statement's currency.
  result_unit text not null check (result_unit in ('percent', 'times', 'currency')),
  decimals smallint not null default 1 check (decimals between 0 and 4),
  metric_group text not null check (metric_group in
    ('profitability', 'growth', 'returns', 'leverage', 'cash_flow', 'dividends', 'banking')),
  -- Null applies the definition to every company. A template id restricts it to
  -- companies entered under that sector template, so a reader of a cement
  -- company is not told that its loan-to-deposit ratio is unavailable.
  template_id text references public.statement_templates (id),
  -- The reported disclosure this derived figure yields to. Where an issuer
  -- discloses the ratio for a period, the disclosed figure is what is shown.
  disclosed_line_item text references public.statement_line_catalogue (line_item),
  -- Over how many years a cagr is measured. Null for every other shape.
  window_years integer check (window_years is null or window_years between 2 and 20),
  owner_name text not null check (char_length(btrim(owner_name)) between 2 and 120 and owner_name !~ '[[:cntrl:]]'),
  approved_by uuid references auth.users (id) on delete set null,
  -- Who approved it, as a name, because the seeded rows predate any user row and
  -- because an approver who later leaves must not take the record with them.
  approved_by_name text check (approved_by_name is null or (char_length(btrim(approved_by_name)) between 2 and 120 and approved_by_name !~ '[[:cntrl:]]')),
  approved_at timestamptz,
  -- The same flag the rest of the platform carries: the owner approved their own
  -- definition. Allowed while the team is small, recorded always, and shown.
  review_self_approved boolean not null default false,
  effective_from date not null default current_date,
  supersedes_id uuid references public.metric_definitions (id),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (code, version),
  constraint metric_definitions_approval_check check (
    approved_at is null or approved_by is not null or approved_by_name is not null
  ),
  constraint metric_definitions_window_check check (
    (kind = 'cagr') = (window_years is not null)
  ),
  constraint metric_definitions_version_chain_check check (
    (version = 1 and supersedes_id is null) or (version > 1 and supersedes_id is not null)
  ),
  -- A sum of reported figures is in the statement's currency; everything else
  -- this library computes is a percentage or a multiple.
  constraint metric_definitions_unit_check check (
    (kind = 'sum') = (result_unit = 'currency')
  )
);

-- One live version of each metric. A new version deactivates the old one in the
-- same transaction; two active versions would make "which formula produced this
-- number" unanswerable.
create unique index if not exists metric_definitions_one_active_idx
  on public.metric_definitions (code) where is_active;

create index if not exists metric_definitions_code_idx
  on public.metric_definitions (code, version desc);

create table if not exists public.metric_definition_inputs (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.metric_definitions (id) on delete restrict,
  -- 'base' is the single quantity a growth or cagr measures. 'numerator' and
  -- 'denominator' are the two sides of everything else; a 'sum' has a numerator
  -- and no denominator.
  role text not null check (role in ('numerator', 'denominator', 'base')),
  line_item text not null references public.statement_line_catalogue (line_item),
  -- Added or subtracted within its role. Non-performing loan coverage subtracts
  -- net loans from gross loans to reach the impairment allowance.
  sign smallint not null default 1 check (sign in (1, -1)),
  -- Take the figure's absolute value first. 3c stores costs negative, and
  -- interest cover divides by the size of finance costs, not by its sign.
  use_absolute boolean not null default false,
  sort_order integer not null default 10,
  unique (definition_id, role, line_item)
);

create index if not exists metric_definition_inputs_definition_idx
  on public.metric_definition_inputs (definition_id, role, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Guards
-- ---------------------------------------------------------------------------

-- A definition is a published methodology claim. Correcting one is a new
-- version, exactly as correcting a figure is; the only field that moves is
-- is_active, which is how a version is retired.
create or replace function public.guard_metric_definition_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Metric definitions are append-only; deactivate the version and record a new one'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - 'is_active'::text) is distinct from (to_jsonb(old) - 'is_active'::text) then
    raise exception 'A metric definition is fixed once recorded; record a new version to change it'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists metric_definitions_guard on public.metric_definitions;
create trigger metric_definitions_guard before update or delete on public.metric_definitions
for each row execute function public.guard_metric_definition_row();

-- The inputs are part of the definition they belong to, so they are as fixed as
-- it is. Changing one would silently change the meaning of every number already
-- published under that version.
create or replace function public.guard_metric_definition_input_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'A metric definition''s inputs are fixed; record a new version of the definition'
    using errcode = '42501';
end;
$$;

drop trigger if exists metric_definition_inputs_guard on public.metric_definition_inputs;
create trigger metric_definition_inputs_guard before update or delete on public.metric_definition_inputs
for each row execute function public.guard_metric_definition_input_row();

-- The shape decides which roles are allowed. Checked in the database rather than
-- in the seed, because a definition with a denominator it never divides by, or a
-- growth with no base, computes nothing and would reach a reader as a permanent
-- "Not available" with no explanation anybody could act on.
create or replace function public.guard_metric_definition_shape()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  shape text;
  line public.statement_line_catalogue%rowtype;
begin
  select kind into shape from public.metric_definitions where id = new.definition_id;
  if shape is null then
    raise exception 'No such metric definition: %', new.definition_id using errcode = '23503';
  end if;

  if shape in ('growth', 'cagr') and new.role <> 'base' then
    raise exception 'A % measures one base quantity; it takes no %', shape, new.role
      using errcode = '23514';
  end if;
  if shape not in ('growth', 'cagr') and new.role = 'base' then
    raise exception 'A % divides a numerator by a denominator; it has no base', shape
      using errcode = '23514';
  end if;
  if shape = 'sum' and new.role = 'denominator' then
    raise exception 'A sum has no denominator' using errcode = '23514';
  end if;

  -- A derived metric is arithmetic over reported figures. A disclosed ratio is
  -- never an input to a calculation: it is the answer, cited to its page.
  select * into line from public.statement_line_catalogue where line_item = new.line_item;
  if line.unit_kind = 'percent' then
    raise exception '% is a disclosed ratio, not an input to one', new.line_item using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists metric_definition_inputs_shape_guard on public.metric_definition_inputs;
create trigger metric_definition_inputs_shape_guard before insert on public.metric_definition_inputs
for each row execute function public.guard_metric_definition_shape();

-- ---------------------------------------------------------------------------
-- 4. Who may read a definition
-- ---------------------------------------------------------------------------

alter table public.metric_definitions enable row level security;
alter table public.metric_definition_inputs enable row level security;

revoke all on public.metric_definitions, public.metric_definition_inputs from anon, authenticated;
grant select on public.metric_definitions, public.metric_definition_inputs to authenticated;
grant all on public.metric_definitions, public.metric_definition_inputs to service_role;

-- A methodology is meant to be read. An approved definition is readable by any
-- signed-in user, because that is what makes a calculated number auditable; one
-- that has not been approved is the desk's draft and is not methodology yet.
drop policy if exists "Readers see approved metric definitions" on public.metric_definitions;
create policy "Readers see approved metric definitions" on public.metric_definitions
for select to authenticated using (
  approved_at is not null
  or public.is_platform_admin()
  or public.has_staff_role(array['financial_analyst'])
);

-- The same lookup the inputs policy needs, inside a definer function. An inline
-- exists() over metric_definitions would evaluate under that table's own policy,
-- which is the mutual recursion 202611210007 and 202611230001 closed elsewhere.
-- It returns exactly what the policy above returns, so it discloses nothing a
-- SELECT would not.
create or replace function public.metric_definition_is_readable(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.metric_definitions d
     where d.id = target and d.approved_at is not null
  );
$$;

revoke all on function public.metric_definition_is_readable(uuid) from public, anon;
grant execute on function public.metric_definition_is_readable(uuid) to authenticated, service_role;

drop policy if exists "Readers see inputs of approved definitions" on public.metric_definition_inputs;
create policy "Readers see inputs of approved definitions" on public.metric_definition_inputs
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['financial_analyst'])
  or public.metric_definition_is_readable(definition_id)
);

-- ---------------------------------------------------------------------------
-- 5. The library
-- ---------------------------------------------------------------------------

-- Seeded approved, owned by the technical lead, flagged self-approved. The
-- economist named in the plan has not been recruited; until they have reviewed
-- these, the methodology page says so on every definition.
insert into public.metric_definitions
  (code, version, label, definition, kind, result_unit, decimals, metric_group,
   template_id, disclosed_line_item, window_years, owner_name, approved_by_name,
   approved_at, review_self_approved, sort_order)
values
  ('gross_margin', 1, 'Gross margin',
   'Gross profit as a percentage of revenue. Both figures are taken from the income statement of the same period, on the same consolidated basis and in the currency the filing reports.',
   'margin', 'percent', 1, 'profitability', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 10),

  ('operating_margin', 1, 'Operating margin',
   'Operating profit as a percentage of revenue, from the income statement of the same period. Issuers differ on what sits above operating profit; this uses the line the filing labels as such.',
   'margin', 'percent', 1, 'profitability', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 20),

  ('net_margin', 1, 'Net profit margin',
   'Profit after tax as a percentage of revenue, from the income statement of the same period. Profit after tax is taken as reported, including any loss, so a loss-making year shows a negative margin.',
   'margin', 'percent', 1, 'profitability', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 30),

  ('ebitda_margin_calculated', 1, 'EBITDA margin',
   'EBITDA as a percentage of revenue, using the EBITDA figure the filing states. Where the issuer discloses the margin itself, the disclosed figure is shown instead, because it is computed under the issuer''s own definition and cites a page.',
   'margin', 'percent', 1, 'profitability', null, 'ebitda_margin', null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 40),

  ('revenue_growth', 1, 'Revenue growth',
   'The change in revenue from the previous financial year, as a percentage of the previous year''s revenue. Both years must be on the same consolidated basis and in the same currency; where the previous year is missing, this reads Not available rather than being measured against a longer gap.',
   'growth', 'percent', 1, 'growth', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 10),

  ('pat_growth', 1, 'Profit after tax growth',
   'The change in profit after tax from the previous financial year, as a percentage of the previous year''s profit. Where the previous year was a loss, growth is not a meaningful measure and this reads Not available.',
   'growth', 'percent', 1, 'growth', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 20),

  ('eps_growth', 1, 'Earnings per share growth',
   'The change in basic earnings per share from the previous financial year, as a percentage of the previous year''s figure. Earnings per share is taken as reported, not recalculated from profit and share count.',
   'growth', 'percent', 1, 'growth', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 30),

  ('revenue_cagr_5y', 1, 'Revenue five-year CAGR',
   'The compound annual growth rate of revenue over five financial years, measured between the earliest and the latest year held within that window, both of which must be positive. It is not an average of the yearly changes and it says nothing about the years in between.',
   'cagr', 'percent', 1, 'growth', null, null, 5,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 40),

  ('pat_cagr_5y', 1, 'Profit after tax five-year CAGR',
   'The compound annual growth rate of profit after tax over five financial years, measured between the earliest and the latest year held within that window, both of which must be positive. A loss at either end makes the measure meaningless, and it reads Not available.',
   'cagr', 'percent', 1, 'growth', null, null, 5,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 50),

  ('roe', 1, 'Return on equity',
   'Profit after tax as a percentage of average shareholders'' equity, where the average is the opening and closing equity of the year divided by two. A company''s first year held has no opening equity, so it reads Not available: no prior period, until the previous year''s balance sheet is entered.',
   'average_ratio', 'percent', 1, 'returns', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 10),

  ('roa', 1, 'Return on assets',
   'Profit after tax as a percentage of average total assets, where the average is the opening and closing total assets of the year divided by two. As with return on equity, the first year held reads Not available until the previous year''s balance sheet is entered.',
   'average_ratio', 'percent', 1, 'returns', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 20),

  ('debt_to_equity', 1, 'Debt to equity',
   'Total borrowings divided by shareholders'' equity, as a multiple. Borrowings means interest-bearing debt as reported, not total liabilities, which include payables and provisions.',
   'ratio', 'times', 2, 'leverage', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 10),

  ('net_debt_to_equity', 1, 'Net debt to equity',
   'Net debt divided by shareholders'' equity, as a multiple, using the net debt figure the issuer discloses. It is negative where the issuer reports a net cash position, and Not available where net debt is not disclosed.',
   'ratio', 'times', 2, 'leverage', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 20),

  ('equity_ratio', 1, 'Equity ratio',
   'Shareholders'' equity as a percentage of total assets: the share of the balance sheet funded by its owners rather than by liabilities.',
   'margin', 'percent', 1, 'leverage', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 30),

  ('interest_cover', 1, 'Interest cover',
   'Operating profit divided by the size of finance costs, as a multiple: how many times over the period''s operating profit would meet its finance costs. Finance costs are taken as an absolute amount, however the filing presented them.',
   'ratio', 'times', 2, 'leverage', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 40),

  ('cash_conversion', 1, 'Cash conversion',
   'Net cash from operations as a percentage of profit after tax: how much of the reported profit arrived as operating cash. Where the period made a loss, the comparison is not meaningful and this reads Not available.',
   'margin', 'percent', 0, 'cash_flow', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 10),

  ('free_cash_flow_calculated', 1, 'Free cash flow',
   'Net cash from operations less capital expenditure, in the currency of the filing. Capital expenditure is stored as an outflow, so the two are added. Where the issuer states free cash flow itself, the disclosed figure is shown instead, because issuers define it differently.',
   'sum', 'currency', 0, 'cash_flow', null, 'free_cash_flow', null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 20),

  ('capex_intensity', 1, 'Capital expenditure intensity',
   'Capital expenditure as a percentage of revenue, taking the capital expenditure as an absolute amount. It measures how much of a year''s turnover was reinvested in property, plant and intangibles.',
   'margin', 'percent', 1, 'cash_flow', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 30),

  ('payout_ratio', 1, 'Dividend payout ratio',
   'Dividend per share declared for the period as a percentage of basic earnings per share, both as reported. It is the share of each year''s earnings paid out, not the share of cash flow, and it reads Not available where the period made a loss per share.',
   'margin', 'percent', 1, 'dividends', null, null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 10),

  ('net_interest_margin_calculated', 1, 'Net interest margin',
   'Net interest income as a percentage of average total assets. This is not the measure a bank publishes: a bank''s own net interest margin is taken over average interest-earning assets, which is a smaller base and so a higher figure. Where the bank discloses its margin, the disclosed figure is shown instead, and this is computed only where it does not.',
   'average_ratio', 'percent', 1, 'banking', 'bank', 'net_interest_margin', null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 10),

  ('cost_to_income_calculated', 1, 'Cost-to-income ratio',
   'Total operating expenses, as an absolute amount, as a percentage of total operating income. Issuers differ on whether impairment charges belong in the numerator; this uses the operating expenses line as the filing presents it, and shows the bank''s own disclosed ratio instead wherever it discloses one.',
   'margin', 'percent', 1, 'banking', 'bank', 'cost_to_income_ratio', null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 20),

  ('loan_to_deposit', 1, 'Loan to deposit ratio',
   'Net loans and advances as a percentage of customer deposits, both from the balance sheet of the same period. It uses loans after impairment allowance, which is the figure the balance sheet carries.',
   'margin', 'percent', 1, 'banking', 'bank', null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 30),

  ('npl_coverage', 1, 'Non-performing loan coverage',
   'The impairment allowance as a percentage of non-performing loans. The allowance is not reported directly, so it is taken as gross loans less net loans and advances — a difference of two reported figures, which is why this is a calculated metric and not a disclosure.',
   'margin', 'percent', 1, 'banking', 'bank', null, null,
   'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, 40)
on conflict (code, version) do nothing;

-- The inputs. Written against the codes above so the seed reads as the formulas
-- do: what is divided, by what, and which way round.
insert into public.metric_definition_inputs (definition_id, role, line_item, sign, use_absolute, sort_order)
select d.id, v.role, v.line_item, v.sign, v.use_absolute, v.sort_order
  from (values
    ('gross_margin',                   'numerator',   'gross_profit',             1, false, 10),
    ('gross_margin',                   'denominator', 'revenue',                  1, false, 10),
    ('operating_margin',               'numerator',   'operating_profit',         1, false, 10),
    ('operating_margin',               'denominator', 'revenue',                  1, false, 10),
    ('net_margin',                     'numerator',   'profit_after_tax',         1, false, 10),
    ('net_margin',                     'denominator', 'revenue',                  1, false, 10),
    ('ebitda_margin_calculated',       'numerator',   'ebitda',                   1, false, 10),
    ('ebitda_margin_calculated',       'denominator', 'revenue',                  1, false, 10),
    ('revenue_growth',                 'base',        'revenue',                  1, false, 10),
    ('pat_growth',                     'base',        'profit_after_tax',         1, false, 10),
    ('eps_growth',                     'base',        'earnings_per_share',       1, false, 10),
    ('revenue_cagr_5y',                'base',        'revenue',                  1, false, 10),
    ('pat_cagr_5y',                    'base',        'profit_after_tax',         1, false, 10),
    ('roe',                            'numerator',   'profit_after_tax',         1, false, 10),
    ('roe',                            'denominator', 'shareholders_equity',      1, false, 10),
    ('roa',                            'numerator',   'profit_after_tax',         1, false, 10),
    ('roa',                            'denominator', 'total_assets',             1, false, 10),
    ('debt_to_equity',                 'numerator',   'total_borrowings',         1, false, 10),
    ('debt_to_equity',                 'denominator', 'shareholders_equity',      1, false, 10),
    ('net_debt_to_equity',             'numerator',   'net_debt',                 1, false, 10),
    ('net_debt_to_equity',             'denominator', 'shareholders_equity',      1, false, 10),
    ('equity_ratio',                   'numerator',   'shareholders_equity',      1, false, 10),
    ('equity_ratio',                   'denominator', 'total_assets',             1, false, 10),
    ('interest_cover',                 'numerator',   'operating_profit',         1, false, 10),
    ('interest_cover',                 'denominator', 'finance_costs',            1, true,  10),
    ('cash_conversion',                'numerator',   'operating_cash_flow',      1, false, 10),
    ('cash_conversion',                'denominator', 'profit_after_tax',         1, false, 10),
    ('free_cash_flow_calculated',      'numerator',   'operating_cash_flow',      1, false, 10),
    ('free_cash_flow_calculated',      'numerator',   'capital_expenditure',      1, false, 20),
    ('capex_intensity',                'numerator',   'capital_expenditure',      1, true,  10),
    ('capex_intensity',                'denominator', 'revenue',                  1, false, 10),
    ('payout_ratio',                   'numerator',   'dividend_per_share',       1, false, 10),
    ('payout_ratio',                   'denominator', 'earnings_per_share',       1, false, 10),
    ('net_interest_margin_calculated', 'numerator',   'net_interest_income',      1, false, 10),
    ('net_interest_margin_calculated', 'denominator', 'total_assets',             1, false, 10),
    ('cost_to_income_calculated',      'numerator',   'operating_expenses',       1, true,  10),
    ('cost_to_income_calculated',      'denominator', 'total_operating_income',   1, false, 10),
    ('loan_to_deposit',                'numerator',   'net_loans_and_advances',   1, false, 10),
    ('loan_to_deposit',                'denominator', 'customer_deposits',        1, false, 10),
    ('npl_coverage',                   'numerator',   'gross_loans',              1, false, 10),
    ('npl_coverage',                   'numerator',   'net_loans_and_advances',  -1, false, 20),
    ('npl_coverage',                   'denominator', 'non_performing_loans',     1, false, 10)
  ) as v(code, role, line_item, sign, use_absolute, sort_order)
  join public.metric_definitions d on d.code = v.code and d.version = 1
 where not exists (
   select 1 from public.metric_definition_inputs i
    where i.definition_id = d.id and i.role = v.role and i.line_item = v.line_item
 );
