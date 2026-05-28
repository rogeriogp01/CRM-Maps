/**
 * Inbox WhatsApp — handler de mensagens recebidas via Baileys.
 *
 * Chamado pelo listener `messages.upsert` registrado em whatsapp-manager.ts.
 * Responsável por:
 *  - Persistir a mensagem em chat_messages (incoming OU outgoing, via fromMe).
 *  - Find-or-create da conversa em chat_conversations.
 *  - Find-or-create do lead em crm_leads (status "Novo Lead" se for novo).
 *  - Auto-move "Primeiro Contato" → "Respondeu" SOMENTE na primeira resposta do lead.
 *  - Atualizar last_message_at, preview, unread_count.
 *
 * Idempotente: usa upsert em (conversation_id, baileys_message_id), então
 * o echo do envio (POST /api/inbox/.../messages emite + messages.upsert ecoa)
 * resulta em uma única linha.
 */

import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { normalizePhone, appendCrmHistory } from "@/lib/crm";
import {
  getSystemSettings,
  matchesOptOut,
  DEFAULT_OPT_OUT_KEYWORDS,
  DEFAULT_OPT_OUT_CONFIRMATION,
} from "@/lib/server/system-settings";

type IncomingMsgType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "unknown";

const PREVIEW_MAX = 80;

function parsePhoneFromJid(jid: string): string {
  // jid pode vir como "5511999999999@s.whatsapp.net" ou "...@c.us"
  const firstPart = jid.split(":")[0];
  return firstPart.split("@")[0] ?? "";
}

function detectType(message: any): {
  type: IncomingMsgType;
  body: string | null;
  mediaKey: string | null; // chave do objeto Baileys onde está a mídia
  mime: string | null;
} {
  if (!message) return { type: "unknown", body: null, mediaKey: null, mime: null };

  if (typeof message.conversation === "string") {
    return { type: "text", body: message.conversation, mediaKey: null, mime: null };
  }
  if (message.extendedTextMessage?.text) {
    return {
      type: "text",
      body: message.extendedTextMessage.text,
      mediaKey: null,
      mime: null,
    };
  }
  if (message.imageMessage) {
    return {
      type: "image",
      body: message.imageMessage.caption ?? null,
      mediaKey: "imageMessage",
      mime: message.imageMessage.mimetype ?? "image/jpeg",
    };
  }
  if (message.audioMessage) {
    return {
      type: "audio",
      body: null,
      mediaKey: "audioMessage",
      mime: message.audioMessage.mimetype ?? "audio/ogg",
    };
  }
  if (message.videoMessage) {
    return {
      type: "video",
      body: message.videoMessage.caption ?? null,
      mediaKey: "videoMessage",
      mime: message.videoMessage.mimetype ?? "video/mp4",
    };
  }
  if (message.documentMessage) {
    return {
      type: "document",
      body: message.documentMessage.fileName ?? null,
      mediaKey: "documentMessage",
      mime: message.documentMessage.mimetype ?? "application/octet-stream",
    };
  }
  if (message.stickerMessage) {
    return { type: "sticker", body: null, mediaKey: "stickerMessage", mime: "image/webp" };
  }
  return { type: "unknown", body: null, mediaKey: null, mime: null };
}

function extensionForMime(mime: string | null): string {
  if (!mime) return "bin";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("pdf")) return "pdf";
  const slash = mime.indexOf("/");
  if (slash >= 0) return mime.slice(slash + 1).split(";")[0] || "bin";
  return "bin";
}

function previewFor(type: IncomingMsgType, body: string | null): string {
  if (body && body.trim() !== "") {
    return body.trim().slice(0, PREVIEW_MAX);
  }
  switch (type) {
    case "image":
      return "[imagem]";
    case "audio":
      return "[áudio]";
    case "video":
      return "[vídeo]";
    case "document":
      return "[documento]";
    case "sticker":
      return "[figurinha]";
    default:
      return "[mensagem]";
  }
}

/**
 * Find-or-create conversa por (account_id, contact_jid).
 * Atualiza contact_name se ele estava vazio e veio pushName novo.
 */
async function findOrCreateConversation(
  accountId: string,
  jid: string,
  pushName: string | null
): Promise<string> {
  // 1) tenta encontrar
  const { data: existing } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_name")
    .eq("account_id", accountId)
    .eq("contact_jid", jid)
    .maybeSingle();

  if (existing?.id) {
    if (!existing.contact_name && pushName) {
      await supabaseAdmin
        .from("chat_conversations")
        .update({ contact_name: pushName, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return existing.id;
  }

  // 2) cria
  const { data: created, error } = await supabaseAdmin
    .from("chat_conversations")
    .insert({
      account_id: accountId,
      contact_jid: jid,
      contact_name: pushName,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Falha ao criar conversa: ${error?.message ?? "unknown"}`);
  }
  return created.id;
}

/**
 * Find-or-create lead no CRM por phone_normalized.
 * Retorna { leadId, wasCreated, currentStatus }.
 */
async function findOrCreateLead(
  phoneNormalized: string,
  pushName: string | null,
  accountId: string
): Promise<{ leadId: string; wasCreated: boolean; currentStatus: string } | null> {
  if (!phoneNormalized || phoneNormalized.length < 8) return null;

  const { data: existing } = await supabaseAdmin
    .from("crm_leads")
    .select("id, status")
    .eq("phone_normalized", phoneNormalized)
    .maybeSingle();

  if (existing?.id) {
    return { leadId: existing.id, wasCreated: false, currentStatus: existing.status };
  }

  // Cria em "Novo Lead"
  const { data: created, error } = await supabaseAdmin
    .from("crm_leads")
    .insert({
      name: pushName ?? phoneNormalized,
      phone: phoneNormalized,
      phone_normalized: phoneNormalized,
      origin: "whatsapp_inbox",
      status: "Novo Lead",
      whatsapp_account_id: accountId,
      last_interaction_at: new Date().toISOString(),
    })
    .select("id, status")
    .single();

  if (error || !created) {
    console.error("[inbox] failed to create lead:", error?.message);
    return null;
  }

  await appendCrmHistory({
    lead_id: created.id,
    type: "lead_created",
    message: "Lead criado automaticamente pelo Inbox (primeira mensagem recebida)",
    whatsapp_account_id: accountId,
  });

  return { leadId: created.id, wasCreated: true, currentStatus: created.status };
}

/**
 * Sobe mídia para o bucket chat-media e devolve URL pública.
 * Retorna null em caso de falha — a mensagem é salva sem media_url.
 */
async function uploadMedia(params: {
  accountId: string;
  messageId: string;
  buffer: Buffer;
  mime: string;
}): Promise<string | null> {
  try {
    const ext = extensionForMime(params.mime);
    const safeId = params.messageId.replace(/[^A-Za-z0-9_-]/g, "_");
    const path = `${params.accountId}/${safeId}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("chat-media")
      .upload(path, params.buffer, {
        contentType: params.mime,
        upsert: true,
      });
    if (upErr) {
      console.error("[inbox] upload media failed:", upErr.message);
      return null;
    }

    const { data: pub } = supabaseAdmin.storage.from("chat-media").getPublicUrl(path);
    return pub?.publicUrl ?? null;
  } catch (err) {
    console.error("[inbox] uploadMedia exception:", err);
    return null;
  }
}

/**
 * Verifica se já existe alguma mensagem INCOMING anterior nessa conversa.
 * Usado para a guarda one-shot do auto-move "Primeiro Contato → Respondeu".
 */
async function hasPreviousIncoming(conversationId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/**
 * ROGA-42 — Opt-out automático.
 *
 * Quando um contato envia uma palavra-chave de opt-out (SAIR/STOP/PARAR/
 * DESCADASTRAR, ou o que estiver em system_settings.opt_out_keywords):
 *
 *   1. Insere o telefone em phone_blacklist (idempotente).
 *   2. Responde com a mensagem de confirmação configurada.
 *   3. Marca o lead correspondente como "Perdido" e grava histórico.
 *
 * Falhas internas são logadas e silenciadas — opt-out é best-effort por
 * mensagem; o dispatcher já consulta a blacklist no envio seguinte
 * (dispatch.ts → isBlacklisted).
 *
 * Retorna true se o opt-out foi acionado (mesmo que algum passo
 * secundário tenha falhado — a INTENÇÃO foi processada).
 */
async function handleOptOut(params: {
  accountId: string;
  sock: any;
  jid: string;
  phoneNormalized: string;
  body: string | null;
  conversationId: string;
  leadId: string | null;
  timestampIso: string;
}): Promise<boolean> {
  if (!params.body || params.body.trim() === "") return false;
  if (!params.phoneNormalized || params.phoneNormalized.length < 8) return false;

  let keywords: readonly string[] = DEFAULT_OPT_OUT_KEYWORDS;
  let confirmation = DEFAULT_OPT_OUT_CONFIRMATION;
  try {
    const settings = await getSystemSettings();
    keywords = settings.opt_out_keywords;
    confirmation = settings.opt_out_confirmation_message;
  } catch (err) {
    console.error("[inbox] opt-out: getSystemSettings failed, using defaults:", err);
  }

  const match = matchesOptOut(params.body, keywords);
  if (!match.matched) return false;

  console.info(
    `[inbox] opt-out triggered for ${params.phoneNormalized} (keyword=${match.keyword})`
  );

  try {
    const { error: blErr } = await supabaseAdmin
      .from("phone_blacklist")
      .upsert(
        {
          phone_normalized: params.phoneNormalized,
          reason: "auto_opt_out",
        },
        { onConflict: "phone_normalized", ignoreDuplicates: true }
      );
    if (blErr) {
      console.error("[inbox] opt-out: blacklist upsert failed:", blErr.message);
    }
  } catch (err) {
    console.error("[inbox] opt-out: blacklist exception:", err);
  }

  try {
    if (params.sock && typeof params.sock.sendMessage === "function") {
      const sendResult = await params.sock.sendMessage(params.jid, {
        text: confirmation,
      });
      const outMessageId: string | null =
        sendResult && typeof sendResult === "object" && "key" in sendResult
          ? (sendResult as { key?: { id?: string } }).key?.id ?? null
          : null;

      if (outMessageId) {
        await recordOutgoingMessage({
          conversationId: params.conversationId,
          baileysMessageId: outMessageId,
          type: "text",
          body: confirmation,
          mediaUrl: null,
          mediaMime: null,
          timestampMs: Date.now(),
        }).catch((err) =>
          console.error("[inbox] opt-out: recordOutgoingMessage failed:", err)
        );
      }
    }
  } catch (err) {
    console.error("[inbox] opt-out: send confirmation failed:", err);
  }

  if (params.leadId) {
    try {
      const { data: leadRow } = await supabaseAdmin
        .from("crm_leads")
        .select("status")
        .eq("id", params.leadId)
        .maybeSingle();
      const currentStatus = leadRow?.status ?? null;

      if (currentStatus !== "Fechado" && currentStatus !== "Perdido") {
        const { error: updErr } = await supabaseAdmin
          .from("crm_leads")
          .update({
            status: "Perdido",
            last_interaction_at: params.timestampIso,
            updated_at: new Date().toISOString(),
          })
          .eq("id", params.leadId);
        if (updErr) {
          console.error("[inbox] opt-out: lead update failed:", updErr.message);
        }
      } else {
        await supabaseAdmin
          .from("crm_leads")
          .update({
            last_interaction_at: params.timestampIso,
            updated_at: new Date().toISOString(),
          })
          .eq("id", params.leadId);
      }

      await appendCrmHistory({
        lead_id: params.leadId,
        type: "opt_out",
        message: `Cliente solicitou opt-out via palavra-chave "${match.keyword}". Telefone adicionado à blacklist (reason=auto_opt_out).`,
        whatsapp_account_id: params.accountId,
      });
    } catch (err) {
      console.error("[inbox] opt-out: lead/history update failed:", err);
    }
  }

  return true;
}

/**
 * Handler principal — chamado pelo listener messages.upsert.
 * Faz catch interno para nunca derrubar o socket.
 */
export async function handleIncomingMessage(
  accountId: string,
  sock: any,
  msg: any
): Promise<void> {
  try {
    const jid: string | undefined = msg?.key?.remoteJid;
    if (!jid) return;

    // Filtro: grupos e status broadcast já são filtrados no whatsapp-manager,
    // mas reforçamos aqui em caso de chamada direta.
    if (jid.endsWith("@g.us") || jid === "status@broadcast") return;

    const fromMe: boolean = !!msg?.key?.fromMe;
    const messageId: string | undefined = msg?.key?.id;
    if (!messageId) return;

    const pushName: string | null = msg?.pushName ?? null;
    const tsSeconds =
      typeof msg?.messageTimestamp === "number"
        ? msg.messageTimestamp
        : typeof msg?.messageTimestamp?.toNumber === "function"
          ? msg.messageTimestamp.toNumber()
          : Math.floor(Date.now() / 1000);
    const timestampIso = new Date(tsSeconds * 1000).toISOString();

    const { type, body, mediaKey, mime } = detectType(msg.message);

    // Tipo "unknown" sem conteúdo — provavelmente protocolo (reaction, receipt, etc).
    // Ignoramos para não poluir o histórico. Mas só ignoramos se ABSOLUTAMENTE
    // não houver body/media; assim ainda capturamos casos de borda.
    if (type === "unknown" && !body && !mediaKey) return;

    // 1) Conversa
    const conversationId = await findOrCreateConversation(accountId, jid, pushName);

    // 2) Mídia (só se for um tipo com mediaKey e socket disponível)
    let mediaUrl: string | null = null;
    if (mediaKey && sock) {
      try {
        // Baileys: downloadMediaMessage é exportado do pacote.
        const baileys = await import("@whiskeysockets/baileys");
        const downloadMediaMessage = (baileys as any).downloadMediaMessage;
        if (typeof downloadMediaMessage === "function") {
          const buffer: Buffer = await downloadMediaMessage(msg, "buffer", {});
          if (buffer && buffer.length > 0) {
            mediaUrl = await uploadMedia({
              accountId,
              messageId,
              buffer,
              mime: mime ?? "application/octet-stream",
            });
          }
        }
      } catch (err) {
        console.error("[inbox] download media failed:", err);
      }
    }

    // 3) Upsert da mensagem (dedupe outgoing echo)
    const { error: upsertErr } = await supabaseAdmin
      .from("chat_messages")
      .upsert(
        {
          conversation_id: conversationId,
          baileys_message_id: messageId,
          direction: fromMe ? "out" : "in",
          from_me: fromMe,
          type,
          body,
          media_url: mediaUrl,
          media_mime: mime,
          status: fromMe ? "sent" : null,
          timestamp: timestampIso,
        },
        { onConflict: "conversation_id,baileys_message_id", ignoreDuplicates: false }
      );
    if (upsertErr) {
      console.error("[inbox] upsert message failed:", upsertErr.message);
      return;
    }

    // 4) Atualiza preview/last_message_at; incrementa unread só se !fromMe.
    // Buscar unread_count atual para incrementar (Supabase não tem expressão raw fácil).
    const previewText = previewFor(type, body);

    if (!fromMe) {
      const { data: convRow } = await supabaseAdmin
        .from("chat_conversations")
        .select("unread_count")
        .eq("id", conversationId)
        .single();
      const currentUnread = convRow?.unread_count ?? 0;

      await supabaseAdmin
        .from("chat_conversations")
        .update({
          last_message_at: timestampIso,
          last_message_preview: previewText,
          unread_count: currentUnread + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
    } else {
      await supabaseAdmin
        .from("chat_conversations")
        .update({
          last_message_at: timestampIso,
          last_message_preview: previewText,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId);
    }

    // 5) Sync CRM + opt-out: SOMENTE para mensagens recebidas (incoming).
    //    Outgoing echo não toca no CRM (o disparador e a rota POST já fazem o sync).
    if (!fromMe) {
      const phoneNormalized = normalizePhone(parsePhoneFromJid(jid));
      const leadResult = await findOrCreateLead(phoneNormalized, pushName, accountId);

      if (leadResult) {
        // Link conversa -> lead (se ainda não estiver)
        await supabaseAdmin
          .from("chat_conversations")
          .update({ lead_id: leadResult.leadId, updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .is("lead_id", null);
      }

      // 5.a) ROGA-42 — Opt-out automático.
      //
      // Roda ANTES da progressão de estágio "Primeiro Contato → Respondeu"
      // para que um lead que peça SAIR não seja erroneamente marcado como
      // "Respondeu". Se o opt-out for acionado, encerramos o sync de CRM
      // aqui: handleOptOut() já marcou o lead como "Perdido" e gravou o
      // histórico apropriado.
      const optedOut =
        type === "text"
          ? await handleOptOut({
              accountId,
              sock,
              jid,
              phoneNormalized,
              body,
              conversationId,
              leadId: leadResult?.leadId ?? null,
              timestampIso,
            })
          : false;

      if (!optedOut && leadResult) {
        // Auto-move: Primeiro Contato -> Respondeu, só na PRIMEIRA resposta.
        // Guarda: lead atual = "Primeiro Contato" E ainda não há outra incoming
        // anterior nessa conversa (a INSERT acima ainda não conta porque foi
        // feita logo antes — vamos verificar contando todas incoming).
        if (
          !leadResult.wasCreated &&
          leadResult.currentStatus === "Primeiro Contato"
        ) {
          // Conta quantas incoming existem nessa conversa.
          const { count } = await supabaseAdmin
            .from("chat_messages")
            .select("id", { count: "exact", head: true })
            .eq("conversation_id", conversationId)
            .eq("direction", "in");

          // Se count === 1, a única incoming é a que acabamos de inserir.
          if ((count ?? 0) <= 1) {
            const { error: stageErr } = await supabaseAdmin
              .from("crm_leads")
              .update({
                status: "Respondeu",
                last_interaction_at: timestampIso,
                updated_at: new Date().toISOString(),
              })
              .eq("id", leadResult.leadId)
              .eq("status", "Primeiro Contato"); // guarda extra contra race

            if (!stageErr) {
              await appendCrmHistory({
                lead_id: leadResult.leadId,
                type: "stage_change",
                message: "Auto: Primeiro Contato → Respondeu",
                whatsapp_account_id: accountId,
              });
            }
          }
        } else {
          // Atualiza last_interaction_at do lead (sem mexer no status)
          await supabaseAdmin
            .from("crm_leads")
            .update({
              last_interaction_at: timestampIso,
              updated_at: new Date().toISOString(),
            })
            .eq("id", leadResult.leadId);
        }
      }
    }
  } catch (err) {
    console.error("[inbox] handleIncomingMessage failed:", err);
  }
}

// Helper exportado para a rota POST registrar mensagem outgoing
// imediatamente após sock.sendMessage (antes do echo do messages.upsert).
export async function recordOutgoingMessage(params: {
  conversationId: string;
  baileysMessageId: string;
  type: IncomingMsgType;
  body: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  timestampMs?: number;
}): Promise<void> {
  const ts = new Date(params.timestampMs ?? Date.now()).toISOString();

  const { error } = await supabaseAdmin
    .from("chat_messages")
    .upsert(
      {
        conversation_id: params.conversationId,
        baileys_message_id: params.baileysMessageId,
        direction: "out",
        from_me: true,
        type: params.type,
        body: params.body,
        media_url: params.mediaUrl,
        media_mime: params.mediaMime,
        status: "sent",
        timestamp: ts,
      },
      { onConflict: "conversation_id,baileys_message_id", ignoreDuplicates: false }
    );

  if (error) {
    console.error("[inbox] recordOutgoingMessage failed:", error.message);
    return;
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at: ts,
      last_message_preview: previewFor(params.type, params.body),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId);
}
