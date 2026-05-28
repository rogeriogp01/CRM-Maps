# Opt-out automático e compliance LGPD — CRM-Maps / ROGA

**Issue:** [ROGA-42](/ROGA/issues/ROGA-42) — P1, Onda 2 do roadmap CRM-Maps.
**Responsável técnico:** BackendEngineer.
**Responsável de política:** COO.

## Por que isso existe

Disparo automatizado via Baileys atinge contatos sem opt-in prévio formal.
Cumprir LGPD e reduzir banimentos exige **dois mecanismos não-negociáveis**:

1. **Atender pedidos de saída na primeira ocorrência.** Se um contato
   responde "SAIR" / "STOP" / "PARAR" / "DESCADASTRAR", a saída precisa
   ser confirmada e persistida em segundos, **sem ação humana**. LGPD
   art. 18 (direito de oposição) + art. 9º (eliminação) — atraso ou perda
   desse pedido é incidente reportável.
2. **Garantir que o pedido vale para sempre.** O número entra em uma
   blacklist consultada antes de cada disparo. Não basta marcar o lead —
   o disparador precisa parar de tentar antes de tocar no socket Baileys.

## Como o sistema executa

### Recebimento (inbox)

`src/lib/server/inbox.ts → handleIncomingMessage`:

1. Persiste a mensagem em `chat_messages` (idempotente).
2. Encontra/cria o lead em `crm_leads` por `phone_normalized`.
3. **Se a mensagem é texto e bate exatamente com uma palavra-chave de
   opt-out** (case-insensitive, ignora pontuação no início/fim):
   - `INSERT ... ON CONFLICT DO NOTHING` em
     `phone_blacklist (phone_normalized, reason='auto_opt_out')`.
   - Envia a mensagem de confirmação configurada via socket Baileys e
     registra o outgoing em `chat_messages` (mesmo path do disparo normal).
   - Marca o lead como `Perdido` (a menos que esteja em `Fechado` — não
     regredimos venda fechada; ainda assim registramos histórico).
   - Grava `crm_history (type='opt_out', message="solicitou opt-out via
     palavra-chave \"SAIR\"...")` — esse é o **rastro de auditoria LGPD**.

### Disparo

`src/lib/server/dispatch.ts → dispatchOneLead`:

1. Antes de tocar o socket Baileys, consulta `phone_blacklist`.
2. Se encontrar:
   - **Não envia nada.** Marca o `campaign_lead` como `skipped/BLACKLISTED`.
   - Grava `message_dispatch_history (status='failed',
     error='BLACKLISTED', message_used='(bloqueado por blacklist...)')` —
     prova de que o sistema honrou o opt-out mesmo quando uma campanha
     tentou reincidir.
   - Sincroniza com o CRM: se houver lead correspondente, vai para
     `Perdido` (se não estiver em `Fechado`/`Perdido`) e grava
     `crm_history (type='dispatch_blocked_opt_out')`.

## Configuração

Tabela `system_settings` (singleton, id fixo) tem dois campos editáveis:

| Campo | Default | Como editar |
|---|---|---|
| `opt_out_keywords text[]` | `{SAIR,STOP,PARAR,DESCADASTRAR}` | `upsertSystemSettings({ opt_out_keywords: [...] })` |
| `opt_out_confirmation_message text` | Texto Pt-BR padrão (ver migration 012) | Idem |

Aplicação da migration: `database/012_opt_out_config.sql`. Idempotente —
roda múltiplas vezes sem efeito colateral.

## Como o COO deve operar isso

1. **Manter a lista de keywords viva.** Se o produto for para outras
   regiões/idiomas, adicionar variantes (`UNSUBSCRIBE`, `CANCELAR`,
   `BAJA`, etc.). Editar em `system_settings`.
2. **Manter o texto de confirmação alinhado ao tom da marca e ao
   requisito legal.** O texto default já cumpre o mínimo (confirma que
   parou e oferece caminho de volta voluntário); evoluir se o jurídico
   pedir.
3. **Não tirar números da blacklist sem registro explícito.** Se um
   contato voltar a pedir contato, a remoção precisa de comentário em
   `phone_blacklist.reason` indicando quem autorizou — preferível criar
   um endpoint admin com auditoria, em vez de UPDATE direto.
4. **Auditoria mensal.** Conferir, em produção:
   - `select count(*) from phone_blacklist where reason='auto_opt_out';`
   - `select * from crm_history where type in ('opt_out','dispatch_blocked_opt_out') and created_at > now() - interval '30 days';`
   Discrepâncias (lead marcado Perdido sem entrada na blacklist, ou
   blacklist sem history) são incidentes de compliance — abrir issue.

## Riscos abertos (escalados ao CTO/CEO)

- **Opt-in inicial ainda é implícito.** Disparamos para listas extraídas
  do Google Maps sem opt-in formal. O opt-out resolve o lado reativo,
  mas não substitui consentimento no envio. Política de produto: ou
  documentamos "legítimo interesse comercial" com janela curta e
  frequência baixa (preferência), ou migramos para WhatsApp Cloud API
  oficial com opt-in explícito por canal. **Decisão pendente do board.**
- **Sem testes automatizados nesta entrega.** ROGA-Tests (Onda 3) cobre
  isso — adicionar caso `handleIncomingMessage("SAIR") → blacklist + reply
  + lead Perdido` quando aquela issue rodar.

## Critérios de aceite (verificados nesta entrega)

- [x] Cliente respondendo "SAIR" entra em `phone_blacklist` na mesma
      chamada do handler (síncrono — não há fila intermediária).
- [x] Resposta de confirmação é enviada via Baileys + persistida em
      `chat_messages` como `direction='out'`.
- [x] Lead marcado `Perdido` (com guarda contra regressão de `Fechado`).
- [x] `crm_history` registra `opt_out` no recebimento e
      `dispatch_blocked_opt_out` se houver tentativa posterior de envio.
- [x] Próximo disparo para esse telefone é bloqueado (`dispatch.ts`
      verifica `phone_blacklist` antes de chamar `sock.sendMessage`).
- [x] Texto de confirmação e lista de keywords são **configuráveis** em
      `system_settings` — COO consegue ajustar sem deploy.
