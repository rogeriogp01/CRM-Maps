import { NextResponse } from "next/server";
import { getNextAvailableWhatsapp } from "@/lib/dispatch-rotation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const excludedAccountIds = Array.isArray(body.excludedAccountIds)
    ? body.excludedAccountIds.filter((id: unknown) => typeof id === "string")
    : [];

  try {
    const account = await getNextAvailableWhatsapp(excludedAccountIds);
    if (!account) {
      return NextResponse.json({ error: "Nenhuma conta conectada disponível" }, { status: 404 });
    }

    return NextResponse.json({ account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao buscar conta disponível";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
