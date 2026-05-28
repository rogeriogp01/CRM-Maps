create table if not exists public.crm_columns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "order" integer not null,
  color text not null default '#3b82f6',
  created_at timestamptz not null default now()
);

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  company text,
  origin text not null default 'manual',
  status text not null,
  tags text[] not null default '{}',
  notes text,
  assigned_to text,
  whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  type text not null,
  message text not null,
  whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_columns_order on public.crm_columns("order");
create index if not exists idx_crm_leads_status on public.crm_leads(status);
create index if not exists idx_crm_leads_phone on public.crm_leads(phone);
create index if not exists idx_crm_leads_updated_at on public.crm_leads(updated_at desc);
create index if not exists idx_crm_history_lead_id on public.crm_history(lead_id);
create index if not exists idx_crm_history_created_at on public.crm_history(created_at desc);

insert into public.crm_columns (name, "order", color)
select * from (values
  ('Novo Lead', 1, '#64748b'),
  ('Primeiro Contato', 2, '#3b82f6'),
  ('Respondeu', 3, '#06b6d4'),
  ('Interessado', 4, '#22c55e'),
  ('Negociacao', 5, '#eab308'),
  ('Fechado', 6, '#10b981'),
  ('Perdido', 7, '#ef4444')
) as v(name, "order", color)
where not exists (select 1 from public.crm_columns);
