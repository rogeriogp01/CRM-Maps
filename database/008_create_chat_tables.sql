-- Inbox WhatsApp: armazenamento de conversas e mensagens (incoming + outgoing)
-- Idempotente: todas as operações usam IF NOT EXISTS / ON CONFLICT.

-- ============================================================
-- 1. CRM: coluna normalizada para lookup rápido por telefone
-- ============================================================
alter table public.crm_leads
  add column if not exists phone_normalized text;

-- Partial unique index: permite leads sem telefone, mas evita duplicatas
-- quando o telefone existe (cobre o caso real de lookup pelo Inbox).
create unique index if not exists crm_leads_phone_norm_uidx
  on public.crm_leads(phone_normalized)
  where phone_normalized is not null;

-- Backfill único da coluna a partir do campo phone existente.
update public.crm_leads
   set phone_normalized = regexp_replace(coalesce(phone, ''), '\D', '', 'g')
 where phone_normalized is null
   and phone is not null
   and length(regexp_replace(phone, '\D', '', 'g')) > 0;

-- ============================================================
-- 2. chat_conversations: uma linha por (account_id, contact_jid)
-- ============================================================
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.whatsapp_accounts(id) on delete cascade,
  contact_jid text not null,
  contact_name text,
  lead_id uuid references public.crm_leads(id) on delete set null,
  unread_count int not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, contact_jid)
);

create index if not exists chat_conv_last_msg_idx
  on public.chat_conversations(last_message_at desc);
create index if not exists chat_conv_lead_idx
  on public.chat_conversations(lead_id);
create index if not exists chat_conv_account_idx
  on public.chat_conversations(account_id);

-- ============================================================
-- 3. chat_messages: mensagens da conversa
-- ============================================================
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  baileys_message_id text not null,
  direction text not null check (direction in ('in','out')),
  from_me boolean not null,
  type text not null check (type in ('text','image','audio','video','document','sticker','unknown')),
  body text,
  media_url text,
  media_mime text,
  status text, -- sent | delivered | read | null
  "timestamp" timestamptz not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, baileys_message_id)
);

create index if not exists chat_msg_conv_ts_idx
  on public.chat_messages(conversation_id, "timestamp" desc);

-- ============================================================
-- 4. Supabase Realtime: publicar as duas tabelas
-- ============================================================
-- Adicionar idempotentemente: ignorar se já estão na publication.
do $$
begin
  begin
    alter publication supabase_realtime add table public.chat_conversations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.chat_messages;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- 5. Storage bucket para mídia das mensagens
-- ============================================================
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

-- Política: leitura pública. Escrita só via service_role (já bypassa RLS).
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'chat-media public read') then
    drop policy "chat-media public read" on storage.objects;
  end if;
  create policy "chat-media public read" on storage.objects
    for select using (bucket_id = 'chat-media');
end $$;

-- ============================================================
-- 6. Refresh do schema cache do PostgREST
-- ============================================================
notify pgrst, 'reload schema';
