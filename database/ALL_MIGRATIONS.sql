-- ============================================================
-- ALL MIGRATIONS COMBINED (001 → 011)
-- Idempotente: seguro para rodar múltiplas vezes.
-- ============================================================

-- ============================================================
-- 001: whatsapp_accounts
-- ============================================================
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

-- ============================================================
-- 002: message_dispatch_history
-- ============================================================
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

-- ============================================================
-- 003: crm_columns, crm_leads, crm_history
-- ============================================================
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

-- ============================================================
-- 004: repair whatsapp_accounts (garante colunas e constraints)
-- ============================================================
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

-- ============================================================
-- 005: system_settings
-- ============================================================
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

insert into public.system_settings (id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ============================================================
-- 006: campaign_leads + phone_blacklist
-- ============================================================
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

create table if not exists public.phone_blacklist (
  id uuid primary key default gen_random_uuid(),
  phone_normalized text not null unique,
  reason text,
  created_at timestamptz default now()
);

create index if not exists idx_phone_blacklist_phone on public.phone_blacklist(phone_normalized);

-- ============================================================
-- 007: colunas extras em campaign_leads
-- ============================================================
alter table public.campaign_leads
  add column if not exists dispatched_at timestamptz,
  add column if not exists error_message text;

create index if not exists idx_campaign_leads_dispatched_at
  on public.campaign_leads(dispatched_at desc);

-- ============================================================
-- 008: chat_conversations + chat_messages + storage bucket
-- ============================================================
alter table public.crm_leads
  add column if not exists phone_normalized text;

create unique index if not exists crm_leads_phone_norm_uidx
  on public.crm_leads(phone_normalized)
  where phone_normalized is not null;

update public.crm_leads
   set phone_normalized = regexp_replace(coalesce(phone, ''), '\D', '', 'g')
 where phone_normalized is null
   and phone is not null
   and length(regexp_replace(phone, '\D', '', 'g')) > 0;

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
  status text,
  "timestamp" timestamptz not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, baileys_message_id)
);

create index if not exists chat_msg_conv_ts_idx
  on public.chat_messages(conversation_id, "timestamp" desc);

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

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', true)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'chat-media public read') then
    drop policy "chat-media public read" on storage.objects;
  end if;
  create policy "chat-media public read" on storage.objects
    for select using (bucket_id = 'chat-media');
end $$;

-- ============================================================
-- 011: Inbox <-> CRM link (ROGA-51 / ROGA-36.1)
--   * chat_conversations.lead_id (idempotente; coluna ja criada em 008)
--   * trigger ensure_lead_for_conversation cria/anexa lead pelo
--     phone_normalized derivado de contact_jid
--   * crm_history.source_message_id (uuid) com unique parcial
--   * indice composto crm_history(lead_id, created_at desc)
--   * crm_history publicado em supabase_realtime
--   * origin e text (003) -- nenhum ALTER TYPE necessario
-- ============================================================

-- TODO RLS: revisar policies de chat_conversations em ROGA-RLS.
alter table public.chat_conversations
  add column if not exists lead_id uuid references public.crm_leads(id) on delete set null;

create index if not exists chat_conversations_lead_id_idx
  on public.chat_conversations(lead_id);

-- TODO RLS: revisar policies de crm_history em ROGA-RLS.
alter table public.crm_history
  add column if not exists source_message_id uuid;

create unique index if not exists crm_history_source_message_id_uidx
  on public.crm_history(source_message_id)
  where source_message_id is not null;

create index if not exists crm_history_lead_id_created_at_idx
  on public.crm_history(lead_id, created_at desc);

create or replace function public.ensure_lead_for_conversation()
returns trigger
language plpgsql
as $$
declare
  v_phone_norm text;
  v_lead_id    uuid;
begin
  if new.lead_id is not null then
    return new;
  end if;

  if new.contact_jid is null then
    return new;
  end if;

  v_phone_norm := regexp_replace(split_part(new.contact_jid, '@', 1), '\D', '', 'g');

  if v_phone_norm is null or length(v_phone_norm) = 0 then
    return new;
  end if;

  select id
    into v_lead_id
    from public.crm_leads
   where phone_normalized = v_phone_norm
   limit 1;

  if v_lead_id is not null then
    new.lead_id := v_lead_id;
    return new;
  end if;

  insert into public.crm_leads (
    phone,
    phone_normalized,
    origin,
    status,
    whatsapp_account_id,
    name
  )
  values (
    v_phone_norm,
    v_phone_norm,
    'inbox',
    'Novo Lead',
    new.account_id,
    coalesce(new.contact_name, v_phone_norm)
  )
  on conflict (phone_normalized) where phone_normalized is not null do nothing
  returning id into v_lead_id;

  if v_lead_id is null then
    select id
      into v_lead_id
      from public.crm_leads
     where phone_normalized = v_phone_norm
     limit 1;
  end if;

  new.lead_id := v_lead_id;
  return new;
end;
$$;

drop trigger if exists ensure_lead_for_conversation_trg on public.chat_conversations;
create trigger ensure_lead_for_conversation_trg
  before insert on public.chat_conversations
  for each row
  execute function public.ensure_lead_for_conversation();

do $$
begin
  begin
    alter publication supabase_realtime add table public.crm_history;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================
-- 013: crm_history.metadata (jsonb)
-- ROGA-52 (ROGA-36.2)
--
-- Adiciona coluna metadata jsonb em crm_history para que o helper
-- appendInboxMessageHistory possa registrar direction ('in' | 'out')
-- e campos extras junto de eventos `inbox_message`, sem codificar
-- esses metadados dentro de `message` (texto livre).
-- ============================================================

-- TODO RLS: revisar policies de crm_history em ROGA-RLS.
alter table public.crm_history
  add column if not exists metadata jsonb;

create index if not exists crm_history_metadata_gin_idx
  on public.crm_history using gin (metadata);

-- ============================================================
-- 014: workspaces + workspace_members + current_workspace_id()
-- ROGA-71 (Fase 1 de ROGA-49)
-- ============================================================
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists idx_workspace_members_user_id
  on public.workspace_members(user_id);

insert into public.workspaces (id, name, owner_user_id, plan)
values (
  '00000000-0000-0000-0000-000000000001',
  'Workspace Default',
  '00000000-0000-0000-0000-000000000001',
  'free'
)
on conflict (id) do nothing;

create or replace function public.current_workspace_id()
returns uuid
language plpgsql
stable
as $$
declare
  v_claims_raw text;
  v_workspace_raw text;
  v_workspace_id uuid;
begin
  v_claims_raw := current_setting('request.jwt.claims', true);

  if v_claims_raw is null or v_claims_raw = '' then
    return '00000000-0000-0000-0000-000000000001'::uuid;
  end if;

  begin
    v_workspace_raw := (v_claims_raw::jsonb) ->> 'workspace_id';
  exception when others then
    return '00000000-0000-0000-0000-000000000001'::uuid;
  end;

  if v_workspace_raw is null or v_workspace_raw = '' then
    return '00000000-0000-0000-0000-000000000001'::uuid;
  end if;

  begin
    v_workspace_id := v_workspace_raw::uuid;
  exception when invalid_text_representation then
    return '00000000-0000-0000-0000-000000000001'::uuid;
  end;

  return v_workspace_id;
end;
$$;

-- ============================================================
-- 015: backfill + FK workspace_id nas 10 tabelas de dominio
-- ROGA-73 (Fase 2 de ROGA-49)
--
-- Depende do bloco 014 acima. Idempotente.
-- Ver database/015_add_workspace_id_fk.sql para o cabecalho completo.
-- ============================================================

-- 1) whatsapp_accounts
alter table public.whatsapp_accounts
  add column if not exists workspace_id uuid;
update public.whatsapp_accounts
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.whatsapp_accounts
  alter column workspace_id set not null;
do $$
begin
  alter table public.whatsapp_accounts
    add constraint whatsapp_accounts_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_whatsapp_accounts_workspace_id
  on public.whatsapp_accounts(workspace_id);

-- 2) crm_leads
alter table public.crm_leads
  add column if not exists workspace_id uuid;
update public.crm_leads
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.crm_leads
  alter column workspace_id set not null;
do $$
begin
  alter table public.crm_leads
    add constraint crm_leads_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_crm_leads_workspace_id
  on public.crm_leads(workspace_id);

-- 3) crm_columns
alter table public.crm_columns
  add column if not exists workspace_id uuid;
update public.crm_columns
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.crm_columns
  alter column workspace_id set not null;
do $$
begin
  alter table public.crm_columns
    add constraint crm_columns_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_crm_columns_workspace_id
  on public.crm_columns(workspace_id);

-- 4) crm_history
alter table public.crm_history
  add column if not exists workspace_id uuid;
update public.crm_history
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.crm_history
  alter column workspace_id set not null;
do $$
begin
  alter table public.crm_history
    add constraint crm_history_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_crm_history_workspace_id
  on public.crm_history(workspace_id);

-- 5) chat_conversations
alter table public.chat_conversations
  add column if not exists workspace_id uuid;
update public.chat_conversations
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.chat_conversations
  alter column workspace_id set not null;
do $$
begin
  alter table public.chat_conversations
    add constraint chat_conversations_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_chat_conversations_workspace_id
  on public.chat_conversations(workspace_id);

-- 6) chat_messages
alter table public.chat_messages
  add column if not exists workspace_id uuid;
update public.chat_messages
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.chat_messages
  alter column workspace_id set not null;
do $$
begin
  alter table public.chat_messages
    add constraint chat_messages_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_chat_messages_workspace_id
  on public.chat_messages(workspace_id);

-- 7) campaign_leads
alter table public.campaign_leads
  add column if not exists workspace_id uuid;
update public.campaign_leads
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.campaign_leads
  alter column workspace_id set not null;
do $$
begin
  alter table public.campaign_leads
    add constraint campaign_leads_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_campaign_leads_workspace_id
  on public.campaign_leads(workspace_id);

-- 8) phone_blacklist
alter table public.phone_blacklist
  add column if not exists workspace_id uuid;
update public.phone_blacklist
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.phone_blacklist
  alter column workspace_id set not null;
do $$
begin
  alter table public.phone_blacklist
    add constraint phone_blacklist_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_phone_blacklist_workspace_id
  on public.phone_blacklist(workspace_id);

-- 9) message_dispatch_history
alter table public.message_dispatch_history
  add column if not exists workspace_id uuid;
update public.message_dispatch_history
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.message_dispatch_history
  alter column workspace_id set not null;
do $$
begin
  alter table public.message_dispatch_history
    add constraint message_dispatch_history_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create index if not exists idx_message_dispatch_history_workspace_id
  on public.message_dispatch_history(workspace_id);

-- 10) system_settings — caso especial (singleton -> per workspace)
alter table public.system_settings
  drop constraint if exists system_settings_singleton;
alter table public.system_settings
  add column if not exists workspace_id uuid;
update public.system_settings
  set workspace_id = '00000000-0000-0000-0000-000000000001'
  where workspace_id is null;
alter table public.system_settings
  alter column workspace_id set not null;
do $$
begin
  alter table public.system_settings
    add constraint system_settings_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.system_settings
    add constraint system_settings_singleton_per_workspace
    unique (workspace_id);
exception when duplicate_object then null;
end $$;
create index if not exists idx_system_settings_workspace_id
  on public.system_settings(workspace_id);

-- ============================================================
-- Final: reload PostgREST schema cache
-- ============================================================
notify pgrst, 'reload schema';
