#!/usr/bin/env node
/**
 * ROGA-53 / ROGA-36.3
 * Backfill: link chat_conversations -> crm_leads, criar leads ausentes,
 * e popular crm_history (type='inbox_message') a partir das ultimas N
 * chat_messages por conversa.
 *
 * Uso:
 *   npm run backfill:inbox -- --dry-run
 *   npm run backfill:inbox -- --apply --batch-size=500 --history-per-conv=50
 *
 * Requer:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (admin client; mesmo padrao de src/lib/server/supabase-admin.ts)
 *
 * Dependencias de schema:
 *   - ROGA-36.1 / migration 011_inbox_crm_link.sql:
 *     - chat_conversations.lead_id
 *     - crm_history.source_message_id (unique parcial)
 *   - ROGA-36.2 / migration 013_crm_history_metadata.sql:
 *     - crm_history.metadata (jsonb)
 *   - migration 008:
 *     - crm_leads.phone_normalized (unique parcial)
 *
 * NOTA importante sobre o schema real (003/008):
 *   chat_conversations NAO tem phone_normalized, display_name nem
 *   whatsapp_account_id. Tem: id, account_id, contact_jid, contact_name,
 *   lead_id. O phone_normalized e derivado de contact_jid via
 *   regex (mesmo padrao do trigger ensure_lead_for_conversation).
 *   account_id e usado como whatsapp_account_id no crm_leads/crm_history.
 *
 * Saidas:
 *   - Imprime resumo por fase e ao final cobertura (%).
 *   - Exit 0 se cobertura >= 95%, senao 1.
 *   - --dry-run nunca grava (transacoes simuladas; SELECTs reais).
 *   - Rerun de --apply e no-op (idempotente em todas as fases).
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------- args ----------

type Args = {
  apply: boolean;
  dryRun: boolean;
  batchSize: number;
  historyPerConv: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    dryRun: true,
    batchSize: 500,
    historyPerConv: 50,
  };
  for (const raw of argv) {
    if (raw === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (raw === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
    } else if (raw.startsWith("--batch-size=")) {
      const v = Number(raw.split("=")[1]);
      if (!Number.isFinite(v) || v <= 0) {
        throw new Error(`--batch-size invalido: ${raw}`);
      }
      args.batchSize = Math.floor(v);
    } else if (raw.startsWith("--history-per-conv=")) {
      const v = Number(raw.split("=")[1]);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`--history-per-conv invalido: ${raw}`);
      }
      args.historyPerConv = Math.floor(v);
    } else if (raw === "-h" || raw === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`flag desconhecida: ${raw}`);
    }
  }
  return args;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "backfill_inbox_lead_link.ts",
      "",
      "Flags:",
      "  --dry-run                  default; nao grava, so calcula",
      "  --apply                    aplica writes (Fases A/B/C)",
      "  --batch-size=N             default 500",
      "  --history-per-conv=N       default 50",
      "",
      "Env:",
      "  NEXT_PUBLIC_SUPABASE_URL",
      "  SUPABASE_SERVICE_ROLE_KEY",
    ].join("\n"),
  );
}

// ---------- supabase ----------

function makeSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL nao configurado");
  }
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurado");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------- helpers ----------

function normalizeJidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const local = jid.split("@")[0] ?? jid;
  const digits = local.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

type ChatConversation = {
  id: string;
  account_id: string | null;
  contact_jid: string | null;
  contact_name: string | null;
  lead_id: string | null;
};

type ChatMessage = {
  id: string;
  conversation_id: string;
  direction: "in" | "out";
  body: string | null;
  type: string;
  // timestamp column is reserved word; we order by created_at desc (close enough; both monotonic per conv)
  created_at: string;
};

type CrmLeadRow = {
  id: string;
  phone_normalized: string | null;
};

// Chunk an array into batches.
function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- counters ----------

type Stats = {
  totalConversations: number;
  conversationsWithJid: number;
  alreadyLinked: number;
  // Phase A:
  phaseAScanned: number;
  phaseALinked: number; // conversations matched to an existing lead
  // Phase B:
  phaseBLeadsCreated: number;
  phaseBLinked: number; // conversations linked after creation
  // Phase C:
  phaseCHistoryInserted: number;
  phaseCMessagesScanned: number;
  // Coverage:
  conversationsResolved: number; // with lead_id at end
};

function emptyStats(): Stats {
  return {
    totalConversations: 0,
    conversationsWithJid: 0,
    alreadyLinked: 0,
    phaseAScanned: 0,
    phaseALinked: 0,
    phaseBLeadsCreated: 0,
    phaseBLinked: 0,
    phaseCHistoryInserted: 0,
    phaseCMessagesScanned: 0,
    conversationsResolved: 0,
  };
}

// ---------- phases ----------

/**
 * Fase A: para cada conversa com lead_id NULL e contact_jid normalizavel,
 * tentar achar crm_leads.id por phone_normalized e UPDATE chat_conversations.lead_id.
 * Cursor: id > last_id, lotes de batchSize.
 */
async function phaseA(
  sb: SupabaseClient,
  args: Args,
  stats: Stats,
): Promise<void> {
  log(`[A] iniciando link por phone_normalized (batch=${args.batchSize}, dryRun=${args.dryRun})`);

  let lastId = "00000000-0000-0000-0000-000000000000";
  // Loop de cursores ate esgotar.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: convs, error } = await sb
      .from("chat_conversations")
      .select("id, account_id, contact_jid, contact_name, lead_id")
      .is("lead_id", null)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(args.batchSize);
    if (error) throw new Error(`[A] select chat_conversations: ${error.message}`);
    if (!convs || convs.length === 0) break;

    stats.phaseAScanned += convs.length;
    lastId = convs[convs.length - 1].id;

    // Coletar telefones normalizados unicos para um lookup batched.
    const convosWithPhone: Array<{ conv: ChatConversation; phone: string }> = [];
    for (const c of convs as ChatConversation[]) {
      const phone = normalizeJidToPhone(c.contact_jid);
      if (phone) convosWithPhone.push({ conv: c, phone });
    }
    if (convosWithPhone.length === 0) continue;

    const uniquePhones = Array.from(new Set(convosWithPhone.map((x) => x.phone)));
    const { data: leads, error: leadsErr } = await sb
      .from("crm_leads")
      .select("id, phone_normalized")
      .in("phone_normalized", uniquePhones);
    if (leadsErr) throw new Error(`[A] select crm_leads: ${leadsErr.message}`);

    const phoneToLeadId = new Map<string, string>();
    for (const l of (leads ?? []) as CrmLeadRow[]) {
      if (l.phone_normalized && !phoneToLeadId.has(l.phone_normalized)) {
        phoneToLeadId.set(l.phone_normalized, l.id);
      }
    }

    const toLink: Array<{ id: string; lead_id: string }> = [];
    for (const { conv, phone } of convosWithPhone) {
      const leadId = phoneToLeadId.get(phone);
      if (leadId) toLink.push({ id: conv.id, lead_id: leadId });
    }

    stats.phaseALinked += toLink.length;
    if (toLink.length === 0) continue;

    if (!args.dryRun) {
      // Updates individuais (lotinho de 500). Supabase JS nao tem UPDATE...FROM,
      // mas e backfill, executado raramente; performance e suficiente.
      // Para reduzir round-trips, faz em paralelo limitado.
      await runWithConcurrency(toLink, 16, async (row) => {
        const { error: updErr } = await sb
          .from("chat_conversations")
          .update({ lead_id: row.lead_id })
          .eq("id", row.id)
          .is("lead_id", null);
        if (updErr) {
          throw new Error(`[A] update conv ${row.id}: ${updErr.message}`);
        }
      });
    }

    log(`[A] lote: scanned=${convs.length} matched=${toLink.length} cursor=${lastId}`);
  }
  log(
    `[A] concluida — escaneadas=${stats.phaseAScanned} linkadas=${stats.phaseALinked}`,
  );
}

/**
 * Fase B: para conversas restantes (lead_id ainda NULL) com phone normalizavel,
 * criar crm_leads e amarrar lead_id. Lotes de batchSize.
 */
async function phaseB(
  sb: SupabaseClient,
  args: Args,
  stats: Stats,
): Promise<void> {
  log(`[B] iniciando criacao de leads para conversas orfas (batch=${args.batchSize})`);

  let lastId = "00000000-0000-0000-0000-000000000000";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: convs, error } = await sb
      .from("chat_conversations")
      .select("id, account_id, contact_jid, contact_name, lead_id")
      .is("lead_id", null)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(args.batchSize);
    if (error) throw new Error(`[B] select chat_conversations: ${error.message}`);
    if (!convs || convs.length === 0) break;

    lastId = convs[convs.length - 1].id;

    const candidates: Array<{ conv: ChatConversation; phone: string }> = [];
    for (const c of convs as ChatConversation[]) {
      const phone = normalizeJidToPhone(c.contact_jid);
      if (phone) candidates.push({ conv: c, phone });
    }
    if (candidates.length === 0) continue;

    if (args.dryRun) {
      // Em dry-run, assumimos que TODAS as conversas candidatas iriam virar lead.
      // Pode contar duplicado se duas conversas compartilham o mesmo phone,
      // entao deduplicamos por phone para o numero de leads "que seriam criados".
      const uniquePhones = new Set(candidates.map((x) => x.phone));
      stats.phaseBLeadsCreated += uniquePhones.size;
      stats.phaseBLinked += candidates.length;
      log(`[B] lote (dry): seriam criados ${uniquePhones.size} leads e linkadas ${candidates.length} convs`);
      continue;
    }

    // Em apply: agrupa por phone para nao tentar criar o mesmo lead 2x dentro do lote.
    const byPhone = new Map<string, { phone: string; account_id: string | null; name: string }>();
    for (const { conv, phone } of candidates) {
      if (!byPhone.has(phone)) {
        byPhone.set(phone, {
          phone,
          account_id: conv.account_id,
          name: conv.contact_name?.trim() || phone,
        });
      }
    }

    // Upsert por phone_normalized (unique parcial). O ON CONFLICT do trigger usa
    // o mesmo indice; supabase-js usa upsert com onConflict.
    const insertRows = Array.from(byPhone.values()).map((x) => ({
      name: x.name,
      phone: x.phone,
      phone_normalized: x.phone,
      origin: "inbox",
      status: "Novo Lead",
      whatsapp_account_id: x.account_id,
    }));

    // Lotes de 500 ja garantidos pelo cursor; aqui apenas upsert em uma chamada.
    const { data: upserted, error: upErr } = await sb
      .from("crm_leads")
      .upsert(insertRows, { onConflict: "phone_normalized", ignoreDuplicates: false })
      .select("id, phone_normalized");
    if (upErr) throw new Error(`[B] upsert crm_leads: ${upErr.message}`);

    const phoneToLeadId = new Map<string, string>();
    for (const l of (upserted ?? []) as CrmLeadRow[]) {
      if (l.phone_normalized) phoneToLeadId.set(l.phone_normalized, l.id);
    }
    // Caso o upsert volte sem linhas (raro com select()), buscar explicitamente.
    if (phoneToLeadId.size < byPhone.size) {
      const missing = Array.from(byPhone.keys()).filter((p) => !phoneToLeadId.has(p));
      if (missing.length > 0) {
        const { data: foundLeads, error: lkErr } = await sb
          .from("crm_leads")
          .select("id, phone_normalized")
          .in("phone_normalized", missing);
        if (lkErr) throw new Error(`[B] relookup crm_leads: ${lkErr.message}`);
        for (const l of (foundLeads ?? []) as CrmLeadRow[]) {
          if (l.phone_normalized) phoneToLeadId.set(l.phone_normalized, l.id);
        }
      }
    }

    // Contagem: leads efetivamente criados nesse lote
    // (heuristica: numero de phones unicos que nao existiam antes).
    // Sem coluna de "created vs existing" precisa, contamos o tamanho do upsert.
    // Para idempotencia em reruns, isso vai inflar; aceitavel para o sumario.
    stats.phaseBLeadsCreated += upserted?.length ?? insertRows.length;

    // Agora amarra cada conversa ao lead correspondente.
    let linked = 0;
    await runWithConcurrency(candidates, 16, async ({ conv, phone }) => {
      const leadId = phoneToLeadId.get(phone);
      if (!leadId) return;
      const { error: updErr } = await sb
        .from("chat_conversations")
        .update({ lead_id: leadId })
        .eq("id", conv.id)
        .is("lead_id", null);
      if (updErr) throw new Error(`[B] update conv ${conv.id}: ${updErr.message}`);
      linked += 1;
    });
    stats.phaseBLinked += linked;
    log(`[B] lote: leads_no_upsert=${upserted?.length ?? 0} convs_linkadas=${linked} cursor=${lastId}`);
  }

  log(
    `[B] concluida — leads_criados~=${stats.phaseBLeadsCreated} conversas_linkadas=${stats.phaseBLinked}`,
  );
}

/**
 * Fase C: para cada conversa com lead_id resolvido, le as ultimas N chat_messages
 * (ordenadas por created_at DESC) e insere crm_history (type='inbox_message',
 * source_message_id=msg.id). Idempotente via unique parcial.
 */
async function phaseC(
  sb: SupabaseClient,
  args: Args,
  stats: Stats,
): Promise<void> {
  if (args.historyPerConv === 0) {
    log(`[C] pulada (history-per-conv=0)`);
    return;
  }
  log(`[C] iniciando backfill crm_history (history-per-conv=${args.historyPerConv})`);

  let lastId = "00000000-0000-0000-0000-000000000000";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data: convs, error } = await sb
      .from("chat_conversations")
      .select("id, account_id, contact_jid, lead_id")
      .not("lead_id", "is", null)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(args.batchSize);
    if (error) throw new Error(`[C] select chat_conversations: ${error.message}`);
    if (!convs || convs.length === 0) break;
    lastId = convs[convs.length - 1].id;

    // Para cada conversa, busca as ultimas N mensagens.
    // Processamento em paralelo limitado para reduzir wall-clock.
    await runWithConcurrency(convs, 8, async (c: any) => {
      const { data: msgs, error: msgsErr } = await sb
        .from("chat_messages")
        .select("id, conversation_id, direction, body, type, created_at")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(args.historyPerConv);
      if (msgsErr) throw new Error(`[C] select chat_messages ${c.id}: ${msgsErr.message}`);
      if (!msgs || msgs.length === 0) return;
      stats.phaseCMessagesScanned += msgs.length;

      // Idempotencia: verifica quais source_message_id ja existem em crm_history.
      const ids = (msgs as ChatMessage[]).map((m) => m.id);
      const { data: existing, error: exErr } = await sb
        .from("crm_history")
        .select("source_message_id")
        .in("source_message_id", ids);
      if (exErr) throw new Error(`[C] select crm_history existentes: ${exErr.message}`);
      const seen = new Set<string>(
        ((existing ?? []) as Array<{ source_message_id: string | null }>)
          .map((r) => r.source_message_id)
          .filter((v): v is string => !!v),
      );

      const rows = (msgs as ChatMessage[])
        .filter((m) => !seen.has(m.id))
        .map((m) => ({
          lead_id: c.lead_id as string,
          type: "inbox_message",
          // `message` (NOT NULL no schema 003) recebe um preview legivel;
          // o JSON estruturado vai na coluna `metadata` (jsonb), adicionada
          // pela migration 013_crm_history_metadata.sql (ROGA-36.2).
          message: m.body ?? "",
          metadata: {
            direction: m.direction,
            backfilled: true,
            msg_type: m.type,
            chat_message_id: m.id,
          },
          source_message_id: m.id,
          whatsapp_account_id: c.account_id,
          created_at: m.created_at,
        }));

      if (rows.length === 0) return;

      if (args.dryRun) {
        stats.phaseCHistoryInserted += rows.length;
        return;
      }

      // ON CONFLICT no source_message_id (unique parcial); usamos upsert.
      const { error: insErr } = await sb
        .from("crm_history")
        .upsert(rows, { onConflict: "source_message_id", ignoreDuplicates: true });
      if (insErr) throw new Error(`[C] upsert crm_history ${c.id}: ${insErr.message}`);

      stats.phaseCHistoryInserted += rows.length;
    });

    log(`[C] lote: convs=${convs.length} cursor=${lastId} historico_acum=${stats.phaseCHistoryInserted}`);
  }
  log(
    `[C] concluida — historicos_inseridos=${stats.phaseCHistoryInserted} mensagens_lidas=${stats.phaseCMessagesScanned}`,
  );
}

// ---------- coverage ----------

async function computeBaselineCounts(sb: SupabaseClient, stats: Stats): Promise<void> {
  const total = await countTable(sb, "chat_conversations", null);
  stats.totalConversations = total;

  const linked = await countTable(sb, "chat_conversations", (q) => q.not("lead_id", "is", null));
  stats.alreadyLinked = linked;

  // conversations with parseable phone (proxy: contact_jid contains '@' and digits)
  // Sem coluna phone_normalized, usamos contact_jid IS NOT NULL como aproximacao.
  const withJid = await countTable(sb, "chat_conversations", (q) => q.not("contact_jid", "is", null));
  stats.conversationsWithJid = withJid;
}

async function recomputeResolved(sb: SupabaseClient, stats: Stats): Promise<void> {
  stats.conversationsResolved = await countTable(sb, "chat_conversations", (q) =>
    q.not("lead_id", "is", null),
  );
}

async function countTable(
  sb: SupabaseClient,
  table: string,
  filter: ((q: any) => any) | null,
): Promise<number> {
  let q: any = sb.from(table).select("id", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return count ?? 0;
}

// ---------- util ----------

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const runners: Promise<void>[] = [];
  const n = Math.max(1, Math.min(concurrency, queue.length));
  for (let i = 0; i < n; i++) {
    runners.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item === undefined) return;
          await worker(item);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[${nowIso()}] ${msg}`);
}

// ---------- main ----------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  log(
    `start mode=${args.apply ? "APPLY" : "DRY-RUN"} batch=${args.batchSize} historyPerConv=${args.historyPerConv}`,
  );

  const sb = makeSupabase();
  const stats = emptyStats();

  await computeBaselineCounts(sb, stats);
  log(
    `baseline — total=${stats.totalConversations} ja_linkadas=${stats.alreadyLinked} com_jid=${stats.conversationsWithJid}`,
  );

  await phaseA(sb, args, stats);
  await phaseB(sb, args, stats);
  await phaseC(sb, args, stats);

  if (args.apply) {
    await recomputeResolved(sb, stats);
  } else {
    // Em dry-run, estimamos resolved = already + would-be-linked.
    stats.conversationsResolved =
      stats.alreadyLinked + stats.phaseALinked + stats.phaseBLinked;
  }

  const denom = stats.conversationsWithJid > 0 ? stats.conversationsWithJid : stats.totalConversations;
  const coverage = denom === 0 ? 1 : stats.conversationsResolved / denom;
  const coveragePct = (coverage * 100).toFixed(2);

  // eslint-disable-next-line no-console
  console.log("");
  log("===== RESUMO =====");
  log(`modo:                       ${args.apply ? "APPLY" : "DRY-RUN"}`);
  log(`total_conversas:            ${stats.totalConversations}`);
  log(`com_contact_jid:            ${stats.conversationsWithJid}`);
  log(`ja_linkadas (baseline):     ${stats.alreadyLinked}`);
  log(`fase_A_scaneadas:           ${stats.phaseAScanned}`);
  log(`fase_A_linkadas:            ${stats.phaseALinked}`);
  log(`fase_B_leads_criados~:      ${stats.phaseBLeadsCreated}`);
  log(`fase_B_convs_linkadas:      ${stats.phaseBLinked}`);
  log(`fase_C_msgs_escaneadas:     ${stats.phaseCMessagesScanned}`);
  log(`fase_C_historicos_inserts:  ${stats.phaseCHistoryInserted}`);
  log(`conversas_resolvidas_final: ${stats.conversationsResolved}`);
  log(`cobertura:                  ${coveragePct}% (denom=${denom})`);
  log("==================");

  return coverage >= 0.95 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`FATAL: ${err?.message ?? err}`);
    if (err?.stack) {
      // eslint-disable-next-line no-console
      console.error(err.stack);
    }
    process.exit(2);
  });
