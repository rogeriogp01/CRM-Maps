-- lead_usage: persistent counter of lead-acquisition cost per provider per month.
-- Used by the MAX_MONTHLY_LEAD_COST_USD guard to prevent runaway provider spend.
-- One row per (provider, year_month). `cost_usd_cents` is integer cents to avoid float drift.
--
-- Touched by:
--   - src/lib/server/leads/cost-guard.ts (read / increment)
--   - src/app/api/leads/outscraper/webhook/route.ts (increment on result)
--   - src/lib/server/leads/outscraper-source.ts (pre-submit check)

create table if not exists public.lead_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('outscraper', 'playwright', 'places_api')),
  -- "YYYY-MM" UTC bucket.
  year_month text not null,
  cost_usd_cents integer not null default 0,
  -- Outstanding reservations against in-flight jobs. Bumped at submit by
  -- `lead_usage_reserve`, decremented at webhook by `lead_usage_settle` (or
  -- by `lead_usage_release` on failure). Invariant the guard enforces:
  --   cost_usd_cents + reserved_cents + new_estimate <= limit_cents.
  reserved_cents integer not null default 0,
  leads_count integer not null default 0,
  jobs_count integer not null default 0,
  last_request_id text,
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (provider, year_month)
);

create index if not exists idx_lead_usage_provider_month
  on public.lead_usage(provider, year_month);

-- Atomic accumulator. Inserts a fresh row at zero (no-op on conflict) then bumps.
-- Called from app code; safe under concurrent webhook deliveries.
create or replace function public.lead_usage_increment(
  p_provider text,
  p_year_month text,
  p_cost_cents integer,
  p_leads_count integer,
  p_jobs_count integer,
  p_request_id text
) returns public.lead_usage
language plpgsql
as $$
declare
  v_row public.lead_usage;
begin
  insert into public.lead_usage (provider, year_month, cost_usd_cents, leads_count, jobs_count, last_request_id)
    values (p_provider, p_year_month, 0, 0, 0, p_request_id)
    on conflict (provider, year_month) do nothing;

  update public.lead_usage
    set cost_usd_cents = cost_usd_cents + p_cost_cents,
        leads_count    = leads_count + p_leads_count,
        jobs_count     = jobs_count + p_jobs_count,
        last_request_id = coalesce(p_request_id, last_request_id),
        updated_at     = now()
    where provider = p_provider
      and year_month = p_year_month
    returning * into v_row;

  return v_row;
end;
$$;

-- Atomic reservation. Holds budget for an in-flight job so concurrent submits
-- cannot blow past the monthly cap between check-and-submit.
-- Raises SQLSTATE 'P0001' with message 'budget_exceeded' when
--   cost + reserved + estimated > limit.
-- Returns the row (with updated reserved_cents) on success.
create or replace function public.lead_usage_reserve(
  p_provider text,
  p_year_month text,
  p_estimated_cents integer,
  p_limit_cents integer,
  p_request_id text
) returns public.lead_usage
language plpgsql
as $$
declare
  v_row public.lead_usage;
begin
  insert into public.lead_usage (provider, year_month, cost_usd_cents, reserved_cents, leads_count, jobs_count, last_request_id)
    values (p_provider, p_year_month, 0, 0, 0, 0, p_request_id)
    on conflict (provider, year_month) do nothing;

  update public.lead_usage
    set reserved_cents = reserved_cents + p_estimated_cents,
        last_request_id = coalesce(p_request_id, last_request_id),
        updated_at     = now()
    where provider = p_provider
      and year_month = p_year_month
      and (cost_usd_cents + reserved_cents + p_estimated_cents) <= p_limit_cents
    returning * into v_row;

  if not found then
    raise exception 'budget_exceeded' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

-- Settle a reservation at webhook time: subtract the reservation, add the
-- actually-incurred cost. Safe under concurrent webhooks and never lets
-- reserved_cents go negative.
create or replace function public.lead_usage_settle(
  p_provider text,
  p_year_month text,
  p_reserved_cents integer,
  p_incurred_cents integer,
  p_leads_count integer,
  p_jobs_count integer,
  p_request_id text
) returns public.lead_usage
language plpgsql
as $$
declare
  v_row public.lead_usage;
begin
  insert into public.lead_usage (provider, year_month, cost_usd_cents, reserved_cents, leads_count, jobs_count, last_request_id)
    values (p_provider, p_year_month, 0, 0, 0, 0, p_request_id)
    on conflict (provider, year_month) do nothing;

  update public.lead_usage
    set reserved_cents = greatest(0, reserved_cents - p_reserved_cents),
        cost_usd_cents = cost_usd_cents + p_incurred_cents,
        leads_count    = leads_count + p_leads_count,
        jobs_count     = jobs_count + p_jobs_count,
        last_request_id = coalesce(p_request_id, last_request_id),
        updated_at     = now()
    where provider = p_provider
      and year_month = p_year_month
    returning * into v_row;

  return v_row;
end;
$$;

-- Release a reservation with zero settled cost — used when a job fails or
-- times out so we never leak budget against a job that never produced leads.
create or replace function public.lead_usage_release(
  p_provider text,
  p_year_month text,
  p_reserved_cents integer,
  p_request_id text
) returns public.lead_usage
language plpgsql
as $$
declare
  v_row public.lead_usage;
begin
  update public.lead_usage
    set reserved_cents = greatest(0, reserved_cents - p_reserved_cents),
        last_request_id = coalesce(p_request_id, last_request_id),
        updated_at     = now()
    where provider = p_provider
      and year_month = p_year_month
    returning * into v_row;

  return v_row;
end;
$$;

-- Augment campaign_leads.source check constraint to allow new normalized provider sources.
-- Existing values ('crm','maps','csv','manual') stay valid; we add 'outscraper' and 'playwright'
-- so a row preserves which provider produced it for audit (ToS attribution per ROGA-69 risks).
alter table public.campaign_leads
  drop constraint if exists campaign_leads_source_check;
alter table public.campaign_leads
  add constraint campaign_leads_source_check
    check (source in ('crm', 'maps', 'csv', 'manual', 'outscraper', 'playwright'));

-- Persist the provider-agnostic LeadSource fields so the seam doesn't drop
-- data the interface advertises. `category` is the place's category (e.g.
-- "padaria"); kept distinct from `company` which carries the legal/display
-- name when known.
alter table public.campaign_leads
  add column if not exists address text,
  add column if not exists rating numeric(3, 2),
  add column if not exists category text,
  add column if not exists place_id text;

create index if not exists idx_campaign_leads_place_id
  on public.campaign_leads(place_id) where place_id is not null;

-- Audit trail of provider jobs so on-call can correlate webhook -> result -> persisted leads.
create table if not exists public.lead_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  request_id text unique,
  -- Target campaign for the leads delivered by this job. The webhook MUST
  -- look this up before persisting so leads land on the right campaign.
  campaign_id uuid,
  query text,
  region text,
  requested_limit integer,
  status text not null default 'submitted'
    check (status in ('submitted', 'succeeded', 'failed', 'rejected_by_guard')),
  -- Budget reserved at submit time (matches `lead_usage.reserved_cents`
  -- bumped by `lead_usage_reserve`). Settled by the webhook.
  reserved_cost_usd_cents integer default 0,
  -- Per-lead price snapshot taken at submit so a key rotation / pricing
  -- change between submit and webhook does not desync the reservation.
  cost_per_lead_cents integer,
  cost_usd_cents integer default 0,
  leads_received integer default 0,
  leads_persisted integer default 0,
  error text,
  submitted_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_lead_jobs_request on public.lead_jobs(request_id);
create index if not exists idx_lead_jobs_provider_submitted
  on public.lead_jobs(provider, submitted_at desc);
