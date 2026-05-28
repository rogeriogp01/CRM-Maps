import { NextRequest, NextResponse } from "next/server";
import {
  generateMessageVariations,
  GroqConfigError,
  GroqResponseError,
} from "@/lib/server/groq-service";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido (JSON esperado)" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Body inválido" },
      { status: 400 }
    );
  }

  const { baseMessage, count } = body as {
    baseMessage?: unknown;
    count?: unknown;
  };

  if (typeof baseMessage !== "string" || baseMessage.trim() === "") {
    return NextResponse.json(
      { error: "baseMessage é obrigatório (string não vazia)" },
      { status: 400 }
    );
  }

  let resolvedCount = 5;
  if (count !== undefined) {
    if (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 5
    ) {
      return NextResponse.json(
        { error: "count deve ser um inteiro entre 1 e 5" },
        { status: 400 }
      );
    }
    resolvedCount = count;
  }

  try {
    const variations = await generateMessageVariations(
      baseMessage.trim(),
      resolvedCount
    );
    return NextResponse.json({ variations }, { status: 200 });
  } catch (err) {
    if (err instanceof GroqConfigError) {
      return NextResponse.json(
        { error: "Serviço de IA indisponível" },
        { status: 503 }
      );
    }
    if (err instanceof GroqResponseError) {
      return NextResponse.json(
        { error: "Resposta inválida da IA" },
        { status: 502 }
      );
    }
    const message = err instanceof Error ? err.message : "Erro ao gerar variações";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
