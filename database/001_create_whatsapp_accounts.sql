create table if not exists public.whatsapp_accounts (
  id uuid primary key,
  name text not null,
  phone text,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'connecting', 'error')),
  session_id text not null unique,
  qr_code text,
  last_connection_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_accounts_status on public.whatsapp_accounts(status);
create index if not exists idx_whatsapp_accounts_created_at on public.whatsapp_accounts(created_at desc);

notify pgrst, 'reload schema';
