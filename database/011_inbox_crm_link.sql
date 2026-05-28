-- ============================================================
-- 011: Inbox <-> CRM link
-- ROGA-51 (ROGA-36.1)
--
-- Vincula chat_conversations a crm_leads e garante criacao
-- automatica de lead pelo phone_normalized derivado de contact_jid.
-- Adiciona source_message_id em crm_history (unique parcial)
-- e publica crm_history em supabase_realtime.
--
-- NOTAS DE COMPATIBILIDADE COM O SCHEMA REAL (003/008):
--   * chat_conversations nao possui as colunas phone,
--     phone_normalized, display_name nem whatsapp_account_id.
--     As colunas existentes sao: account_id, contact_jid, contact_name.
--     Por isso o trigger deriva phone_normalized de contact_jid
--     (strip de nao-digitos antes do '@') e usa account_id +
--     contact_name nos campos correspondentes do lead.
--   * crm_leads.origin e text (003), nao enum -- passo 3 da spec
--     e intencionalmente omitido (nenhum ALTER TYPE necessario).
--   * chat_conversations.lead_id ja foi criada em 008; o
--     ADD COLUMN IF NOT EXISTS abaixo e mantido para idempotencia.
-- Idempotente: seguro para rodar multiplas vezes.
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

-- (Skipped) Extensao do enum origin: crm_leads.origin e text (003).

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
  on conflict (phone_normalized) do nothing
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

notify pgrst, 'reload schema';
