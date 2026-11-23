-- Samuel Terminal — a queue for suggested figures, which is not a path into the register.
--
-- Extraction software reads a filing and proposes figures. This is where those
-- proposals live, and the point of the design is what it refuses to do.
--
-- A suggestion is never a figure
-- ------------------------------
-- Nothing here writes to financial_statement_lines. A suggestion is a row in its
-- own table with its own status, and the only way a number reaches the register
-- is an analyst confirming it through record_statement. "Approval is a human
-- act" is a binding rule, and a model that could write an approved row — or a
-- pending one a tired reviewer waves through in bulk — would make it a slogan.
--
-- One at a time, and no accept-all
-- --------------------------------
-- decide_figure_suggestion takes exactly one suggestion. There is no batch
-- accept, in the function or on the desk, because a single button that accepts
-- forty unexamined figures is the whole risk of this feature in one control. The
-- cost of that decision is real: forty figures is forty decisions. That is the
-- point.
--
-- The model is recorded, and the model is absent
-- ----------------------------------------------
-- Every batch carries the provider, the model and the prompt version, so a
-- figure that turns out wrong can be traced to what produced it. No model is
-- wired up: the extractor sits behind an adapter whose only implementation reads
-- text a person pasted. Wiring a real one is a provider decision with a cost and
-- a licence, and the queue is useful without it — the discipline is the valuable
-- part, not the extraction.
--
-- Anything that passes through here stays labelled. ai_assisted travels on the
-- statement line for the life of the figure, which 3c.1 already settled.

-- ---------------------------------------------------------------------------
-- 1. A batch: one filing, one period, one run of one extractor
-- ---------------------------------------------------------------------------

create table if not exists public.figure_suggestion_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  document_id uuid not null references public.documents (id) on delete restrict,
  statement_type text not null check (statement_type in ('income', 'balance_sheet', 'cash_flow', 'operating')),
  period_type text not null check (period_type in ('FY', 'H1', 'Q1', 'Q2', 'Q3', 'Q4', '9M')),
  period_start date not null,
  period_end date not null,
  currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  magnitude text not null default 'thousands' check (magnitude in ('units', 'thousands', 'millions', 'billions')),
  -- Which adapter produced this, and what it was running. 'manual_paste' is the
  -- only implementation today and is recorded as honestly as a model would be:
  -- a person pasted text, and the register should say so.
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,47}$'),
  model text check (model is null or char_length(btrim(model)) between 1 and 120),
  prompt_version text check (prompt_version is null or char_length(btrim(prompt_version)) between 1 and 60),
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Set when the batch's accepted figures have been recorded as a statement, so
  -- an AI-assisted statement can be traced back to what proposed them.
  statement_id uuid references public.financial_statements (id),
  note text check (note is null or (char_length(btrim(note)) between 2 and 500 and note !~ '[[:cntrl:]]')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (period_end > period_start),
  check ((status = 'closed') = (closed_at is not null))
);

create index if not exists figure_suggestion_batches_open_idx
  on public.figure_suggestion_batches (company_id, period_end desc) where status = 'open';

-- ---------------------------------------------------------------------------
-- 2. A suggestion: one proposed figure, with what the extractor actually read
-- ---------------------------------------------------------------------------

create table if not exists public.figure_suggestions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.figure_suggestion_batches (id) on delete cascade,
  line_item text not null references public.statement_line_catalogue (line_item) on delete restrict,
  -- The figure as the extractor read it, in the same shape record_statement
  -- takes: the printed value, how it was presented, its scale and its page.
  value_reported numeric not null,
  presentation text not null default 'plain' check (presentation in ('plain', 'bracketed', 'negative')),
  magnitude text check (magnitude is null or magnitude in ('units', 'thousands', 'millions', 'billions')),
  source_page integer not null check (source_page > 0),
  -- What the extractor saw on the page, kept verbatim. A suggestion a reviewer
  -- cannot compare with the page is a number to take on trust, which is the
  -- opposite of the point.
  raw_label text check (raw_label is null or (char_length(raw_label) between 1 and 300 and raw_label !~ '[[:cntrl:]]')),
  raw_value text check (raw_value is null or (char_length(raw_value) between 1 and 60 and raw_value !~ '[[:cntrl:]]')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_reason text check (decision_reason is null or (char_length(btrim(decision_reason)) between 2 and 500 and decision_reason !~ '[[:cntrl:]]')),
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  -- One proposal per figure per batch. Two extractors disagreeing about revenue
  -- is a second batch, not two rows a reviewer reconciles in their head.
  unique (batch_id, line_item)
);

create index if not exists figure_suggestions_queue_idx
  on public.figure_suggestions (batch_id, status);

-- ---------------------------------------------------------------------------
-- 3. Guards
-- ---------------------------------------------------------------------------

-- A suggestion's figure is fixed once proposed: only the decision moves. An
-- editable suggestion is a figure that can change after a reviewer has read it
-- and before it is accepted, which would make the review meaningless.
create or replace function public.guard_figure_suggestion()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  decision_cols text[] := array['status', 'decided_by', 'decided_at', 'decision_reason'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Suggestions are not deleted; reject them, so the register shows what was proposed'
      using errcode = '42501';
  end if;

  if (to_jsonb(new) - decision_cols) is distinct from (to_jsonb(old) - decision_cols) then
    raise exception 'A suggested figure is fixed once proposed; only its decision changes'
      using errcode = '42501';
  end if;

  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'That suggestion has already been %', old.status using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists figure_suggestions_guard on public.figure_suggestions;
create trigger figure_suggestions_guard before update or delete on public.figure_suggestions
for each row execute function public.guard_figure_suggestion();

create or replace function public.guard_figure_suggestion_batch()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  closing_cols text[] := array['status', 'statement_id', 'closed_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Suggestion batches are not deleted' using errcode = '42501';
  end if;

  if (to_jsonb(new) - closing_cols) is distinct from (to_jsonb(old) - closing_cols) then
    raise exception 'A batch describes one run of one extractor and does not change'
      using errcode = '42501';
  end if;

  if old.status = 'closed' and new.status is distinct from old.status then
    raise exception 'That batch is already closed' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists figure_suggestion_batches_guard on public.figure_suggestion_batches;
create trigger figure_suggestion_batches_guard before update or delete on public.figure_suggestion_batches
for each row execute function public.guard_figure_suggestion_batch();

-- ---------------------------------------------------------------------------
-- 4. Recording a run
-- ---------------------------------------------------------------------------

-- p_suggestions is a JSON array, one object per proposed figure:
--   { "line_item": "revenue", "value_reported": 1234.5, "presentation": "plain",
--     "magnitude": "thousands", "source_page": 40, "raw_label": "Revenue",
--     "raw_value": "1,234.5", "confidence": 0.82 }
--
-- Every proposal is validated the way an entered figure is — the line must be in
-- the catalogue and belong to this statement — so a batch cannot queue a figure
-- record_statement would later refuse. A queue full of unusable proposals is
-- worse than an empty one.
create or replace function public.record_figure_suggestions(
  actor_user uuid,
  p_company_id uuid,
  p_document_id uuid,
  p_statement_type text,
  p_period_type text,
  p_period_start date,
  p_period_end date,
  p_currency text,
  p_magnitude text,
  p_provider text,
  p_suggestions jsonb,
  p_model text default null,
  p_prompt_version text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_batch uuid;
  doc_status text;
  doc_licence text;
  entry jsonb;
  catalogue public.statement_line_catalogue%rowtype;
  item text;
  seen text[] := array[]::text[];
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not queue suggested figures' using errcode = '42501';
  end if;

  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'No such company: %', p_company_id using errcode = '23503';
  end if;

  select review_status, licence_class into doc_status, doc_licence
    from public.documents where id = p_document_id;
  if doc_status is null then
    raise exception 'No such document: %', p_document_id using errcode = '23503';
  end if;
  if doc_status <> 'approved' then
    raise exception 'Suggestions must come from an approved document' using errcode = '23514';
  end if;
  if doc_licence = 'unverified' then
    raise exception 'Suggestions cannot come from a document whose licence is unverified' using errcode = '23514';
  end if;

  if p_suggestions is null or jsonb_typeof(p_suggestions) <> 'array' or jsonb_array_length(p_suggestions) = 0 then
    raise exception 'A run with nothing in it is not worth queueing' using errcode = '23514';
  end if;

  insert into public.figure_suggestion_batches (
    company_id, document_id, statement_type, period_type, period_start, period_end,
    currency, magnitude, provider, model, prompt_version, note, created_by
  )
  values (
    p_company_id, p_document_id, p_statement_type, p_period_type, p_period_start, p_period_end,
    upper(coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'NGN')),
    coalesce(nullif(btrim(coalesce(p_magnitude, '')), ''), 'thousands'),
    p_provider, nullif(btrim(coalesce(p_model, '')), ''),
    nullif(btrim(coalesce(p_prompt_version, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''), actor_user
  )
  returning id into new_batch;

  for entry in select * from jsonb_array_elements(p_suggestions)
  loop
    item := nullif(btrim(coalesce(entry ->> 'line_item', '')), '');
    if item is null then
      raise exception 'Every suggestion names the figure it proposes' using errcode = '23514';
    end if;
    if item = any (seen) then
      raise exception 'The extractor proposed % twice; that is one batch per reading', item using errcode = '23505';
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

    -- `is distinct from`, not `<>`. A missing key makes `entry -> 'key'` SQL
    -- NULL, jsonb_typeof(NULL) is NULL, and `NULL <> 'number'` is NULL — so the
    -- plain inequality never fires and the row dies on the not-null constraint
    -- instead, handing the desk a bare 23502 in place of the message written
    -- here. Found by a test asserting the message, not the refusal.
    if jsonb_typeof(entry -> 'value_reported') is distinct from 'number' then
      raise exception 'The suggestion for % needs a figure', item using errcode = '23514';
    end if;
    if jsonb_typeof(entry -> 'source_page') is distinct from 'number' then
      raise exception 'The suggestion for % needs the page it was read from', item using errcode = '23514';
    end if;

    insert into public.figure_suggestions (
      batch_id, line_item, value_reported, presentation, magnitude, source_page,
      raw_label, raw_value, confidence
    )
    values (
      new_batch, item, (entry ->> 'value_reported')::numeric,
      coalesce(nullif(btrim(coalesce(entry ->> 'presentation', '')), ''), 'plain'),
      nullif(btrim(coalesce(entry ->> 'magnitude', '')), ''),
      (entry ->> 'source_page')::numeric::integer,
      nullif(btrim(coalesce(entry ->> 'raw_label', '')), ''),
      nullif(btrim(coalesce(entry ->> 'raw_value', '')), ''),
      case when jsonb_typeof(entry -> 'confidence') = 'number' then (entry ->> 'confidence')::numeric end
    );
  end loop;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'figure_suggestions.queued',
    jsonb_build_object(
      'batch_id', new_batch,
      'company_id', p_company_id,
      'document_id', p_document_id,
      'provider', p_provider,
      'model', p_model,
      'prompt_version', p_prompt_version,
      'suggestions', jsonb_array_length(p_suggestions)
    )
  );

  return new_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Deciding one suggestion
-- ---------------------------------------------------------------------------

-- One suggestion per call, deliberately. The desk has no accept-all button and
-- this function could not serve one: a reviewer who has not looked at the page
-- for a figure has not verified it, and forty figures is forty decisions.
create or replace function public.decide_figure_suggestion(
  target_suggestion uuid,
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
  suggestion public.figure_suggestions%rowtype;
  batch public.figure_suggestion_batches%rowtype;
begin
  if not public.may_enter_figures(actor_user) then
    raise exception 'Actor may not review suggested figures' using errcode = '42501';
  end if;

  if p_decision not in ('accepted', 'rejected') then
    raise exception 'A suggestion is accepted or rejected' using errcode = '23514';
  end if;

  select * into suggestion from public.figure_suggestions where id = target_suggestion for update;
  if suggestion.id is null then
    raise exception 'No such suggestion: %', target_suggestion using errcode = '23503';
  end if;
  if suggestion.status <> 'pending' then
    raise exception 'That suggestion has already been %', suggestion.status using errcode = '23514';
  end if;

  select * into batch from public.figure_suggestion_batches where id = suggestion.batch_id;
  if batch.status = 'closed' then
    raise exception 'That batch is closed; its figures have already been recorded' using errcode = '23514';
  end if;

  if p_decision = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why the suggestion is wrong; it is what stops the next one being wrong the same way'
      using errcode = '23514';
  end if;

  update public.figure_suggestions
     set status = p_decision,
         decided_by = actor_user,
         decided_at = now(),
         decision_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = target_suggestion;

  insert into public.audit_logs (actor_user_id, action, details)
  values (
    actor_user,
    'figure_suggestion.' || p_decision,
    jsonb_build_object(
      'suggestion_id', target_suggestion,
      'batch_id', suggestion.batch_id,
      'line_item', suggestion.line_item,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Closing a batch against the statement it produced
-- ---------------------------------------------------------------------------

-- Called after record_statement has written the figures, so an AI-assisted
-- statement can be traced to the run that proposed them, the model and the
-- prompt version. Kept separate from record_statement rather than folded into
-- it: the statement is the record, and a failure to note the batch must not be
-- able to roll back figures a person has verified.
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
    -- A batch may only point at the statement it actually describes, or the
    -- provenance would say an extractor proposed figures it never saw.
    if statement.company_id <> batch.company_id
       or statement.statement_type <> batch.statement_type
       or statement.period_end <> batch.period_end then
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

-- ---------------------------------------------------------------------------
-- 7. Access
-- ---------------------------------------------------------------------------

revoke all on function public.guard_figure_suggestion() from public, anon, authenticated;
revoke all on function public.guard_figure_suggestion_batch() from public, anon, authenticated;
revoke all on function public.record_figure_suggestions(
  uuid, uuid, uuid, text, text, date, date, text, text, text, jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.decide_figure_suggestion(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.close_suggestion_batch(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.record_figure_suggestions(
  uuid, uuid, uuid, text, text, date, date, text, text, text, jsonb, text, text, text
) to service_role;
grant execute on function public.decide_figure_suggestion(uuid, uuid, text, text) to service_role;
grant execute on function public.close_suggestion_batch(uuid, uuid, uuid) to service_role;

alter table public.figure_suggestion_batches enable row level security;
alter table public.figure_suggestions enable row level security;

revoke all on public.figure_suggestion_batches, public.figure_suggestions from anon, authenticated;
grant select on public.figure_suggestion_batches, public.figure_suggestions to authenticated;
grant all on public.figure_suggestion_batches, public.figure_suggestions to service_role;

-- A proposal is not a published figure, and no reader has any business seeing
-- one. This is the desk's working queue: a machine's guess at a company's
-- results, visible to the people whose job is to check it and to nobody else.
drop policy if exists "The figures desk sees suggestion batches" on public.figure_suggestion_batches;
create policy "The figures desk sees suggestion batches" on public.figure_suggestion_batches
for select to authenticated using (
  public.is_platform_admin() or public.has_staff_role(array['financial_analyst'])
);

drop policy if exists "The figures desk sees suggestions" on public.figure_suggestions;
create policy "The figures desk sees suggestions" on public.figure_suggestions
for select to authenticated using (
  public.is_platform_admin() or public.has_staff_role(array['financial_analyst'])
);
