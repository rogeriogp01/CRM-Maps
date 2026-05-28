create table if not exists public.message_dispatch_history (
  id uuid primary key default gen_random_uuid(),
  contact_phone text not null,
  whatsapp_account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
  message_used text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_dispatch_history_created_at on public.message_dispatch_history(created_at desc);
create index if not exists idx_message_dispatch_history_phone on public.message_dispatch_history(contact_phone);
create index if not exists idx_message_dispatch_history_account on public.message_dispatch_history(whatsapp_account_id);
