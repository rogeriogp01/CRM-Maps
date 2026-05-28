"use client";

/**
 * ROGA-81 (Fase 5 de ROGA-49) — seletor global de workspace.
 *
 * - Lista workspaces do usuario (GET /api/workspaces).
 * - Marca o atual a partir do claim `workspace_id` no JWT (lido via
 *   `supabase.auth.getSession()` no cliente).
 * - Troca de workspace via POST /api/workspaces/switch + refreshSession
 *   + router.refresh() — sem F5 manual.
 * - Link para `/workspaces/new` no rodape do dropdown.
 *
 * UI: dropdown leve em Tailwind (sem dependencia adicional). Pode ser
 * substituido por um Popover/Combobox shadcn quando o repo padronizar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus, Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type Plan = "free" | "pro" | "enterprise";
type Role = "owner" | "admin" | "member";

interface WorkspaceRow {
  id: string;
  name: string;
  plan: Plan;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
  role: Role;
}

interface JwtPayload {
  workspace_id?: string;
  app_metadata?: { workspace_id?: string };
  user_metadata?: { workspace_id?: string };
}

function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof window !== "undefined"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function readClaimFromPayload(payload: JwtPayload | null): string | null {
  if (!payload) return null;
  if (typeof payload.workspace_id === "string") return payload.workspace_id;
  if (typeof payload.app_metadata?.workspace_id === "string")
    return payload.app_metadata.workspace_id;
  if (typeof payload.user_metadata?.workspace_id === "string")
    return payload.user_metadata.workspace_id;
  return null;
}

export function WorkspaceSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Carrega workspaces e workspace ativo.
  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [listRes, sessionRes] = await Promise.all([
        fetch("/api/workspaces", { credentials: "include" }),
        supabase.auth.getSession(),
      ]);

      if (!listRes.ok) {
        if (listRes.status === 401) {
          // sem sessao — switcher fica oculto
          setWorkspaces([]);
          setCurrentId(null);
          return;
        }
        const body = await listRes.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${listRes.status}`);
      }
      const payload = (await listRes.json()) as { workspaces: WorkspaceRow[] };
      setWorkspaces(payload.workspaces ?? []);

      const token = sessionRes.data.session?.access_token ?? null;
      const claim = token ? readClaimFromPayload(decodeJwt(token)) : null;
      setCurrentId(claim);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "erro desconhecido";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = useMemo(
    () => workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null,
    [workspaces, currentId],
  );

  const handleSwitch = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === currentId) {
        setOpen(false);
        return;
      }
      setSwitching(workspaceId);
      setError(null);
      try {
        const res = await fetch("/api/workspaces/switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ workspace_id: workspaceId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? `HTTP ${res.status}`);
        }
        // Forca reemissao do JWT com o novo claim antes do refresh do app.
        await supabase.auth.refreshSession();
        setCurrentId(workspaceId);
        setOpen(false);
        // Re-busca dados server-side com o novo claim ativo.
        router.refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "erro desconhecido";
        setError(`Falha ao trocar de workspace: ${message}`);
      } finally {
        setSwitching(null);
      }
    },
    [currentId, router, supabase],
  );

  // Estado de loading inicial: skeleton.
  if (loading) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm",
          className,
        )}
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">Carregando…</span>
      </div>
    );
  }

  // Sem sessao ou sem nenhum workspace: nao renderiza o switcher
  // (o redirect para /onboarding/workspace e responsabilidade do
  // layout / middleware).
  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block text-left", className)}
      data-testid="workspace-switcher"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex w-full min-w-[200px] items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 truncate">
          <Building2 className="h-4 w-4 text-primary" />
          <span className="truncate font-medium">
            {current?.name ?? "Selecionar workspace"}
          </span>
          {current?.role && (
            <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {current.role}
            </span>
          )}
        </span>
        <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-2 w-full min-w-[260px] overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        >
          <ul className="max-h-72 overflow-y-auto py-1">
            {workspaces.map((ws) => {
              const isCurrent = ws.id === currentId;
              const isSwitching = switching === ws.id;
              return (
                <li key={ws.id}>
                  <button
                    type="button"
                    onClick={() => handleSwitch(ws.id)}
                    disabled={isSwitching}
                    role="option"
                    aria-selected={isCurrent}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors",
                      isCurrent && "bg-accent/40",
                      isSwitching && "opacity-60",
                    )}
                  >
                    <span className="flex flex-col">
                      <span className="font-medium truncate">{ws.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        plano {ws.plan} · {ws.role}
                      </span>
                    </span>
                    {isCurrent && (
                      <Check className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-border p-1">
            <Link
              href="/workspaces/new"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-primary hover:bg-accent transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar novo workspace
            </Link>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
