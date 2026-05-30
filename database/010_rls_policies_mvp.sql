-- ============================================================
-- 010: RLS policies MVP (ROGA-108 / ROGA-92.1)
-- ------------------------------------------------------------
-- MVP single-tenant: any authenticated user can do anything on
-- every table touched by the migrated /api/* handlers in ROGA-92.
-- Multi-tenant isolation by workspace_id is out of scope and
-- tracked in ROGA-74.
--
-- Idempotent: safe to re-run. Each block:
--   1. enables RLS on the table (alter ... enable row level security
--      is a no-op when already enabled);
--   2. drops the existing auth_can_all policy if present, then
--      recreates it so the definition always matches this file.
--
-- Note on `crm_notes`: the issue body lists `crm_notes` but no
-- such table exists in the schema (`notes` is a column on
-- `crm_leads`). Skipped intentionally; flagged in the closing
-- comment on ROGA-108.
-- ============================================================

do $$
declare
  t text;
  tables text[] := array[
    'crm_columns',
    'crm_leads',
    'crm_history',
    'chat_conversations',
    'chat_messages',
    'whatsapp_accounts',
    'message_dispatch_history',
    'campaign_leads',
    'system_settings'
  ];
begin
  foreach t in array tables loop
    -- Only act if the table actually exists, so this migration can
    -- be applied to environments that have not yet picked up some
    -- of the upstream table-creating migrations.
    if exists (
      select 1 from pg_tables
       where schemaname = 'public'
         and tablename  = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists auth_can_all on public.%I', t);
      execute format(
        'create policy auth_can_all on public.%I for all to authenticated using (true) with check (true)',
        t
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
