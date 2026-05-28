import { NextResponse } from "next/server";
import {
  bulkInsertLeads,
  listLeads,
  deleteLeads,
  deleteAllLeads,
  type CampaignLeadInput,
  type LeadSource,
} from "@/lib/server/campaign-leads";

const VALID_SOURCES: LeadSource[] = ["crm", "maps", "csv", "manual"];

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "500");
    const offset = Number(url.searchParams.get("offset") ?? "0");

    const result = await listLeads({ status, limit, offset });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao listar leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { source, leads } = body as {
    source?: unknown;
    leads?: unknown;
  };

  if (typeof source !== "string" || !VALID_SOURCES.includes(source as LeadSource)) {
    return NextResponse.json(
      { error: `source deve ser um de ${VALID_SOURCES.join(", ")}` },
      { status: 400 }
    );
  }

  if (!Array.isArray(leads)) {
    return NextResponse.json({ error: "leads deve ser um array" }, { status: 400 });
  }

  const parsed: CampaignLeadInput[] = [];
  for (const raw of leads) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.phone !== "string" || r.phone.trim() === "") continue;
    parsed.push({
      name: typeof r.name === "string" ? r.name : null,
      phone: r.phone,
      company: typeof r.company === "string" ? r.company : null,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : null,
    });
  }

  try {
    const stats = await bulkInsertLeads({
      leads: parsed,
      source: source as LeadSource,
    });
    return NextResponse.json({ success: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao inserir leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "true";

  try {
    if (all) {
      const count = await deleteAllLeads();
      return NextResponse.json({ success: true, count });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }

    const ids = (body as { ids?: unknown }).ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "ids deve ser array de string" }, { status: 400 });
    }

    const count = await deleteLeads(ids as string[]);
    return NextResponse.json({ success: true, count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao deletar leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
