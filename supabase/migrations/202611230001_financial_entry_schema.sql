-- Samuel Terminal — the financial entry schema: what a figure is, and what it must carry.
--
-- Stage 3c is where this platform stops describing companies and starts
-- publishing their numbers. The foundation migration left a spine —
-- financial_statements and financial_statement_lines, append-only, reviewed,
-- superseded by version — and this migration gives it the things the CEO's
-- coverage document requires and the shape a desk can drive.
--
-- Four decisions are built in rather than left to the desk.
--
-- The reported figure and the standardised figure are different columns
-- -------------------------------------------------------------------
-- A filing says "1,234" under a heading that says ₦'000, and sometimes
-- "(1,234)" to mean an outflow. Storing only the number we can do arithmetic on
-- loses what the page said; storing only what the page said makes every later
-- query re-derive it. So both are kept: value_reported is the figure as printed,
-- with its own magnitude and a note of whether it was bracketed, and
-- value_standardised is that figure in absolute units with a consistent sign.
-- Standardisation means exactly three things — the issuer's label mapped to a
-- canonical line item, the magnitude normalised, and the sign normalised. It
-- never means currency conversion: a naira figure for a company reporting in
-- dollars is a calculation with its own rate and its own source, and it belongs
-- to 3d, not here.
--
-- The line catalogue is defined once, not per template
-- ---------------------------------------------------
-- Six sector templates all contain "revenue". If each defined it, the six
-- definitions would drift and no two companies would be comparable. So a line
-- item is defined once in statement_line_catalogue — its statement, its unit,
-- its sign convention, its definition — and a template is a selection of those
-- lines with an order and a headline flag. Adding a seventh sector is rows in
-- two tables, not a migration.
--
-- A disclosed ratio is a reported figure
-- --------------------------------------
-- NPL ratio, capital adequacy, cost-to-income and net interest margin are in
-- this catalogue, because a bank discloses them under its regulator's
-- definition and that number is citable to a page. Revenue growth, ROE, ROA,
-- net margin and dividend yield are deliberately absent: they are arithmetic
-- over other lines, so they are derived metrics with a recorded formula version
-- in 3d. Entering a computed number here would let a calculation claim a page
-- reference it does not have.
--
-- A restatement by the issuer is not a correction by us
-- ----------------------------------------------------
-- Both produce a new version. They are not the same event: one is the company
-- revising its own history, the other is this desk having typed it wrong.
-- Recording them in one field would attribute our error to the issuer, so
-- restatement_kind separates them and the reader is told which happened.

-- ---------------------------------------------------------------------------
-- 1. A role for the people who enter figures
-- ---------------------------------------------------------------------------

-- Separate from 'analyst' on purpose. The analyst role runs the company and
-- leadership registers; entering and checking financial statements is a
-- different job with a different competence, and the CEO's plan says not to
-- compromise on it. Keeping them apart costs nothing now and is the difference
-- between "staff" and "the person who may publish a balance sheet" later.
alter table public.platform_staff drop constraint if exists platform_staff_role_check;
alter table public.platform_staff add constraint platform_staff_role_check
  check (role in ('editor', 'analyst', 'fact_checker', 'publisher', 'financial_analyst'));

-- ---------------------------------------------------------------------------
-- 2. The line catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.statement_line_catalogue (
  -- The same pattern financial_statement_lines.line_item already enforces, so
  -- the catalogue can key the lines themselves.
  line_item text primary key check (line_item ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text not null check (char_length(btrim(label)) between 2 and 120 and label !~ '[[:cntrl:]]'),
  statement_type text not null check (statement_type in ('income', 'balance_sheet', 'cash_flow', 'operating')),
  -- What kind of quantity this is, which decides whether two figures may be
  -- added at all. 'currency' is money in the statement's currency;
  -- 'currency_per_unit' is money per tonne, per subscriber and the like;
  -- 'quantity' is a physical or customer measure whose unit is in unit_label.
  unit_kind text not null check (unit_kind in ('currency', 'currency_per_unit', 'per_share', 'percent', 'count', 'quantity')),
  -- The unit as a reader should see it: 'tonnes', 'MWh', 'boe/d', '%',
  -- 'subscribers', 'per tonne'. Display and documentation, not arithmetic.
  unit_label text not null check (char_length(btrim(unit_label)) between 1 and 40 and unit_label !~ '[[:cntrl:]]'),
  -- The sign value_standardised must carry.
  --   'positive' — cannot be negative: revenue, total assets, a subscriber count.
  --   'negative' — an outflow or a cost, stored negative however the filing
  --                presented it, so a sum of an income statement works.
  --   'signed'   — genuinely either: profit, operating cash flow, EPS.
  -- This is the sign convention the filings do not have. A cement company
  -- prints cost of sales in brackets, a bank prints interest expense plain, and
  -- without this the two would not add up the same way.
  standard_sign text not null check (standard_sign in ('positive', 'negative', 'signed')),
  definition_note text,
  created_at timestamptz not null default now()
);

create index if not exists statement_line_catalogue_statement_idx
  on public.statement_line_catalogue (statement_type, line_item);

-- Core lines: what every company in the pilot universe reports, whatever it
-- sells. Absent on purpose: revenue growth, ROE, ROA, net profit margin and
-- dividend yield, which 3d computes from these with a recorded formula.
insert into public.statement_line_catalogue
  (line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note) values
  ('revenue',             'Revenue',                  'income',        'currency',  'currency',  'positive', 'Turnover as presented. A bank''s equivalent is gross earnings or total operating income; use the bank lines rather than forcing this one.'),
  ('cost_of_sales',       'Cost of sales',            'income',        'currency',  'currency',  'negative', null),
  ('gross_profit',        'Gross profit',             'income',        'currency',  'currency',  'signed',   null),
  ('operating_profit',    'Operating profit',         'income',        'currency',  'currency',  'signed',   null),
  ('ebitda',              'EBITDA',                   'income',        'currency',  'currency',  'signed',   'Enter only where the filing or results release states it. Where it does not, 3d computes it and labels it a derived metric.'),
  ('finance_costs',       'Finance costs',            'income',        'currency',  'currency',  'negative', null),
  ('profit_before_tax',   'Profit before tax',        'income',        'currency',  'currency',  'signed',   null),
  ('income_tax_expense',  'Income tax expense',       'income',        'currency',  'currency',  'negative', null),
  ('profit_after_tax',    'Profit after tax',         'income',        'currency',  'currency',  'signed',   null),
  ('earnings_per_share',  'Earnings per share',       'income',        'per_share', 'per share', 'signed',   'Basic EPS as reported, in the statement currency per share.'),
  ('dividend_per_share',  'Dividend per share',       'income',        'per_share', 'per share', 'positive', 'Declared for the period, as reported.'),
  ('total_assets',        'Total assets',             'balance_sheet', 'currency',  'currency',  'positive', null),
  ('total_liabilities',   'Total liabilities',        'balance_sheet', 'currency',  'currency',  'positive', null),
  ('total_borrowings',    'Total borrowings',         'balance_sheet', 'currency',  'currency',  'positive', 'Interest-bearing debt. Kept separate from total liabilities, which includes payables and provisions.'),
  ('shareholders_equity', 'Shareholders'' equity',    'balance_sheet', 'currency',  'currency',  'signed',   'Equity attributable to the owners of the parent, as reported.'),
  ('operating_cash_flow', 'Net cash from operations', 'cash_flow',     'currency',  'currency',  'signed',   null),
  ('capital_expenditure', 'Capital expenditure',      'cash_flow',     'currency',  'currency',  'negative', 'Purchase of property, plant and equipment and intangibles, as presented.'),
  ('free_cash_flow',      'Free cash flow',           'cash_flow',     'currency',  'currency',  'signed',   'Enter only where the filing states it; definitions differ between issuers. Otherwise 3d computes it.'),
  ('shares_outstanding',  'Shares outstanding',       'operating',     'count',     'shares',    'positive', 'Issued and fully paid ordinary shares at the period end.')
on conflict (line_item) do nothing;

-- Bank lines. A Nigerian bank does not report "revenue" and "cost of sales",
-- and asking an analyst to map interest income onto a retailer's template is
-- how a figure ends up under the wrong heading.
insert into public.statement_line_catalogue
  (line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note) values
  ('interest_income',        'Interest income',             'income',        'currency', 'currency', 'positive', null),
  ('interest_expense',       'Interest expense',            'income',        'currency', 'currency', 'negative', null),
  ('net_interest_income',    'Net interest income',         'income',        'currency', 'currency', 'signed',   null),
  ('non_interest_income',    'Non-interest income',         'income',        'currency', 'currency', 'signed',   'Fees, commissions, trading and other income, as presented.'),
  ('total_operating_income', 'Total operating income',      'income',        'currency', 'currency', 'signed',   null),
  ('loan_loss_impairment',   'Loan-loss impairment charge', 'income',        'currency', 'currency', 'negative', null),
  ('gross_loans',            'Gross loans and advances',    'balance_sheet', 'currency', 'currency', 'positive', 'Before impairment allowance.'),
  ('net_loans_and_advances', 'Loans and advances (net)',    'balance_sheet', 'currency', 'currency', 'positive', 'After impairment allowance.'),
  ('non_performing_loans',   'Non-performing loans',        'balance_sheet', 'currency', 'currency', 'positive', null),
  ('customer_deposits',      'Customer deposits',           'balance_sheet', 'currency', 'currency', 'positive', null),
  ('npl_ratio',              'NPL ratio',                   'operating',     'percent',  '%',        'positive', 'As disclosed by the bank under its regulator''s definition. Never divided out here — a computed ratio has no page to cite.'),
  ('capital_adequacy_ratio', 'Capital adequacy ratio',      'operating',     'percent',  '%',        'positive', 'As disclosed, on the basis the bank states (bank or group).'),
  ('liquidity_ratio',        'Liquidity ratio',             'operating',     'percent',  '%',        'positive', 'As disclosed.'),
  ('cost_to_income_ratio',   'Cost-to-income ratio',        'operating',     'percent',  '%',        'positive', 'As disclosed; issuers differ on whether impairment is included.'),
  ('net_interest_margin',    'Net interest margin',         'operating',     'percent',  '%',        'signed',   'As disclosed.')
on conflict (line_item) do nothing;

-- Telecoms, cement and industrial, food and consumer, oil and gas, power.
insert into public.statement_line_catalogue
  (line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note) values
  ('service_revenue',            'Service revenue',                'income',        'currency',          'currency',         'positive', null),
  ('data_revenue',               'Data revenue',                   'income',        'currency',          'currency',         'positive', null),
  ('voice_revenue',              'Voice revenue',                  'income',        'currency',          'currency',         'positive', null),
  ('fintech_revenue',            'Mobile money / fintech revenue', 'income',        'currency',          'currency',         'positive', null),
  ('ebitda_margin',              'EBITDA margin',                  'operating',     'percent',           '%',                'signed',   'As disclosed in the results release. Where it is not disclosed, 3d computes it.'),
  ('total_subscribers',          'Total subscribers',              'operating',     'quantity',          'subscribers',      'positive', null),
  ('active_data_subscribers',    'Active data subscribers',        'operating',     'quantity',          'subscribers',      'positive', null),
  ('arpu',                       'ARPU',                           'operating',     'currency_per_unit', 'per subscriber',   'positive', 'Average revenue per user, as disclosed, on the period basis the issuer states.'),
  ('data_traffic',               'Data traffic',                   'operating',     'quantity',          'petabytes',        'positive', null),
  ('net_debt',                   'Net debt',                       'balance_sheet', 'currency',          'currency',         'signed',   'As disclosed. Negative where the issuer reports a net cash position.'),
  ('sales_volume_tonnes',        'Sales volume',                   'operating',     'quantity',          'tonnes',           'positive', null),
  ('production_capacity_tonnes', 'Production capacity',            'operating',     'quantity',          'tonnes per annum', 'positive', null),
  ('capacity_utilisation',       'Capacity utilisation',           'operating',     'percent',           '%',                'positive', 'As disclosed.'),
  ('average_price_per_tonne',    'Average selling price',          'operating',     'currency_per_unit', 'per tonne',        'positive', 'As disclosed.'),
  ('energy_and_fuel_costs',      'Energy and fuel costs',          'income',        'currency',          'currency',         'negative', null),
  ('raw_material_costs',         'Raw material costs',             'income',        'currency',          'currency',         'negative', null),
  ('distribution_costs',         'Distribution costs',             'income',        'currency',          'currency',         'negative', null),
  ('inventory',                  'Inventory',                      'balance_sheet', 'currency',          'currency',         'positive', null),
  ('trade_receivables',          'Trade receivables',              'balance_sheet', 'currency',          'currency',         'positive', null),
  ('trade_payables',             'Trade payables',                 'balance_sheet', 'currency',          'currency',         'positive', null),
  ('production_volume',          'Production volume',              'operating',     'quantity',          'units',            'positive', 'The issuer''s own volume measure; state the unit in the note where it is not obvious.'),
  ('production_boe_per_day',     'Production',                     'operating',     'quantity',          'boe/d',            'positive', 'Working-interest production as disclosed.'),
  ('oil_production_bopd',        'Oil production',                 'operating',     'quantity',          'bbl/d',            'positive', null),
  ('gas_production_mmscfd',      'Gas production',                 'operating',     'quantity',          'MMscf/d',          'positive', null),
  ('average_realised_oil_price', 'Average realised oil price',     'operating',     'currency_per_unit', 'per barrel',       'positive', 'As disclosed, in the currency the issuer states.'),
  ('production_cost_per_boe',    'Production cost',                'operating',     'currency_per_unit', 'per boe',          'positive', 'Lifting or production cost as disclosed.'),
  ('reserves_2p',                '2P reserves',                    'operating',     'quantity',          'MMboe',            'positive', 'As disclosed, on the basis and at the date the issuer states.'),
  ('electricity_generated_mwh',  'Electricity generated',          'operating',     'quantity',          'MWh',              'positive', null),
  ('energy_sold_mwh',            'Energy sold',                    'operating',     'quantity',          'MWh',              'positive', null),
  ('available_capacity_mw',      'Available capacity',             'operating',     'quantity',          'MW',               'positive', null),
  ('plant_availability',         'Plant availability',             'operating',     'percent',           '%',                'positive', 'As disclosed.'),
  ('market_receivables',         'Receivables from the market',    'balance_sheet', 'currency',          'currency',         'positive', 'Amounts due from the settlement system, as presented.'),
  ('operating_costs',            'Operating costs',                'income',        'currency',          'currency',         'negative', null)
on conflict (line_item) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Templates, and the lines each one selects
-- ---------------------------------------------------------------------------

create table if not exists public.statement_templates (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,47}$'),
  name text not null unique check (char_length(btrim(name)) between 2 and 80),
  -- 'core' applies to every company and needs no assignment. 'sector' is
  -- assigned to a company for a period, because a company can be re-sectored
  -- and the years already entered must keep reading under the template they
  -- were entered against.
  scope text not null check (scope in ('core', 'sector')),
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.statement_template_lines (
  template_id text not null references public.statement_templates (id) on delete restrict,
  line_item text not null references public.statement_line_catalogue (line_item) on delete restrict,
  -- Shown in the headline tiles on the company page.
  is_headline boolean not null default false,
  -- A statement missing a required line is a filing read in part, and
  -- record_statement refuses it.
  is_required boolean not null default false,
  sort_order integer not null default 100,
  primary key (template_id, line_item)
);

insert into public.statement_templates (id, name, scope, description, sort_order) values
  ('core',              'Core indicators',       'core',   'Reported by every company in the pilot universe, whatever it sells.', 10),
  ('bank',              'Bank',                  'sector', 'Interest and fee income, loans, deposits and the disclosed prudential ratios.', 20),
  ('telecoms',          'Telecoms',              'sector', 'Service, data and voice revenue, subscribers, ARPU and network spend.', 30),
  ('cement_industrial', 'Cement and industrial', 'sector', 'Volumes in tonnes, capacity, utilisation, realised price and energy cost.', 40),
  ('food_consumer',     'Food and consumer',     'sector', 'Input costs, working capital and distribution.', 50),
  ('oil_gas',           'Oil and gas',           'sector', 'Production, realised price, lifting cost and reserves.', 60),
  ('power_utilities',   'Power and utilities',   'sector', 'Generation, energy sold, availability and settlement receivables.', 70)
on conflict (id) do nothing;

insert into public.statement_template_lines (template_id, line_item, is_headline, is_required, sort_order) values
  ('core', 'revenue',             true,  true,  10),
  ('core', 'cost_of_sales',       false, false, 20),
  ('core', 'gross_profit',        false, false, 30),
  ('core', 'operating_profit',    false, false, 40),
  ('core', 'ebitda',              false, false, 50),
  ('core', 'finance_costs',       false, false, 60),
  ('core', 'profit_before_tax',   false, true,  70),
  ('core', 'income_tax_expense',  false, false, 80),
  ('core', 'profit_after_tax',    true,  true,  90),
  ('core', 'earnings_per_share',  true,  false, 100),
  ('core', 'dividend_per_share',  true,  false, 110),
  ('core', 'total_assets',        false, true,  200),
  ('core', 'total_liabilities',   false, true,  210),
  ('core', 'total_borrowings',    false, false, 220),
  ('core', 'shareholders_equity', false, true,  230),
  ('core', 'operating_cash_flow', false, false, 300),
  ('core', 'capital_expenditure', false, false, 310),
  ('core', 'free_cash_flow',      false, false, 320),
  ('core', 'shares_outstanding',  false, false, 400),

  ('bank', 'interest_income',        false, true,  10),
  ('bank', 'interest_expense',       false, true,  20),
  ('bank', 'net_interest_income',    true,  true,  30),
  ('bank', 'non_interest_income',    false, false, 40),
  ('bank', 'total_operating_income', false, false, 50),
  ('bank', 'loan_loss_impairment',   false, false, 60),
  ('bank', 'gross_loans',            false, false, 200),
  ('bank', 'net_loans_and_advances', true,  true,  210),
  ('bank', 'non_performing_loans',   false, false, 220),
  ('bank', 'customer_deposits',      true,  true,  230),
  ('bank', 'npl_ratio',              true,  false, 400),
  ('bank', 'capital_adequacy_ratio', true,  false, 410),
  ('bank', 'liquidity_ratio',        false, false, 420),
  ('bank', 'cost_to_income_ratio',   false, false, 430),
  ('bank', 'net_interest_margin',    false, false, 440),

  ('telecoms', 'service_revenue',         true,  true,  10),
  ('telecoms', 'data_revenue',            true,  false, 20),
  ('telecoms', 'voice_revenue',           false, false, 30),
  ('telecoms', 'fintech_revenue',         false, false, 40),
  ('telecoms', 'net_debt',                false, false, 200),
  ('telecoms', 'ebitda_margin',           false, false, 400),
  ('telecoms', 'total_subscribers',       true,  false, 410),
  ('telecoms', 'active_data_subscribers', false, false, 420),
  ('telecoms', 'arpu',                    true,  false, 430),
  ('telecoms', 'data_traffic',            false, false, 440),

  ('cement_industrial', 'energy_and_fuel_costs',      false, false, 10),
  ('cement_industrial', 'net_debt',                   false, false, 200),
  ('cement_industrial', 'sales_volume_tonnes',        true,  false, 400),
  ('cement_industrial', 'production_capacity_tonnes', false, false, 410),
  ('cement_industrial', 'capacity_utilisation',       false, false, 420),
  ('cement_industrial', 'average_price_per_tonne',    true,  false, 430),

  ('food_consumer', 'raw_material_costs', false, false, 10),
  ('food_consumer', 'distribution_costs', false, false, 20),
  ('food_consumer', 'inventory',          false, false, 200),
  ('food_consumer', 'trade_receivables',  false, false, 210),
  ('food_consumer', 'trade_payables',     false, false, 220),
  ('food_consumer', 'production_volume',  false, false, 400),

  ('oil_gas', 'net_debt',                   false, false, 200),
  ('oil_gas', 'production_boe_per_day',     true,  false, 400),
  ('oil_gas', 'oil_production_bopd',        false, false, 410),
  ('oil_gas', 'gas_production_mmscfd',      false, false, 420),
  ('oil_gas', 'average_realised_oil_price', true,  false, 430),
  ('oil_gas', 'production_cost_per_boe',    false, false, 440),
  ('oil_gas', 'reserves_2p',                false, false, 450),

  ('power_utilities', 'operating_costs',           false, false, 10),
  ('power_utilities', 'market_receivables',        false, false, 200),
  ('power_utilities', 'electricity_generated_mwh', true,  false, 400),
  ('power_utilities', 'energy_sold_mwh',           true,  false, 410),
  ('power_utilities', 'available_capacity_mw',     false, false, 420),
  ('power_utilities', 'plant_availability',        false, false, 430),
  ('power_utilities', 'capacity_utilisation',      false, false, 440)
on conflict (template_id, line_item) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Which sector template a company is entered under
-- ---------------------------------------------------------------------------

create table if not exists public.company_statement_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  template_id text not null references public.statement_templates (id) on delete restrict,
  valid_from date not null,
  valid_to date,
  note text check (note is null or (char_length(btrim(note)) between 2 and 500 and note !~ '[[:cntrl:]]')),
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  unique (company_id, template_id, valid_from)
);

-- One current sector template per company. A second would make "which template
-- is this company entered under" unanswerable, and the desk would have to pick.
create unique index if not exists company_statement_templates_current_uidx
  on public.company_statement_templates (company_id) where valid_to is null;

create index if not exists company_statement_templates_company_idx
  on public.company_statement_templates (company_id, valid_from desc);

-- ---------------------------------------------------------------------------
-- 5. Succession: the history that belongs to a different entity
-- ---------------------------------------------------------------------------

-- Access Holdings was established in 2022; the figures before it belong to
-- Access Bank. BUA Foods listed in 2022 and Aradel in 2024, each with audited
-- history under its earlier self. Splicing those into one series would publish a
-- continuity that does not exist, so the predecessor is its own company row —
-- marked delisted or unlisted, never pre_listing, which would say it is waiting
-- to list when in fact it is gone — and this table records the join.
create table if not exists public.company_successions (
  id uuid primary key default gen_random_uuid(),
  predecessor_company_id uuid not null references public.companies (id) on delete restrict,
  successor_company_id uuid not null references public.companies (id) on delete restrict,
  relationship text not null check (relationship in ('holdco_reorganisation', 'merger', 'acquisition', 'renaming', 'listing_of_existing_business')),
  effective_on date not null,
  -- The same discipline as a tenure date: a filing that says "2022" must not be
  -- stored as a day in January.
  effective_precision text not null check (effective_precision in ('day', 'month', 'year')),
  note text check (note is null or (char_length(btrim(note)) between 2 and 500 and note !~ '[[:cntrl:]]')),
  document_id uuid references public.documents (id),
  source_page integer check (source_page is null or source_page > 0),
  announcement_id uuid references public.announcements (id),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_self_approved boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Exactly one source, the constraint editorial_citations uses: a citation
  -- pointing at two things supports neither.
  check ((document_id is not null)::integer + (announcement_id is not null)::integer = 1),
  check (announcement_id is null or source_page is null),
  check (document_id is null or source_page is not null),
  check (predecessor_company_id <> successor_company_id),
  unique (predecessor_company_id, successor_company_id, effective_on)
);

create index if not exists company_successions_successor_idx
  on public.company_successions (successor_company_id);
create index if not exists company_successions_predecessor_idx
  on public.company_successions (predecessor_company_id);

-- ---------------------------------------------------------------------------
-- 6. What a statement and a figure now carry
-- ---------------------------------------------------------------------------

-- Operating metrics are reported disclosures, so they live on the same table as
-- the three statements: the provenance, review, immutability and supersede
-- machinery is already correct there, and a separate table would duplicate all
-- of it for figures that come off the same page of the same filing.
alter table public.financial_statements drop constraint if exists financial_statements_statement_type_check;
alter table public.financial_statements add constraint financial_statements_statement_type_check
  check (statement_type in ('income', 'balance_sheet', 'cash_flow', 'operating'));

alter table public.financial_statements add column if not exists template_id text references public.statement_templates (id);
alter table public.financial_statements add column if not exists entered_by uuid references auth.users (id) on delete set null;
alter table public.financial_statements add column if not exists review_self_approved boolean not null default false;
alter table public.financial_statements add column if not exists ai_assisted boolean not null default false;
alter table public.financial_statements add column if not exists restatement_kind text;

alter table public.financial_statements drop constraint if exists financial_statements_restatement_kind_check;
alter table public.financial_statements add constraint financial_statements_restatement_kind_check
  check (restatement_kind is null or restatement_kind in ('original', 'issuer_restated', 'sfi_correction'));

-- Version 1 is the original reading of the filing. Anything after it is either
-- the issuer restating its own figures or this desk correcting its own error,
-- and the reader is entitled to know which.
alter table public.financial_statements drop constraint if exists financial_statements_version_kind_check;
alter table public.financial_statements add constraint financial_statements_version_kind_check
  check (
    restatement_kind is null
    or (version = 1 and restatement_kind = 'original')
    or (version > 1 and restatement_kind in ('issuer_restated', 'sfi_correction'))
  );

create index if not exists financial_statements_coverage_idx
  on public.financial_statements (company_id, period_end desc, statement_type);

-- The reported figure and the standardised figure.
--
-- The foundation's `value` column was the only figure; it becomes
-- value_standardised, which is what it always meant — absolute units, consistent
-- sign — and value_reported is added beside it. Renamed rather than joined by a
-- third column, because `value` and `value_standardised` side by side would
-- leave every later reader guessing which one to trust.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'financial_statement_lines'
       and column_name = 'value'
  ) then
    alter table public.financial_statement_lines rename column value to value_standardised;
  end if;
end;
$$;

alter table public.financial_statement_lines add column if not exists value_reported numeric;
alter table public.financial_statement_lines add column if not exists reported_magnitude text;
alter table public.financial_statement_lines add column if not exists reported_presentation text;
alter table public.financial_statement_lines add column if not exists as_restated boolean not null default false;
alter table public.financial_statement_lines add column if not exists ai_assisted boolean not null default false;
alter table public.financial_statement_lines add column if not exists note text;

alter table public.financial_statement_lines drop constraint if exists financial_statement_lines_magnitude_check;
alter table public.financial_statement_lines add constraint financial_statement_lines_magnitude_check
  check (reported_magnitude is null or reported_magnitude in ('units', 'thousands', 'millions', 'billions'));

-- How the figure appeared on the page. 'bracketed' is not decoration: it is the
-- only way most filings say "negative" on a cost line, and recording it is how a
-- reviewer tells a sign error from a transcription error.
alter table public.financial_statement_lines drop constraint if exists financial_statement_lines_presentation_check;
alter table public.financial_statement_lines add constraint financial_statement_lines_presentation_check
  check (reported_presentation is null or reported_presentation in ('plain', 'bracketed', 'negative'));

alter table public.financial_statement_lines drop constraint if exists financial_statement_lines_note_check;
alter table public.financial_statement_lines add constraint financial_statement_lines_note_check
  check (note is null or (char_length(btrim(note)) between 2 and 500 and note !~ '[[:cntrl:]]'));

-- ---------------------------------------------------------------------------
-- 7. Guards
-- ---------------------------------------------------------------------------

-- review_self_approved is written at the moment of review, like reviewed_by and
-- reviewed_at, so guard_versioned_row has to let it through. No other table the
-- guard protects has that column, so nothing else loosens.
create or replace function public.guard_versioned_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  review_cols text[] := array['review_status', 'reviewed_by', 'reviewed_at', 'review_self_approved'];
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

-- The cited source must be one a reader could actually check. The same test
-- guard_company_role_sources applies, for the same reason: an unapproved
-- document, or one whose licence is unverified, is not evidence a reader can
-- follow, and offering it in the picker hands the analyst a source the database
-- then refuses as a bare constraint violation.
create or replace function public.guard_company_succession_sources()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  doc_status text;
  doc_licence text;
  ann_status text;
begin
  if new.document_id is not null then
    select review_status, licence_class into doc_status, doc_licence
      from public.documents where id = new.document_id;
    if doc_status is null then
      raise exception 'No such document: %', new.document_id using errcode = '23503';
    end if;
    if doc_status <> 'approved' then
      raise exception 'A succession must cite an approved document' using errcode = '23514';
    end if;
    if doc_licence = 'unverified' then
      raise exception 'A succession cannot cite a document whose licence is unverified' using errcode = '23514';
    end if;
  end if;

  if new.announcement_id is not null then
    select review_status into ann_status from public.announcements where id = new.announcement_id;
    if ann_status is null then
      raise exception 'No such announcement: %', new.announcement_id using errcode = '23503';
    end if;
    if ann_status <> 'published' then
      raise exception 'A succession must cite a published announcement' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists company_successions_source_guard on public.company_successions;
create trigger company_successions_source_guard before insert or update on public.company_successions
for each row execute function public.guard_company_succession_sources();

-- A succession claim is fixed once recorded: only the review fields move, and a
-- wrong one is rejected and recorded again rather than edited into shape.
create or replace function public.guard_company_succession_row()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  review_cols text[] := array['review_status', 'reviewed_at', 'review_self_approved', 'reviewed_by'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Successions are not deleted; reject the record and record the correct one'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - review_cols) is distinct from (to_jsonb(old) - review_cols)
     or (
       new.reviewed_by is distinct from old.reviewed_by
       and new.review_status is not distinct from old.review_status
       and not (
         new.reviewed_by is null
         and not exists (select 1 from auth.users where id = old.reviewed_by)
       )
     ) then
    raise exception 'A succession claim is fixed once recorded; reject it and record the correct one'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists company_successions_guard on public.company_successions;
create trigger company_successions_guard before update or delete on public.company_successions
for each row execute function public.guard_company_succession_row();

drop trigger if exists statement_templates_set_updated_at on public.statement_templates;
create trigger statement_templates_set_updated_at before update on public.statement_templates
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Who may enter figures
-- ---------------------------------------------------------------------------

-- Platform admins, and the financial_analyst role. 'analyst' is deliberately
-- absent: that role runs the company and leadership registers, and entering a
-- balance sheet is a different job. One place to change if that is ever revised.
create or replace function public.may_enter_figures(actor_user uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.platform_admins where user_id = actor_user)
      or exists (
        select 1 from public.platform_staff
         where user_id = actor_user and role = 'financial_analyst'
      );
$$;

-- ---------------------------------------------------------------------------
-- 9. Recording a statement
-- ---------------------------------------------------------------------------

-- One call, one statement, one transaction. A period is entered whole or not at
-- all: a half-entered balance sheet that a reviewer then approves is a published
-- figure set nobody read in full, and the only way to make that impossible is to
-- refuse to let it exist.
--
-- p_lines is a JSON array, one object per figure:
--   { "line_item": "revenue", "value_reported": 1234.5,
--     "presentation": "plain" | "bracketed" | "negative",
--     "magnitude": "thousands" | null, "source_page": 42,
--     "as_restated": false, "ai_assisted": false, "note": null }
--
-- The standardised figure is computed here rather than taken from the caller,
-- because a value the client calculated is a value the client could get wrong,
-- and the two columns would then disagree with nothing to say which was true.
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

  -- The source record is the document's own provenance row, written when it was
  -- uploaded. Derived here rather than accepted as an argument, so a statement
  -- cannot cite one document and carry the provenance of another.
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

  -- Read before the insert rather than updated after it. The statement row is
  -- immutable the moment it exists — guard_versioned_row permits only the review
  -- columns to move — so a figure's AI-assisted flag has to be known by then.
  select coalesce(bool_or(coalesce((e ->> 'ai_assisted')::boolean, false)), false)
    into any_ai
    from jsonb_array_elements(p_lines) e;

  -- Which sector template this company is entered under for this period. Core
  -- lines need no assignment; a sector line without one is refused, because
  -- guessing the template is how a bank figure lands on a cement company.
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

    -- The line must be one this company is actually entered under: a core line,
    -- or a line of its assigned sector template.
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

    if jsonb_typeof(entry -> 'value_reported') = 'number' then
      reported := (entry ->> 'value_reported')::numeric;
    else
      raise exception 'The figure % needs a reported value', item using errcode = '23514';
    end if;

    if jsonb_typeof(entry -> 'source_page') = 'number' then
      page := (entry ->> 'source_page')::numeric::integer;
    else
      page := null;
    end if;
    if page is null or page <= 0 then
      raise exception 'The figure % needs the page of the filing it appears on', item using errcode = '23514';
    end if;

    presentation := coalesce(nullif(btrim(coalesce(entry ->> 'presentation', '')), ''), 'plain');
    if presentation not in ('plain', 'bracketed', 'negative') then
      raise exception 'The figure % was presented plain, bracketed or negative', item using errcode = '23514';
    end if;

    -- A magnitude belongs to money. A share count, a percentage and an EPS are
    -- printed in their own units, and inheriting ₦'000 would multiply them by a
    -- thousand — the error this separation exists to prevent.
    if catalogue.unit_kind in ('currency', 'currency_per_unit') then
      magnitude := coalesce(
        nullif(btrim(coalesce(entry ->> 'magnitude', '')), ''),
        nullif(btrim(coalesce(p_magnitude, '')), ''),
        'thousands'
      );
    else
      magnitude := coalesce(nullif(btrim(coalesce(entry ->> 'magnitude', '')), ''), 'units');
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

    -- Brackets mean negative. An analyst who typed -1200 for a bracketed figure
    -- meant the same thing, so both arrive at the same value rather than
    -- cancelling back to positive.
    signed_value := case
      when presentation in ('bracketed', 'negative') then -abs(reported)
      else reported
    end;

    -- The sign convention the filings do not have.
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

  -- A required line missing is a filing read in part. The templates decide which
  -- lines those are, so adding one tightens every statement entered afterwards
  -- without a migration.
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

-- ---------------------------------------------------------------------------
-- 10. Reviewing a statement
-- ---------------------------------------------------------------------------

create or replace function public.review_statement(
  target_statement uuid,
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
  statement public.financial_statements%rowtype;
  self_flag boolean := false;
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not review financial figures' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'A review decision is approved or rejected' using errcode = '23514';
  end if;

  select * into statement from public.financial_statements where id = target_statement for update;
  if statement.id is null then
    raise exception 'No such statement: %', target_statement using errcode = '23503';
  end if;
  if statement.review_status <> 'pending' then
    raise exception 'That statement has already been %', statement.review_status using errcode = '23514';
  end if;

  if p_decision = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the figures are being rejected' using errcode = '23514';
  end if;

  -- Unknown authorship counts as self-reviewed: if the entering account has been
  -- deleted the foreign key has nulled it, and reading "someone independent
  -- checked this" out of that null asserts a second pair of eyes nobody can show.
  self_flag := statement.entered_by is null or statement.entered_by = actor_user;

  if self_flag and public.setting_bool('review.require_two_person', false) then
    raise exception 'Someone other than the person who entered these figures must check them'
      using errcode = '42501';
  end if;

  update public.financial_statements
     set review_status = p_decision,
         reviewed_by = actor_user,
         reviewed_at = now(),
         review_self_approved = self_flag
   where id = target_statement;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'statement.' || p_decision,
    jsonb_build_object(
      'statement_id', target_statement,
      'company_id', statement.company_id,
      'period_end', statement.period_end,
      'version', statement.version,
      'self_approved', self_flag,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Catalogue, templates and assignment
-- ---------------------------------------------------------------------------

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
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not change the figure catalogue' using errcode = '42501';
  end if;
  if clean_item is null then
    raise exception 'A catalogue line needs a code' using errcode = '23514';
  end if;

  select * into existing from public.statement_line_catalogue c where c.line_item = clean_item;

  -- The unit and the sign convention are fixed once figures have been entered
  -- against them: every stored standardised value was computed from those two,
  -- so changing either silently reinterprets history.
  if existing.line_item is not null
     and (existing.unit_kind <> p_unit_kind or existing.standard_sign <> p_standard_sign)
     and exists (select 1 from public.financial_statement_lines l where l.line_item = clean_item) then
    raise exception 'Figures have already been entered as %; its unit and sign are fixed. Add a new line instead',
      clean_item using errcode = '42501';
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

  insert into public.audit_logs (actor_user_id, action, details)
  values (actor_user, 'statement_line.catalogued', jsonb_build_object('line_item', clean_item));

  return clean_item;
end;
$$;

create or replace function public.set_template_line(
  actor_user uuid,
  p_template_id text,
  p_line_item text,
  p_is_headline boolean default false,
  p_is_required boolean default false,
  p_sort_order integer default 100,
  p_remove boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not change templates' using errcode = '42501';
  end if;

  if not exists (select 1 from public.statement_templates where id = p_template_id) then
    raise exception 'No such template: %', p_template_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.statement_line_catalogue c where c.line_item = p_line_item) then
    raise exception 'No such catalogue line: %', p_line_item using errcode = '23503';
  end if;

  if p_remove then
    delete from public.statement_template_lines tl
     where tl.template_id = p_template_id and tl.line_item = p_line_item;
    insert into public.audit_logs (actor_user_id, action, details)
    values (actor_user, 'template_line.removed',
            jsonb_build_object('template_id', p_template_id, 'line_item', p_line_item));
    return;
  end if;

  insert into public.statement_template_lines (template_id, line_item, is_headline, is_required, sort_order)
  values (p_template_id, p_line_item, coalesce(p_is_headline, false),
          coalesce(p_is_required, false), coalesce(p_sort_order, 100))
  on conflict (template_id, line_item) do update
     set is_headline = excluded.is_headline,
         is_required = excluded.is_required,
         sort_order = excluded.sort_order;

  insert into public.audit_logs (actor_user_id, action, details)
  values (actor_user, 'template_line.set',
          jsonb_build_object('template_id', p_template_id, 'line_item', p_line_item,
                             'required', coalesce(p_is_required, false)));
end;
$$;

create or replace function public.assign_company_template(
  actor_user uuid,
  p_company_id uuid,
  p_template_id text,
  p_valid_from date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  template public.statement_templates%rowtype;
  current_row public.company_statement_templates%rowtype;
  new_row uuid;
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not assign templates' using errcode = '42501';
  end if;

  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'No such company: %', p_company_id using errcode = '23503';
  end if;

  select * into template from public.statement_templates where id = p_template_id;
  if template.id is null then
    raise exception 'No such template: %', p_template_id using errcode = '23503';
  end if;
  if template.scope <> 'sector' then
    raise exception 'The core template applies to every company and is not assigned' using errcode = '23514';
  end if;
  if not template.is_active then
    raise exception 'That template is no longer in use' using errcode = '23514';
  end if;
  if p_valid_from is null then
    raise exception 'Say from when this company is entered under that template' using errcode = '23514';
  end if;

  select * into current_row from public.company_statement_templates
   where company_id = p_company_id and valid_to is null
   for update;

  if current_row.id is not null then
    if current_row.template_id = p_template_id then
      raise exception 'That company is already entered under %', p_template_id using errcode = '23514';
    end if;
    if p_valid_from <= current_row.valid_from then
      raise exception 'A new template starts after the one it replaces (from %)', current_row.valid_from
        using errcode = '23514';
    end if;
    -- Closed rather than edited: the years already entered keep reading under
    -- the template they were entered against.
    update public.company_statement_templates
       set valid_to = p_valid_from
     where id = current_row.id;
  end if;

  insert into public.company_statement_templates (company_id, template_id, valid_from, note, assigned_by)
  values (p_company_id, p_template_id, p_valid_from, nullif(btrim(coalesce(p_note, '')), ''), actor_user)
  returning id into new_row;

  insert into public.audit_logs (actor_user_id, action, details)
  values (actor_user, 'company_template.assigned',
          jsonb_build_object('company_id', p_company_id, 'template_id', p_template_id,
                             'valid_from', p_valid_from, 'replaced', current_row.template_id));

  return new_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Succession
-- ---------------------------------------------------------------------------

create or replace function public.record_company_succession(
  actor_user uuid,
  p_predecessor_company_id uuid,
  p_successor_company_id uuid,
  p_relationship text,
  p_effective_on date,
  p_effective_precision text,
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
  predecessor public.companies%rowtype;
begin
  -- A succession is a fact about corporate identity rather than a figure, so the
  -- register's own role may record it as well as the figures desk.
  if not public.may_enter_figures(actor_user)
     and not exists (
       select 1 from public.platform_staff
        where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not record a succession' using errcode = '42501';
  end if;

  select * into predecessor from public.companies where id = p_predecessor_company_id;
  if predecessor.id is null then
    raise exception 'No such predecessor company: %', p_predecessor_company_id using errcode = '23503';
  end if;
  if not exists (select 1 from public.companies where id = p_successor_company_id) then
    raise exception 'No such successor company: %', p_successor_company_id using errcode = '23503';
  end if;

  -- A predecessor is a former entity. 'pre_listing' says the opposite — a
  -- company waiting to list — and letting it stand here would publish Access
  -- Bank as a forthcoming IPO.
  if predecessor.listing_status = 'pre_listing' then
    raise exception 'A predecessor is a former entity, not one awaiting listing; set its status to delisted or unlisted first'
      using errcode = '23514';
  end if;

  if p_effective_on is null then
    raise exception 'Say when the succession took effect' using errcode = '23514';
  end if;

  insert into public.company_successions (
    predecessor_company_id, successor_company_id, relationship,
    effective_on, effective_precision, note,
    document_id, source_page, announcement_id, created_by
  )
  values (
    p_predecessor_company_id, p_successor_company_id, p_relationship,
    p_effective_on, p_effective_precision, nullif(btrim(coalesce(p_note, '')), ''),
    p_document_id, p_source_page, p_announcement_id, actor_user
  )
  returning id into new_row;

  insert into public.audit_logs (actor_user_id, action, details)
  values (actor_user, 'company_succession.recorded',
          jsonb_build_object('succession_id', new_row,
                             'predecessor', p_predecessor_company_id,
                             'successor', p_successor_company_id,
                             'relationship', p_relationship));

  return new_row;
end;
$$;

create or replace function public.review_company_succession(
  target_succession uuid,
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
  succession public.company_successions%rowtype;
  self_flag boolean := false;
begin
  if not public.may_enter_figures(actor_user)
     and not exists (
       select 1 from public.platform_staff
        where user_id = actor_user and role = 'analyst'
     ) then
    raise exception 'Actor may not review a succession' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'A review decision is approved or rejected' using errcode = '23514';
  end if;

  select * into succession from public.company_successions where id = target_succession for update;
  if succession.id is null then
    raise exception 'No such succession: %', target_succession using errcode = '23503';
  end if;
  if succession.review_status <> 'pending' then
    raise exception 'That succession has already been %', succession.review_status using errcode = '23514';
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the succession is being rejected' using errcode = '23514';
  end if;

  self_flag := succession.created_by is null or succession.created_by = actor_user;

  if self_flag and public.setting_bool('review.require_two_person', false) then
    raise exception 'Someone other than the person who recorded this must review it' using errcode = '42501';
  end if;

  update public.company_successions
     set review_status = p_decision,
         reviewed_by = actor_user,
         reviewed_at = now(),
         review_self_approved = self_flag
   where id = target_succession;

  insert into public.audit_logs (actor_user_id, action, details)
  values (actor_user, 'company_succession.' || p_decision,
          jsonb_build_object('succession_id', target_succession,
                             'self_approved', self_flag,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Access
-- ---------------------------------------------------------------------------

revoke all on function public.may_enter_figures(uuid) from public, anon;
revoke all on function public.guard_company_succession_sources() from public, anon, authenticated;
revoke all on function public.guard_company_succession_row() from public, anon, authenticated;
revoke all on function public.record_statement(
  uuid, uuid, text, text, date, date, boolean, boolean, text, text, uuid, jsonb, timestamptz, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.review_statement(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.upsert_statement_line(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.set_template_line(uuid, text, text, boolean, boolean, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.assign_company_template(uuid, uuid, text, date, text)
  from public, anon, authenticated;
revoke all on function public.record_company_succession(uuid, uuid, uuid, text, date, text, uuid, integer, uuid, text)
  from public, anon, authenticated;
revoke all on function public.review_company_succession(uuid, uuid, text, text) from public, anon, authenticated;

-- Granted back explicitly. Revoking from PUBLIC removes the implicit grant the
-- server's own role otherwise relies on, and without these every call fails with
-- 42501 while the local suite stays green: it runs as the migration owner and
-- only ever switches to `authenticated`.
grant execute on function public.record_statement(
  uuid, uuid, text, text, date, date, boolean, boolean, text, text, uuid, jsonb, timestamptz, uuid, text, text
) to service_role;
grant execute on function public.review_statement(uuid, uuid, text, text) to service_role;
grant execute on function public.upsert_statement_line(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.set_template_line(uuid, text, text, boolean, boolean, integer, boolean) to service_role;
grant execute on function public.assign_company_template(uuid, uuid, text, date, text) to service_role;
grant execute on function public.record_company_succession(uuid, uuid, uuid, text, date, text, uuid, integer, uuid, text) to service_role;
grant execute on function public.review_company_succession(uuid, uuid, text, text) to service_role;

-- may_enter_figures is called by server code to decide what the desk offers, and
-- by no policy, so `authenticated` has no reason to hold it.
grant execute on function public.may_enter_figures(uuid) to service_role;

alter table public.statement_line_catalogue enable row level security;
alter table public.statement_templates enable row level security;
alter table public.statement_template_lines enable row level security;
alter table public.company_statement_templates enable row level security;
alter table public.company_successions enable row level security;

revoke all on
  public.statement_line_catalogue, public.statement_templates, public.statement_template_lines,
  public.company_statement_templates, public.company_successions
from anon, authenticated;

grant select on
  public.statement_line_catalogue, public.statement_templates, public.statement_template_lines,
  public.company_statement_templates, public.company_successions
to authenticated;

grant all on
  public.statement_line_catalogue, public.statement_templates, public.statement_template_lines,
  public.company_statement_templates, public.company_successions
to service_role;

-- The catalogue and the templates are reference data, like sectors: a reader is
-- entitled to know what SFI means by "net interest income" and which figures a
-- bank is held to.
drop policy if exists "Signed-in users can view the figure catalogue" on public.statement_line_catalogue;
create policy "Signed-in users can view the figure catalogue" on public.statement_line_catalogue
for select to authenticated using (true);

drop policy if exists "Signed-in users can view templates" on public.statement_templates;
create policy "Signed-in users can view templates" on public.statement_templates
for select to authenticated using (true);

drop policy if exists "Signed-in users can view template lines" on public.statement_template_lines;
create policy "Signed-in users can view template lines" on public.statement_template_lines
for select to authenticated using (true);

-- An assignment names a company, so it is visible on the same terms the company
-- is. Otherwise the template list would disclose that a company nobody has
-- approved exists, and which sector it trades in.
create or replace function public.company_is_approved(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.companies where id = target and review_status = 'approved');
$$;

revoke all on function public.company_is_approved(uuid) from public, anon;
grant execute on function public.company_is_approved(uuid) to authenticated, service_role;

drop policy if exists "Readers see template assignments of approved companies" on public.company_statement_templates;
create policy "Readers see template assignments of approved companies" on public.company_statement_templates
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['financial_analyst', 'analyst'])
  or public.company_is_approved(company_id)
);

-- A succession is published only when the claim is approved and both companies
-- are: naming a predecessor nobody has reviewed would publish a company through
-- the back door.
create or replace function public.company_succession_is_published(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.company_successions s
      join public.companies p on p.id = s.predecessor_company_id
      join public.companies c on c.id = s.successor_company_id
     where s.id = target
       and s.review_status = 'approved'
       and p.review_status = 'approved'
       and c.review_status = 'approved'
  );
$$;

revoke all on function public.company_succession_is_published(uuid) from public, anon;
grant execute on function public.company_succession_is_published(uuid) to authenticated, service_role;

drop policy if exists "Readers see approved successions" on public.company_successions;
create policy "Readers see approved successions" on public.company_successions
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['financial_analyst', 'analyst'])
  or public.company_succession_is_published(id)
);

-- ---------------------------------------------------------------------------
-- 14. The statement policies, rewritten
-- ---------------------------------------------------------------------------

-- Two faults in the foundation's policies, both of the kind stage 3b taught.
--
-- The statements policy tested the statement and the licence but never the
-- company, so a figure set belonging to a company nobody had reviewed was
-- readable by any signed-in user. The company page would not show it; the table
-- would hand it over.
--
-- The lines policy ran an inline `exists (... financial_statements ...)`, which
-- evaluates under the statements policy. That is the mutual recursion (42P17)
-- 202611210007 closed for people, waiting for the first policy that consults
-- lines from statements. Both lookups now sit inside a definer function, where
-- no policy is consulted at all, and the predicate returns exactly what the
-- policy returns, so calling it discloses nothing a SELECT would not.
create or replace function public.statement_is_published(target uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.financial_statements s
      join public.companies c on c.id = s.company_id
     where s.id = target
       and s.review_status = 'approved'
       and c.review_status = 'approved'
       and public.is_displayable_source(s.source_record_id)
  );
$$;

revoke all on function public.statement_is_published(uuid) from public, anon;
grant execute on function public.statement_is_published(uuid) to authenticated, service_role;

drop policy if exists "Users can view approved statements" on public.financial_statements;
create policy "Users can view approved statements" on public.financial_statements
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['financial_analyst'])
  or public.statement_is_published(id)
);

drop policy if exists "Users can view lines of approved statements" on public.financial_statement_lines;
create policy "Users can view lines of approved statements" on public.financial_statement_lines
for select to authenticated using (
  public.is_platform_admin()
  or public.has_staff_role(array['financial_analyst'])
  or public.statement_is_published(statement_id)
);
