-- ============================================================
-- 015: backfill + FK workspace_id nas 10 tabelas de dominio
-- ROGA-73 (Fase 2 de ROGA-49)
--
-- Depende de 014_create_workspaces.sql (ROGA-71) — assume que
-- public.workspaces existe e que o workspace default
-- 00000000-0000-0000-0000-000000000001 ("Workspace Default")
-- ja esta inserido.
--
-- Para cada uma das 10 tabelas de dominio, este script:
--   1. adiciona coluna workspace_id uuid (nullable inicialmente);
--   2. faz backfill com o workspace default em linhas existentes;
--   3. promove a coluna para NOT NULL;
--   4. cria FK para public.workspaces(id) ON DELETE RESTRICT;
--   5. cria indice idx_<tabela>_workspace_id.
--
-- Atencao especial: public.system_settings tem uma constraint
-- singleton (`check (id = '00000000-...0001')`) que impede mais
-- de uma linha. Para suportar 1 linha por workspace no futuro,
-- este script:
--   * dropa a constraint `system_settings_singleton`;
--   * adiciona `system_settings_singleton_per_workspace
--     unique (workspace_id)`.
--
-- Idempotente: seguro para rodar multiplas vezes. Todas as
-- operacoes usam `if not exists` / `if exists` / blocos DO com
-- excecao `duplicate_object`.
--
-- Roda em transacao unica (BEGIN/COMMIT) para evitar estado
-- parcial caso uma das etapas falhe.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) whatsapp_accounts
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_whatsapp_accounts_workspace_id
  on public.whatsapp_accounts(workspace_id);

-- ------------------------------------------------------------
-- 2) crm_leads
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_crm_leads_workspace_id
  on public.crm_leads(workspace_id);

-- ------------------------------------------------------------
-- 3) crm_columns
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_crm_columns_workspace_id
  on public.crm_columns(workspace_id);

-- ------------------------------------------------------------
-- 4) crm_history
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_crm_history_workspace_id
  on public.crm_history(workspace_id);

-- ------------------------------------------------------------
-- 5) chat_conversations
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_chat_conversations_workspace_id
  on public.chat_conversations(workspace_id);

-- ------------------------------------------------------------
-- 6) chat_messages
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_chat_messages_workspace_id
  on public.chat_messages(workspace_id);

-- ------------------------------------------------------------
-- 7) campaign_leads
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_campaign_leads_workspace_id
  on public.campaign_leads(workspace_id);

-- ------------------------------------------------------------
-- 8) phone_blacklist
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_phone_blacklist_workspace_id
  on public.phone_blacklist(workspace_id);

-- ------------------------------------------------------------
-- 9) message_dispatch_history
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_message_dispatch_history_workspace_id
  on public.message_dispatch_history(workspace_id);

-- ------------------------------------------------------------
-- 10) system_settings — caso especial (singleton -> per workspace)
--
-- 005_create_system_settings.sql tem:
--   constraint system_settings_singleton check (id = '00000000-...0001')
--
-- Para virar singleton-por-workspace precisamos:
--   * dropar a constraint check antiga;
--   * adicionar workspace_id (default workspace no backfill);
--   * adicionar unique (workspace_id) -> ainda 1 linha por workspace.
--
-- A linha pre-existente (id = '00000000-...0001') recebe
-- workspace_id = '00000000-...0001' automaticamente no backfill —
-- compativel com o default.
-- ------------------------------------------------------------
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
    foreign key (workspace_id)
    references public.workspaces(id)
    on delete restrict;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter table public.system_settings
    add constraint system_settings_singleton_per_workspace
    unique (workspace_id);
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_system_settings_workspace_id
  on public.system_settings(workspace_id);

commit;

-- ============================================================
-- Final: reload PostgREST schema cache
-- ============================================================
notify pgrst, 'reload schema';
