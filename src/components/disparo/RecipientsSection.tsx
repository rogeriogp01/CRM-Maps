"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users,
  FileUp,
  ClipboardPaste,
  Trash2,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Database,
} from "lucide-react";
import { formatPhone } from "@/lib/phone";

type CampaignLeadRow = {
  id: string;
  name: string | null;
  phone: string;
  phone_normalized: string;
  company: string | null;
  source: "crm" | "maps" | "csv" | "manual";
  valid_whatsapp: boolean | null;
  already_contacted: boolean;
  status: "pending" | "sent" | "failed" | "skipped";
};

type ImportStats = {
  inserted: number;
  duplicates: number;
  invalid: number;
  blacklisted: number;
};

export type RecipientsSectionHandle = {
  refresh: () => Promise<void>;
};

type Props = {
  onLeadsChange?: (leads: CampaignLeadRow[]) => void;
};

/**
 * Seção "Destinatários da Campanha" — versão mínima focada em persistência.
 * Fontes desta entrega: Colar Manualmente e CSV.
 * (CRM picker, Maps e validação WhatsApp ficam para a próxima sprint.)
 */
export function RecipientsSection({ onLeadsChange }: Props) {
  const [leads, setLeads] = useState<CampaignLeadRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const csvInputRef = useRef<HTMLInputElement | null>(null);

  // Mantém a callback do pai em uma ref para que loadLeads seja estável
  // e o useEffect de bootstrap não dispare em loop quando o pai re-renderiza
  // com uma nova função inline.
  const onLeadsChangeRef = useRef(onLeadsChange);
  useEffect(() => {
    onLeadsChangeRef.current = onLeadsChange;
  }, [onLeadsChange]);

  const loadLeads = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/campaign-leads?limit=2000", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro ao carregar destinatários");
      const list = (data?.leads ?? []) as CampaignLeadRow[];
      setLeads(list);
      onLeadsChangeRef.current?.(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      alert("Falha ao carregar destinatários: " + message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const stats = useMemo(() => {
    const total = leads.length;
    const valid = leads.filter((l) => l.valid_whatsapp === true).length;
    const invalid = leads.filter((l) => l.valid_whatsapp === false).length;
    const alreadyContacted = leads.filter((l) => l.already_contacted).length;
    const ready = leads.filter(
      (l) => l.status === "pending" && l.valid_whatsapp !== false && !l.already_contacted
    ).length;
    return { total, valid, invalid, alreadyContacted, ready };
  }, [leads]);

  // --- Importação manual (paste) ---
  const handlePasteImport = async () => {
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");

    if (lines.length === 0) {
      alert("Cole pelo menos um número, um por linha.");
      return;
    }

    // Aceita "nome,telefone" ou apenas "telefone".
    const parsed = lines.map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length >= 2) {
        return { name: parts[0], phone: parts[1] };
      }
      return { name: null, phone: parts[0] };
    });

    await postImport(parsed, "manual");
    setPasteText("");
    setShowPaste(false);
  };

  // --- Importação CSV (parser simples, sem dependência externa) ---
  const handleCsvSelected = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        alert("CSV vazio.");
        return;
      }
      // primeira linha = cabeçalho
      const header = rows[0].map((h) => h.toLowerCase().trim());
      const idxNome = header.findIndex((h) => h === "nome" || h === "name");
      const idxTel = header.findIndex(
        (h) => h === "telefone" || h === "phone" || h === "celular" || h === "whatsapp"
      );
      const idxEmpresa = header.findIndex((h) => h === "empresa" || h === "company");
      const idxTags = header.findIndex((h) => h === "tags");

      if (idxTel === -1) {
        alert("CSV precisa de uma coluna 'telefone' (ou phone, celular, whatsapp).");
        return;
      }

      const parsed = rows.slice(1).flatMap((cols) => {
        const phone = cols[idxTel]?.trim() ?? "";
        if (!phone) return [];
        return [
          {
            name: idxNome !== -1 ? cols[idxNome]?.trim() ?? null : null,
            phone,
            company: idxEmpresa !== -1 ? cols[idxEmpresa]?.trim() ?? null : null,
            tags:
              idxTags !== -1 && cols[idxTags]
                ? cols[idxTags].split(/[;|]/).map((t) => t.trim()).filter(Boolean)
                : null,
          },
        ];
      });

      if (parsed.length === 0) {
        alert("Nenhuma linha válida no CSV.");
        return;
      }

      await postImport(parsed, "csv");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao ler CSV";
      alert("Falha no CSV: " + message);
    } finally {
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const postImport = async (
    leadsBatch: Array<{ name?: string | null; phone: string; company?: string | null; tags?: string[] | null }>,
    source: "manual" | "csv" | "crm" | "maps"
  ) => {
    setIsImporting(true);
    try {
      const res = await fetch("/api/campaign-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, leads: leadsBatch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro ao importar");
      const s = (data?.stats ?? {}) as ImportStats;
      alert(
        `Importação concluída:\n` +
          `• Adicionados: ${s.inserted}\n` +
          `• Duplicados ignorados: ${s.duplicates}\n` +
          `• Inválidos: ${s.invalid}\n` +
          `• Bloqueados (blacklist): ${s.blacklisted}`
      );
      await loadLeads();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      alert("Falha ao importar: " + message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearAll = async () => {
    if (leads.length === 0) return;
    if (!confirm(`Remover TODOS os ${leads.length} destinatários da campanha?`)) return;
    try {
      const res = await fetch("/api/campaign-leads?all=true", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro");
      await loadLeads();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      alert("Falha ao limpar: " + message);
    }
  };

  const handleDeleteOne = async (id: string) => {
    try {
      const res = await fetch("/api/campaign-leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Erro");
      }
      await loadLeads();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro";
      alert("Falha ao remover: " + message);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg leading-tight">Destinatários da Campanha</h3>
            <p className="text-xs text-muted-foreground">
              Leads que vão receber os disparos. Importação persistida no banco.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadLeads}
            disabled={isLoading}
            title="Recarregar lista"
            className="inline-flex items-center justify-center p-2 rounded-lg border border-border bg-background hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          {leads.length > 0 && (
            <button
              onClick={handleClearAll}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 text-xs font-semibold transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpar tudo
            </button>
          )}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Total" value={stats.total} icon={<Database className="h-4 w-4" />} />
          <StatCard
            label="Válidos"
            value={stats.valid}
            icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
          />
          <StatCard
            label="Inválidos"
            value={stats.invalid}
            icon={<XCircle className="h-4 w-4 text-destructive" />}
          />
          <StatCard
            label="Já contatados"
            value={stats.alreadyContacted}
            icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
          />
          <StatCard
            label="Prontos"
            value={stats.ready}
            icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
            highlight
          />
        </div>

        {/* Fontes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={isImporting}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 transition-all text-sm font-semibold text-primary disabled:opacity-50"
          >
            <FileUp className="h-4 w-4" />
            Importar CSV
          </button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCsvSelected(file);
            }}
          />

          <button
            onClick={() => setShowPaste((v) => !v)}
            disabled={isImporting}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-border bg-background hover:bg-secondary/50 transition-all text-sm font-semibold text-foreground disabled:opacity-50"
          >
            <ClipboardPaste className="h-4 w-4" />
            Colar Manualmente
          </button>
        </div>

        {showPaste && (
          <div className="space-y-2 p-4 rounded-xl bg-secondary/30 border border-border">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Cole um número por linha (ou "nome, telefone")
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"João, 11988887777\n11977776666\n+55 11 96666-5555"}
              rows={6}
              className="w-full p-3 rounded-lg border border-input bg-background outline-none focus:ring-2 focus:ring-primary/50 text-sm font-mono"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowPaste(false);
                  setPasteText("");
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={handlePasteImport}
                disabled={isImporting || pasteText.trim() === ""}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isImporting ? <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> : null}
                Importar {pasteText.split(/\r?\n/).filter((l) => l.trim()).length} linha(s)
              </button>
            </div>
          </div>
        )}

        {/* Tabela */}
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <Th>Nome</Th>
                  <Th>Telefone</Th>
                  <Th>Origem</Th>
                  <Th>Status</Th>
                  <Th>WhatsApp</Th>
                  <Th>Já contatado?</Th>
                  <Th className="text-right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">
                      {isLoading ? "Carregando..." : "Nenhum destinatário ainda. Importe via CSV ou cole números."}
                    </td>
                  </tr>
                )}
                {leads.slice(0, 200).map((lead) => (
                  <tr key={lead.id} className="border-b border-border last:border-b-0 hover:bg-secondary/30">
                    <Td>{lead.name ?? <span className="text-muted-foreground">—</span>}</Td>
                    <Td className="font-mono text-xs">{formatPhone(lead.phone_normalized) || lead.phone}</Td>
                    <Td>
                      <SourceBadge source={lead.source} />
                    </Td>
                    <Td>
                      <StatusBadge status={lead.status} />
                    </Td>
                    <Td>
                      {lead.valid_whatsapp === true ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600">
                          <CheckCircle2 className="h-3 w-3" /> sim
                        </span>
                      ) : lead.valid_whatsapp === false ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive">
                          <XCircle className="h-3 w-3" /> não
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">não verificado</span>
                      )}
                    </Td>
                    <Td>
                      {lead.already_contacted ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> sim
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">não</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <button
                        onClick={() => handleDeleteOne(lead.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {leads.length > 200 && (
            <div className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted/20">
              Mostrando 200 de {leads.length} destinatários. O disparo usa todos.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-xl border ${
        highlight
          ? "border-primary/40 bg-gradient-to-br from-primary/10 to-primary/5"
          : "border-border bg-background"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className ?? ""}`}>{children}</td>;
}

function SourceBadge({ source }: { source: "crm" | "maps" | "csv" | "manual" }) {
  const styles: Record<string, string> = {
    crm: "bg-purple-500/10 text-purple-600 border-purple-500/20",
    maps: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    csv: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    manual: "bg-secondary text-muted-foreground border-border",
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${styles[source]}`}>
      {source}
    </span>
  );
}

function StatusBadge({ status }: { status: "pending" | "sent" | "failed" | "skipped" }) {
  const styles: Record<string, string> = {
    pending: "bg-secondary text-muted-foreground",
    sent: "bg-green-500/10 text-green-600",
    failed: "bg-destructive/10 text-destructive",
    skipped: "bg-amber-500/10 text-amber-600",
  };
  const labels: Record<string, string> = {
    pending: "na fila",
    sent: "enviado",
    failed: "falha",
    skipped: "pulado",
  };
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

/**
 * Parser CSV simples — tolera aspas duplas e vírgula dentro de campos quoted.
 * Não cobre todos os edge cases do RFC 4180, mas serve para o formato
 * típico exportado de planilhas (Excel, Google Sheets).
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === "," || ch === ";") {
        row.push(field);
        field = "";
      } else if (ch === "\r") {
        // ignora \r — \n abaixo encerra linha
      } else if (ch === "\n") {
        row.push(field);
        if (row.some((c) => c.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}
