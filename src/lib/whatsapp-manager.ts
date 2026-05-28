import pino from "pino";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { handleIncomingMessage } from "@/lib/server/inbox";

type AccountStatus = "connected" | "disconnected" | "connecting" | "error";

type AccountRecord = {
  id: string;
  session_id: string;
};

type BaileysModule = typeof import("@whiskeysockets/baileys");

type LiveConnection = {
  socket: any;
  status: AccountStatus;
  qr: string | null;
  phone: string | null;
  lastError: string | null;
};

const logger = pino({ level: "silent" });
const activeConnections = new Map<string, LiveConnection>();
let baileysModulePromise: Promise<BaileysModule> | null = null;

// Avoid optional ws native addons that can break under Next.js bundling on Windows/dev.
if (!process.env.WS_NO_BUFFER_UTIL) process.env.WS_NO_BUFFER_UTIL = "1";
if (!process.env.WS_NO_UTF_8_VALIDATE) process.env.WS_NO_UTF_8_VALIDATE = "1";

function getBaileysModule() {
  if (!baileysModulePromise) {
    baileysModulePromise = import("@whiskeysockets/baileys");
  }
  return baileysModulePromise;
}

function getSessionDir(sessionId: string) {
  return path.join(process.cwd(), "sessions", sessionId);
}

function ensureSessionDir(sessionId: string) {
  const dir = getSessionDir(sessionId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function parsePhoneFromJid(jid: string | undefined) {
  if (!jid) return null;
  const firstPart = jid.split(":")[0];
  return firstPart.split("@")[0] || null;
}

async function updateAccountState(
  accountId: string,
  patch: Partial<{
    status: AccountStatus;
    phone: string | null;
    qr_code: string | null;
    last_connection_at: string | null;
    updated_at: string;
  }>
) {
  const { error } = await supabaseAdmin
    .from("whatsapp_accounts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", accountId);

  if (error) {
    console.error("Failed to update whatsapp_accounts:", error.message);
  }
}

function setLiveConnection(accountId: string, conn: LiveConnection) {
  activeConnections.set(accountId, conn);
}

function getLiveConnection(accountId: string) {
  return activeConnections.get(accountId);
}

export async function connectWhatsAppAccount(account: AccountRecord) {
  const existing = getLiveConnection(account.id);
  if (existing && (existing.status === "connecting" || existing.status === "connected")) {
    return existing;
  }

  const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
  } = await getBaileysModule();

  ensureSessionDir(account.session_id);
  const { state, saveCreds } = await useMultiFileAuthState(getSessionDir(account.session_id));
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: ["MapDisparo CRM", "Chrome", "1.0.0"],
  });

  const initialLive: LiveConnection = {
    socket,
    status: "connecting",
    qr: null,
    phone: null,
    lastError: null,
  };

  setLiveConnection(account.id, initialLive);
  await updateAccountState(account.id, { status: "connecting", qr_code: null });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update: any) => {
    const live = getLiveConnection(account.id);
    if (!live) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      live.qr = qrDataUrl;
      live.status = "connecting";
      live.lastError = null;
      setLiveConnection(account.id, live);
      await updateAccountState(account.id, { status: "connecting", qr_code: qrDataUrl });
    }

    if (connection === "open") {
      const phone = parsePhoneFromJid(socket.user?.id);
      live.status = "connected";
      live.qr = null;
      live.phone = phone;
      live.lastError = null;
      setLiveConnection(account.id, live);

      await updateAccountState(account.id, {
        status: "connected",
        phone,
        qr_code: null,
        last_connection_at: new Date().toISOString(),
      });
      return;
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      live.status = isLoggedOut ? "disconnected" : "error";
      live.qr = null;
      live.lastError = (lastDisconnect?.error as Error | undefined)?.message ?? "Conexão encerrada";
      setLiveConnection(account.id, live);

      await updateAccountState(account.id, {
        status: isLoggedOut ? "disconnected" : "error",
        qr_code: null,
      });

      if (isLoggedOut) {
        activeConnections.delete(account.id);
      }
    }
  });

  // ============================================================
  // Inbox WhatsApp: listener de mensagens recebidas (e echo outgoing).
  // - Filtra grupos (@g.us) e status broadcast.
  // - Roda o handler em background (catch interno) para nunca derrubar o socket.
  // - Registrado por socket → multicontas seguro (cada conta tem seu próprio).
  // ============================================================
  console.log(`[inbox] listener registered for account ${account.id}`);
  socket.ev.on("messages.upsert", async (payload: any) => {
    try {
      console.log(
        `[inbox] messages.upsert account=${account.id} type=${payload?.type} count=${Array.isArray(payload?.messages) ? payload.messages.length : 0}`
      );
      if (payload?.type !== "notify") return;
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      for (const msg of messages) {
        const jid: string | undefined = msg?.key?.remoteJid;
        console.log(
          `[inbox] msg jid=${jid} fromMe=${msg?.key?.fromMe} id=${msg?.key?.id} hasMessage=${!!msg?.message}`
        );
        if (!jid) continue;
        if (jid.endsWith("@g.us") || jid === "status@broadcast") {
          console.log(`[inbox] skipped group/status: ${jid}`);
          continue;
        }
        // Não await: processa em paralelo, com catch interno em handleIncomingMessage.
        handleIncomingMessage(account.id, socket, msg).catch((err) =>
          console.error("[inbox] handleIncomingMessage rejected:", err)
        );
      }
    } catch (err) {
      console.error("[inbox] messages.upsert listener exception:", err);
    }
  });

  return initialLive;
}

export async function disconnectWhatsAppAccount(accountId: string) {
  const live = getLiveConnection(accountId);
  if (live) {
    try {
      await live.socket.logout();
    } catch {
      // noop
    }
    try {
      live.socket.end(new Error("Disconnected by user"));
    } catch {
      // noop
    }
  }

  activeConnections.delete(accountId);

  await updateAccountState(accountId, { status: "disconnected", qr_code: null });
}

export function getWhatsAppLiveState(accountId: string) {
  const live = getLiveConnection(accountId);
  if (!live) return null;

  return {
    status: live.status,
    qr: live.qr,
    phone: live.phone,
    lastError: live.lastError,
  };
}

/**
 * Retorna o socket Baileys cru de uma conta conectada — para chamadas
 * server-side como sock.onWhatsApp([jid]) ou sock.sendMessage(...).
 * Retorna null se a conta não está conectada.
 */
export function getSocket(accountId: string): any | null {
  const live = getLiveConnection(accountId);
  if (!live || live.status !== "connected") return null;
  return live.socket;
}

export function removeWhatsAppSessionFiles(sessionId: string) {
  const dir = getSessionDir(sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

