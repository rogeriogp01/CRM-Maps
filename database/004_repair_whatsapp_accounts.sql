-- Repair migration for whatsapp_accounts (idempotent)
-- Safe to run multiple times

create table if not exists public.whatsapp_accounts (
  id uuid primary key,
  name text not null,
  phone text,
  status text not null default 'disconnected',
  session_id text not null unique,
  qr_code text,
  last_connection_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_accounts
  add column if not exists qr_code text,
  add column if not exists phone text,
  add column if not exists status text not null default 'disconnected',
  add column if not exists session_id text,
  add column if not exists last_connection_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.whatsapp_accounts
  alter column name set not null,
  alter column session_id set not null,
  alter column status set default 'disconnected';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_accounts_status_check'
      and conrelid = 'public.whatsapp_accounts'::regclass
  ) then
    alter table public.whatsapp_accounts
      add constraint whatsapp_accounts_status_check
      check (status in ('connected', 'disconnected', 'connecting', 'error'));
  end if;
end $$;

create unique index if not exists whatsapp_accounts_session_id_key on public.whatsapp_accounts(session_id);
create index if not exists idx_whatsapp_accounts_status on public.whatsapp_accounts(status);
create index if not exists idx_whatsapp_accounts_created_at on public.whatsapp_accounts(created_at desc);

-- Refresh PostgREST schema cache (Supabase Data API)
notify pgrst, 'reload schema';
