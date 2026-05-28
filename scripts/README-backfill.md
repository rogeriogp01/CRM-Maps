# Backfill: Inbox ↔ CRM (`scripts/backfill_inbox_lead_link.ts`)

ROGA-53 (ROGA-36.3) — CLI Node TS para popular `chat_conversations.lead_id`
e `crm_history` a partir do que já existe em `chat_conversations` e
`chat_messages`. Espelha o comportamento do trigger
`ensure_lead_for_conversation` (ROGA-36.1 / `database/011_inbox_crm_link.sql`)
para o histórico que precedeu a migration.

## Pré-requisitos

- Migration 011 aplicada (`database/011_inbox_crm_link.sql` — ROGA-36.1):
  - `chat_conversations.lead_id` (FK → `crm_leads.id`)
  - `crm_history.source_message_id` (unique parcial → idempotência)
- Migration 013 aplicada (`database/013_crm_history_metadata.sql` — ROGA-36.2):
  - `crm_history.metadata` (jsonb)
- Variáveis de ambiente:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (bypass de RLS — mesmo padrão do
    `src/lib/server/supabase-admin.ts`)
- `tsx` instalado (devDependency); o `npm run backfill:inbox`
  já invoca via `tsx`.

> **Atenção:** o script grava com a service role. Rode em snapshot/staging
> primeiro. Em produção, prefira janela de manutenção.

## Uso

```bash
# Dry-run (default): nada é gravado, calcula cobertura estimada
npm run backfill:inbox -- --dry-run

# Aplicar (gravando) — usar lotes default
npm run backfill:inbox -- --apply

# Personalizar batch e histórico por conversa
npm run backfill:inbox -- --apply --batch-size=500 --history-per-conv=50

# Pular Fase C completamente (só link, sem histórico)
npm run backfill:inbox -- --apply --history-per-conv=0
```

### Flags

| Flag | Default | Significado |
|------|---------|-------------|
| `--dry-run` | sim | Não escreve; só lê e estima |
| `--apply` | — | Aplica writes (Fases A/B/C) |
| `--batch-size=N` | 500 | Tamanho do cursor por iteração |
| `--history-per-conv=N` | 50 | Últimas N mensagens por conversa em Fase C |

### Variáveis de ambiente

| Var | Obrigatória | Observações |
|-----|-------------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | sim | URL do projeto |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Service role (bypass de RLS) |

## Fases

### Fase A — link com lead existente

Para cada `chat_conversations` com `lead_id IS NULL` e `contact_jid` que
resulta em telefone normalizado válido, busca `crm_leads.id` por
`phone_normalized` (índice único parcial em `crm_leads`) e atualiza
`chat_conversations.lead_id`.

> O `phone_normalized` é derivado de `contact_jid` (strip de não-dígitos
> antes do `@`), seguindo o mesmo padrão do trigger
> `ensure_lead_for_conversation` — `chat_conversations` não possui as
> colunas `phone_normalized` / `display_name` / `whatsapp_account_id` no
> schema real (003/008); o trigger e o backfill compensam isso.

Cursor: `id > last_id`, lotes de `--batch-size`. Não há tentativa de
criação de lead nessa fase.

### Fase B — criação de leads ausentes

Para conversas restantes (ainda `lead_id IS NULL`) com `contact_jid`
normalizável: cria `crm_leads` (`origin='inbox'`, `status='Novo Lead'`,
`whatsapp_account_id = chat_conversations.account_id`,
`name = contact_name || phone`) via `UPSERT` com `ON CONFLICT
(phone_normalized)` (idempotente), e em seguida amarra
`chat_conversations.lead_id`.

Dentro de um mesmo lote, conversas com telefones repetidos consolidam em
um único lead. Como o índice único de `crm_leads.phone_normalized` é
parcial (`WHERE phone_normalized IS NOT NULL`), o upsert usa esse mesmo
predicado para resolver conflitos.

### Fase C — backfill de `crm_history`

Para cada `chat_conversations` com `lead_id` resolvido, lê as últimas
`--history-per-conv` `chat_messages` (ordenadas por `created_at DESC`) e
insere registros em `crm_history`:

- `lead_id` = `chat_conversations.lead_id`
- `type` = `inbox_message`
- `source_message_id` = `chat_messages.id` (chave de idempotência)
- `whatsapp_account_id` = `chat_conversations.account_id`
- `created_at` = `chat_messages.created_at` (preserva timeline)
- `message` (NOT NULL no schema) recebe o preview legível
  (`chat_messages.body` ou `""`).
- `metadata` (jsonb, migration 013 / ROGA-36.2) recebe
  `{ direction, backfilled: true, msg_type, chat_message_id }`.

A idempotência é garantida pelo `UNIQUE INDEX PARCIAL`
`crm_history_source_message_id_uidx` (migration 011): o upsert usa
`onConflict: 'source_message_id'` com `ignoreDuplicates: true`.

## Saída e exit code

Ao final, o script imprime um resumo com:

- total de conversas (`chat_conversations`)
- conversas com `contact_jid` (denominador da cobertura)
- conversas já linkadas antes do run (baseline)
- métricas por fase (escaneadas, linkadas, leads criados, históricos
  inseridos)
- conversas resolvidas ao final (com `lead_id`)
- **cobertura** = `resolvidas / com_contact_jid` (%)

Exit code:

- `0` se cobertura ≥ 95%
- `1` se cobertura < 95%
- `2` em erro fatal

## Reruns são no-op

- Fase A só atualiza onde `lead_id IS NULL`.
- Fase B usa `UPSERT ON CONFLICT (phone_normalized)` + `UPDATE … WHERE
  lead_id IS NULL`.
- Fase C usa `UPSERT ON CONFLICT (source_message_id)`.

Portanto: rodar `--apply` 2x não duplica leads nem históricos. O resumo
da segunda execução vai reportar contagens próximas de zero em "linkadas"
e "inseridos".

## Receita de validação contra snapshot

```bash
# 1) Restaurar snapshot prod em staging
# 2) Aplicar migrations: psql -f database/ALL_MIGRATIONS.sql
# 3) Dry-run e ler o resumo:
npm run backfill:inbox -- --dry-run --batch-size=500 --history-per-conv=50

# 4) Aplicar de verdade:
npm run backfill:inbox -- --apply --batch-size=500 --history-per-conv=50

# 5) Rodar o mesmo --apply de novo e confirmar idempotencia
npm run backfill:inbox -- --apply --batch-size=500 --history-per-conv=50
```

Critérios de aceite (ROGA-53):

- `--dry-run` em snapshot prod imprime cobertura esperada ≥ 95%.
- `--apply` em snapshot real eleva cobertura ≥ 95% e cria `crm_history`
  para até 50 mensagens por conversa.
- Rerun do `--apply` é no-op (contagens ~0 nas linhas de "linkadas" /
  "inseridos").

## Observabilidade

- Cada lote imprime uma linha com timestamp ISO 8601.
- Erros por linha não interrompem o run — eles propagam dentro do worker
  e abortam o lote atual; o script sai com exit 2 e registra o stack.
  Em snapshot/teste, considere capturar `2>&1 | tee` para diagnóstico.

## Limitações conhecidas

- Conversas sem `contact_jid` ou com `contact_jid` que não rende dígitos
  válidos são ignoradas (mesmo critério do trigger).
- Mensagens muito antigas além de `--history-per-conv` não são
  retroativamente populadas; é por desenho (acordado com ROGA-36).
- O backfill **não usa** o helper `appendInboxMessageHistory`
  (`src/lib/server/crm-history.ts`) diretamente porque (a) o script roda
  fora do bundler Next e (b) precisa de upsert em lote. Os dois caminhos
  gravam no mesmo schema (`type='inbox_message'`, `source_message_id` UNIQUE,
  `metadata.direction`), então mantêm a forma do registro alinhada.
