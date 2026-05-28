import { NextResponse } from "next/server";
import {
  getSystemSettings,
  upsertSystemSettings,
  SystemSettings,
} from "@/lib/server/system-settings";

export async function GET() {
  try {
    const settings = await getSystemSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao buscar configurações";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido (JSON esperado)" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const payload: Partial<SystemSettings> = {};
  const keys = ["operator_name", "operator_whatsapp", "company_name", "company_website"] as const;

  for (const key of keys) {
    if (key in raw) {
      const v = raw[key];
      if (v === null || v === undefined || v === "") {
        payload[key] = null;
      } else if (typeof v === "string") {
        payload[key] = v;
      } else {
        return NextResponse.json(
          { error: `Campo ${key} deve ser string ou null` },
          { status: 400 }
        );
      }
    }
  }

  try {
    await upsertSystemSettings(payload);
    const settings = await getSystemSettings();
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao salvar configurações";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
