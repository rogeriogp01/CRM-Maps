-- Adiciona colunas necessárias para o disparo real via Baileys.
-- Idempotente: usa IF NOT EXISTS para suportar re-execução.

alter table public.campaign_leads
  add column if not exists dispatched_at timestamptz,
  add column if not exists error_message text;

create index if not exists idx_campaign_leads_dispatched_at
  on public.campaign_leads(dispatched_at desc);
