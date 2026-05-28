"use client";

/**
 * ROGA-81 (Fase 5 de ROGA-49) — formulario compartilhado de criacao de
 * workspace, usado por `/onboarding/workspace` (primeiro workspace,
 * pos-signup) e `/workspaces/new` (workspace adicional).
 *
 * Diferenca de fluxo:
 *  - Onboarding: nao ha workspace ativo. O POST /api/workspaces ja
 *    grava o claim (onlyIfMissing=true) e o backend retorna
 *    claim.updated=true. Refrescamos a sessao e mandamos pra "/".
 *  - Novo workspace adicional: backend NAO sobrescreve o claim atual
 *    (claim.updated=false, reason="kept_existing"). Mostramos no toast e
 *    voltamos para o switcher; usuario pode trocar manualmente.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Loader2, Building2, ArrowRight } from "lucide-react";

type Plan = "free" | "pro" | "enterprise";

interface Props {
  /** Onde redirecionar apos criar. Default "/". */
  redirectTo?: string;
  /**
   * Modo do formulario:
   *  - "onboarding": copy "Crie seu workspace" + obriga refresh de sessao
   *    apos criar (porque o claim sera setado pela primeira vez).
   *  - "additional": copy "Novo workspace" + nao forca refresh
   *    (claim atual e preservado).
   */
  mode: "onboarding" | "additional";
}

interface CreateResponse {
  workspace: {
    id: string;
    name: string;
    plan: Plan;
    role: "owner";
  };
  claim: {
    updated: boolean;
    reason: "set" | "kept_existing" | "unavailable";
    workspace_id?: string;
  };
}

export function WorkspaceForm({ redirectTo = "/", mode }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Plan>("free");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isOnboarding = mode === "onboarding";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!name.trim()) {
      setError("Digite um nome para o workspace");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: name.trim(), plan }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
      }

      const payload = (await res.json()) as CreateResponse;

      // Quando o claim foi setado pelo backend (onboarding), refrescamos
      // a sessao para o JWT carregar o claim novo antes do router.refresh.
      if (payload.claim.updated) {
        const supabase = createClient();
        await supabase.auth.refreshSession();
      } else if (payload.claim.reason === "kept_existing") {
        setNotice(
          "Workspace criado. Voce continua no workspace atual — use o seletor no topo para trocar.",
        );
      } else if (payload.claim.reason === "unavailable") {
        setNotice(
          "Workspace criado, mas a sessao nao pode ser atualizada automaticamente. Refaca login para ativar.",
        );
      }

      // Em onboarding, sempre redireciona; em adicional so redireciona se
      // o backend trocou o claim (raro: so se nao havia claim antes).
      if (isOnboarding || payload.claim.updated) {
        router.push(redirectTo);
        router.refresh();
      } else {
        // Fica na pagina e mostra o notice; oferece botao para ir embora.
        setSubmitting(false);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "erro desconhecido";
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      data-testid="workspace-form"
    >
      <div className="space-y-2">
        <label htmlFor="ws-name" className="text-sm font-medium">
          Nome do workspace
        </label>
        <div className="relative">
          <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <input
            id="ws-name"
            type="text"
            required
            maxLength={80}
            placeholder="Ex.: Acme Imoveis"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Cada workspace e um tenant isolado: leads, contas WhatsApp e
          historico nao sao compartilhados entre workspaces.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="ws-plan" className="text-sm font-medium">
          Plano
        </label>
        <select
          id="ws-plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan)}
          disabled={submitting}
          className="w-full px-3 py-2.5 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary outline-none transition-all disabled:opacity-50"
        >
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Voce pode mudar o plano depois.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary"
        >
          {notice}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className={cn(
          "w-full bg-primary text-primary-foreground h-12 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 active:scale-[0.98] disabled:opacity-50",
        )}
      >
        {submitting ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <>
            {isOnboarding ? "Criar e entrar" : "Criar workspace"}
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
