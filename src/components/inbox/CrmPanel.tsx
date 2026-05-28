"use client";

import { useCallback, useEffect, useState } from "react";
import { Tag, MoveRight, ClipboardList } from "lucide-react";

type Lead = {
  id: string;
  name: string;
  phone: string;
  phone_normalized: string | null;
  email: string | null;
  company: string | null;
  origin: string;
  status: string;
  tags: string[];
  notes: string | null;
  assigned_to: string | null;
  whatsapp_account_id: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
};

type Column = {
  id: string;
  name: string;
  order: number;
  color: string;
};

type HistoryEntry = {
  id: string;
  type: string;
  message: string;
  whatsapp_account_id: string | null;
  created_at: string;
};

type Props = {
  leadId: string | null;
  onStageChanged?: () => void;
};

export function CrmPanel({ leadId, onStageChanged }: Props) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingStage, setIsSavingStage] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) {
      setLead(null);
      setColumns([]);
      setHistory([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/inbox/lead/${leadId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro");
      setLead(data.lead as Lead);
      setColumns((data.columns ?? []) as Column[]);
      setHistory((data.history ?? []) as HistoryEntry[]);
    } catch (err) {
      console.error("[inbox/CrmPanel] load failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStage(newStatus: string) {
    if (!lead || newStatus === lead.status || isSavingStage) return;
    setIsSavingStage(true);
    try {
      const res = await fetch(`/api/inbox/lead/${lead.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro");
      await load();
      onStageChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert("Falha ao mover estágio: " + msg);
    } finally {
      setIsSavingStage(false);
    }
  }

  if (!leadId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6 text-center">
        Selecione uma conversa para ver os dados CRM.
      </div>
    );
  }

  return (
    <>
      <header className="px-4 py-4 border-b border-border flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">CRM</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {isLoading || !lead ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Carregando...
          </div>
        ) : (
          <>
            {/* Identidade */}
            <section>
              <h3 className="text-sm font-semibold mb-1">{lead.name}</h3>
              <p className="text-xs text-muted-foreground">{lead.phone}</p>
              {lead.company && (
                <p className="text-xs text-muted-foreground">{lead.company}</p>
              )}
              {lead.email && (
                <p className="text-xs text-muted-foreground">{lead.email}</p>
              )}
            </section>

            {/* Estágio */}
            <section>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Estágio Kanban
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {columns.map((col) => {
                  const isCurrent = col.name === lead.status;
                  return (
                    <button
                      key={col.id}
                      onClick={() => changeStage(col.name)}
                      disabled={isSavingStage || isCurrent}
                      className="flex items-center gap-2 text-left text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-100"
                      style={
                        isCurrent
                          ? { background: col.color + "22", borderColor: col.color }
                          : undefined
                      }
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: col.color }}
                      />
                      <span className="flex-1">{col.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] text-muted-foreground">
                          atual
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {columns.length > 0 && lead && (
                <div className="mt-2">
                  <NextStageButton
                    current={lead.status}
                    columns={columns}
                    disabled={isSavingStage}
                    onMove={changeStage}
                  />
                </div>
              )}
            </section>

            {/* Tags */}
            {lead.tags && lead.tags.length > 0 && (
              <section>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {lead.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] px-2 py-0.5 bg-muted rounded-full"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Notas */}
            {lead.notes && (
              <section>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Notas
                </p>
                <p className="text-xs whitespace-pre-wrap">{lead.notes}</p>
              </section>
            )}

            {/* Histórico */}
            <section>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Histórico
              </p>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem registros.</p>
              ) : (
                <ul className="space-y-2">
                  {history.slice(0, 20).map((h) => (
                    <li key={h.id} className="text-xs border-l-2 border-border pl-2">
                      <p className="font-medium">{h.type}</p>
                      <p className="text-muted-foreground line-clamp-2">
                        {h.message}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(h.created_at).toLocaleString("pt-BR")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function NextStageButton({
  current,
  columns,
  disabled,
  onMove,
}: {
  current: string;
  columns: Column[];
  disabled: boolean;
  onMove: (status: string) => void;
}) {
  const sorted = [...columns].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((c) => c.name === current);
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
  if (!next) return null;

  return (
    <button
      onClick={() => onMove(next.name)}
      disabled={disabled}
      className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      Mover para {next.name}
      <MoveRight className="h-3.5 w-3.5" />
    </button>
  );
}
