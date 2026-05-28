-- system_settings: configurações globais do operador (singleton).
-- Apenas uma linha existe (id fixo). Constraint impede inserts adicionais.

create table if not exists public.system_settings (
  id uuid primary key default '00000000-0000-0000-0000-000000000001',
  operator_name text,
  operator_whatsapp text,
  company_name text,
  company_website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_settings_singleton check (id = '00000000-0000-0000-0000-000000000001')
);

-- Linha inicial (idempotente).
insert into public.system_settings (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
