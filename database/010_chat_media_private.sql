-- ROGA-35: Tornar o bucket `chat-media` privado + RLS por usuário autenticado.
--
-- Contexto:
--   Migration 008 criou o bucket `chat-media` com `public = true` e a policy
--   `"chat-media public read"` permitindo SELECT anônimo. Áudios, imagens,
--   vídeos e documentos de conversas do WhatsApp ficavam acessíveis a
--   qualquer um que tivesse a URL pública. Risco LGPD + vazamento de
--   conversa de cliente.
--
-- Esta migration:
--   1. Marca o bucket como privado (storage.buckets.public = false).
--   2. Revoga a policy pública de SELECT em storage.objects.
--   3. Cria uma nova policy de SELECT exigindo usuário autenticado
--      (auth.uid() is not null).
--   4. Mantém escrita restrita a service_role (já bypassa RLS — não é
--      necessária policy explícita; nenhuma policy de INSERT/UPDATE/DELETE
--      é adicionada aqui, então só service_role escreve).
--
-- A API serve URLs via `createSignedUrl(path, ttl)` (service_role) — o
-- cliente nunca consome a URL pública direta.
--
-- Idempotente: todas as operações usam IF EXISTS / IF NOT EXISTS.

-- ============================================================
-- 1. Bucket -> privado
-- ============================================================
update storage.buckets
   set public = false
 where id = 'chat-media';

-- ============================================================
-- 2. Revogar policy pública herdada de 008
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'chat-media public read'
  ) then
    drop policy "chat-media public read" on storage.objects;
  end if;
end $$;

-- ============================================================
-- 3. Policy nova: SELECT apenas para autenticados
-- ============================================================
-- Nota: amarrar à FK `chat_messages.conversation_id` exigiria que o
-- caminho do objeto fosse parseável para o conversation_id, o que não é
-- o caso hoje (paths são `{accountId}/{baileys_message_id}.{ext}`).
-- O isolamento por workspace/tenant será endereçado pela ROGA-34 (RLS).
-- Esta migration foca em fechar o acesso anônimo — o cenário P0/LGPD.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'chat-media authenticated read'
  ) then
    drop policy "chat-media authenticated read" on storage.objects;
  end if;
  create policy "chat-media authenticated read" on storage.objects
    for select
    using (
      bucket_id = 'chat-media'
      and auth.uid() is not null
    );
end $$;

-- ============================================================
-- 4. Refresh do schema cache do PostgREST
-- ============================================================
notify pgrst, 'reload schema';
