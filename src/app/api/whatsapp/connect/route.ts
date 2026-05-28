import { NextResponse } from "next/server";
import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import pino from "pino";

// In-memory store for active connections (simple version)
const activeConnections = new Map();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
  }

  try {
    const sessionDir = path.join(process.cwd(), "sessions", sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const logger = pino({ level: "silent" });

    const sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: ["MapDisparo CRM", "Chrome", "1.0.0"],
    });

    return new Promise<NextResponse>((resolve) => {
      sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const qrDataUrl = await QRCode.toDataURL(qr);
          resolve(NextResponse.json({ qr: qrDataUrl, status: "pending" }));
        }

        if (connection === "close") {
          const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log("Connection closed due to ", lastDisconnect?.error, ", reconnecting ", shouldReconnect);
          activeConnections.delete(sessionId);
        } else if (connection === "open") {
          console.log("Opened connection");
          activeConnections.set(sessionId, sock);
          // resolve(NextResponse.json({ status: "connected" }));
        }
      });

      sock.ev.on("creds.update", saveCreds);

      // Timeout for QR code generation
      setTimeout(() => {
        resolve(NextResponse.json({ error: "Timeout generating QR code" }, { status: 504 }));
      }, 30000);
    });

  } catch (error) {
    console.error("Error connecting to WhatsApp:", error);
    return NextResponse.json({ error: "Failed to connect" }, { status: 500 });
  }
}
