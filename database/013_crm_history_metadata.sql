-- ============================================================
-- 013: crm_history.metadata (jsonb)
-- ROGA-52 (ROGA-36.2)
--
-- Adiciona coluna `metadata jsonb` em crm_history para que o helper
-- appendInboxMessageHistory possa registrar direction ('in' | 'out')
-- e quaisquer campos extras junto de cada evento `inbox_message`,
-- sem precisar codificar isso dentro de `message` (texto livre).
--
-- Idempotente: seguro para rodar multiplas vezes.
-- ============================================================

-- TODO RLS: revisar policies de crm_history em ROGA-RLS.
alter table public.crm_history
  add column if not exists metadata jsonb;

-- Indice GIN para permitir filtros tipo `metadata @> '{"direction":"in"}'`
-- na timeline do CRM (consultas tendem a ser por lead_id + filtro leve).
create index if not exists crm_history_metadata_gin_idx
  on public.crm_history using gin (metadata);

notify pgrst, 'reload schema';
