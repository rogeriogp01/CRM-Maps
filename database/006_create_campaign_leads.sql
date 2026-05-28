-- campaign_leads: destinatários carregados em uma campanha de disparo.
-- Hoje, suporta uma campanha "default" (id fixo abaixo); pronto para virar
-- multi-campanha trocando o default e tornando a FK explícita.

create table if not exists public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default '00000000-0000-0000-0000-000000000001',
  name text,
  phone text not null,
  phone_normalized text not null,
  company text,
  tags text[],
  source text not null check (source in ('crm', 'maps', 'csv', 'manual')),
  valid_whatsapp boolean,
  already_contacted boolean default false,
  last_contacted_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  account_used uuid references public.whatsapp_accounts(id) on delete set null,
  variation_used int,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (campaign_id, phone_normalized)
);

create index if not exists idx_campaign_leads_campaign on public.campaign_leads(campaign_id);
create index if not exists idx_campaign_leads_status on public.campaign_leads(campaign_id, status);
create index if not exists idx_campaign_leads_phone on public.campaign_leads(phone_normalized);

-- phone_blacklist: números que NUNCA devem receber disparo.
create table if not exists public.phone_blacklist (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null unique,
  reason text,
  created_at timestamptz default now()
);

create index if not exists idx_phone_blacklist_phone on public.phone_blacklist(phone_normalized);
