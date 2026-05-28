"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Phone, MessageSquare, Send, Trash2, Save } from "lucide-react";

type CrmColumn = { id: string; name: string; order: number; color: string; created_at: string };
type CrmLead = {
  id: string;
  name: string;
  phone: string;
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
type CrmHistory = { id: string; type: string; message: string; created_at: string; whatsapp_account_id: string | null };
type Account = { id: string; name: string; phone: string | null; status: string };

const DEFAULT_COLORS = ["#64748b", "#3b82f6", "#06b6d4", "#22c55e", "#eab308", "#10b981", "#ef4444"];

export function CrmKanban() {
  const [columns, setColumns] = useState<CrmColumn[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<CrmHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [note, setNote] = useState("");
  const [newLead, setNewLead] = useState({ name: "", phone: "", origin: "manual", status: "Novo Lead" });
  const [newColumnName, setNewColumnName] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cRes, lRes, aRes] = await Promise.all([
        fetch("/api/crm/columns", { cache: "no-store" }),
        fetch("/api/crm/leads", { cache: "no-store" }),
        fetch("/api/whatsapp/accounts", { cache: "no-store" }),
      ]);

      const [cJson, lJson, aJson] = await Promise.all([cRes.json(), lRes.json(), aRes.json()]);
      if (cRes.ok) setColumns((cJson.columns ?? []).sort((a: CrmColumn, b: CrmColumn) => a.order - b.order));
      if (lRes.ok) setLeads(lJson.leads ?? []);
      if (aRes.ok) setAccounts(aJson.accounts ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedLead) return;
    fetch(`/api/crm/leads/${selectedLead.id}/history`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setHistory(data.history ?? []));
  }, [selectedLead]);

  const todaySentCount = useMemo(() => history.filter((h) => h.type === "dispatch_sent").length, [history]);
  const activeTodayCount = useMemo(() => leads.filter((l) => l.updated_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const bySearch = !search || lead.name.toLowerCase().includes(search.toLowerCase()) || lead.phone.includes(search);
      const byTag = !filterTag || lead.tags.includes(filterTag);
      return bySearch && byTag;
    });
  }, [leads, search, filterTag]);

  const leadByStatus = (status: string) => filteredLeads.filter((lead) => lead.status === status);

  const createLead = async () => {
    if (!newLead.name.trim() || !newLead.phone.trim()) return;
    const response = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newLead),
    });
    if (response.ok) {
      setNewLead({ name: "", phone: "", origin: "manual", status: columns[0]?.name ?? "Novo Lead" });
      loadAll();
    }
  };

  const deleteLead = async (id: string) => {
    if (!window.confirm("Excluir este lead?")) return;
    const response = await fetch(`/api/crm/leads/${id}`, { method: "DELETE" });
    if (response.ok) {
      if (selectedLead?.id === id) setSelectedLead(null);
      loadAll();
    }
  };

  const onDropLead = async (leadId: string, newStatus: string) => {
    await fetch(`/api/crm/leads/${leadId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadAll();
  };

  const addNote = async () => {
    if (!selectedLead || !note.trim()) return;
    const response = await fetch(`/api/crm/leads/${selectedLead.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (response.ok) {
      setNote("");
      const historyResponse = await fetch(`/api/crm/leads/${selectedLead.id}/history`, { cache: "no-store" });
      const historyJson = await historyResponse.json();
      setHistory(historyJson.history ?? []);
      loadAll();
    }
  };

  const reorderColumns = async (columnId: string, direction: "up" | "down") => {
    const ordered = [...columns].sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((c) => c.id === columnId);
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= ordered.length) return;

    const current = ordered[idx];
    const other = ordered[target];

    await Promise.all([
      fetch(`/api/crm/columns/${current.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: other.order }) }),
      fetch(`/api/crm/columns/${other.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: current.order }) }),
    ]);

    loadAll();
  };

  const createColumn = async () => {
    if (!newColumnName.trim()) return;
    const order = columns.length + 1;
    const color = DEFAULT_COLORS[(order - 1) % DEFAULT_COLORS.length];
    const response = await fetch("/api/crm/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newColumnName.trim(), order, color }),
    });
    if (response.ok) {
      setNewColumnName("");
      loadAll();
    }
  };

  const allTags = Array.from(new Set(leads.flatMap((l) => l.tags)));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">CRM Kanban</h1>
          <p className="text-muted-foreground mt-1">Gerencie leads, histórico e negociações em tempo real.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg border border-border bg-card px-3 py-2">Total Leads: <span className="font-bold">{leads.length}</span></div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">Ativos Hoje: <span className="font-bold">{activeTodayCount}</span></div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">Msgs Hoje: <span className="font-bold">{todaySentCount}</span></div>
          <div className="rounded-lg border border-border bg-card px-3 py-2">Contas ON: <span className="font-bold">{accounts.filter((a) => a.status === "connected").length}</span></div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="grid md:grid-cols-6 gap-2">
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Nome" value={newLead.name} onChange={(e) => setNewLead((p) => ({ ...p, name: e.target.value }))} />
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Telefone" value={newLead.phone} onChange={(e) => setNewLead((p) => ({ ...p, phone: e.target.value }))} />
          <input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Origem" value={newLead.origin} onChange={(e) => setNewLead((p) => ({ ...p, origin: e.target.value }))} />
          <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm" value={newLead.status} onChange={(e) => setNewLead((p) => ({ ...p, status: e.target.value }))}>{columns.map((col) => <option key={col.id}>{col.name}</option>)}</select>
          <button onClick={createLead} className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-primary-foreground text-sm font-medium"><Plus className="h-4 w-4 mr-1" />Criar Lead</button>
          <div className="flex gap-2">
            <input className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Nova coluna" value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} />
            <button onClick={createColumn} className="rounded-lg border border-border px-3 py-2"><Save className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="grid md:grid-cols-3 gap-2">
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm" placeholder="Pesquisar por nome/telefone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <select className="rounded-lg border border-input bg-background px-3 py-2 text-sm" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}><option value="">Todas as tags</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select>
          <div className="text-xs text-muted-foreground flex items-center">Arraste cards entre colunas para atualizar status.</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max pb-2">
          {loading && <div className="text-sm text-muted-foreground">Carregando CRM...</div>}
          {!loading && columns.map((column) => {
            const colLeads = leadByStatus(column.name);
            return (
              <div
                key={column.id}
                className="w-80 rounded-xl border border-border bg-card"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const leadId = e.dataTransfer.getData("text/plain");
                  if (leadId) onDropLead(leadId, column.name);
                }}
              >
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: column.color }}></span>
                    <h3 className="font-semibold text-sm">{column.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-secondary">{colLeads.length}</span>
                  </div>
                  <div className="flex gap-1">
                    <button className="text-xs px-2 py-1 rounded hover:bg-secondary" onClick={() => reorderColumns(column.id, "up")}>↑</button>
                    <button className="text-xs px-2 py-1 rounded hover:bg-secondary" onClick={() => reorderColumns(column.id, "down")}>↓</button>
                  </div>
                </div>
                <div className="p-2 space-y-2 min-h-[120px] max-h-[65vh] overflow-y-auto">
                  {colLeads.map((lead) => (
                    <div key={lead.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)} className="rounded-lg border border-border bg-background/60 p-3 cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors" onClick={() => setSelectedLead(lead)}>
                      <div className="text-sm font-semibold truncate">{lead.name}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</div>
                      <div className="text-[11px] mt-1 text-muted-foreground truncate">Origem: {lead.origin}</div>
                      <div className="text-[11px] mt-1 text-muted-foreground truncate">Responsável: {lead.assigned_to ?? "-"}</div>
                      <div className="flex flex-wrap gap-1 mt-2">{lead.tags.slice(0, 3).map((tag) => <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary">#{tag}</span>)}</div>
                      <div className="text-[10px] mt-2 text-muted-foreground">Última interação: {lead.last_interaction_at ? new Date(lead.last_interaction_at).toLocaleString("pt-BR") : "N/A"}</div>
                    </div>
                  ))}
                  {colLeads.length === 0 && <div className="text-xs text-muted-foreground text-center py-8">Nenhum lead nesta coluna.</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedLead && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm p-4 flex items-center justify-center" onClick={() => setSelectedLead(null)}>
          <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{selectedLead.name}</h2>
                <div className="text-sm text-muted-foreground">{selectedLead.phone} • {selectedLead.company ?? "Sem empresa"}</div>
              </div>
              <div className="flex gap-2">
                <a href={`https://wa.me/${selectedLead.phone}`} target="_blank" className="inline-flex items-center px-3 py-2 rounded-lg bg-green-600 text-white text-sm"><MessageSquare className="h-4 w-4 mr-1" />WhatsApp</a>
                <button onClick={() => deleteLead(selectedLead.id)} className="inline-flex items-center px-3 py-2 rounded-lg bg-destructive text-white text-sm"><Trash2 className="h-4 w-4 mr-1" />Excluir</button>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mt-5">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs font-semibold mb-2">Dados</div>
                <div className="space-y-1 text-sm">
                  <div>Email: {selectedLead.email ?? "-"}</div>
                  <div>Origem: {selectedLead.origin}</div>
                  <div>Status: {selectedLead.status}</div>
                  <div>Responsável: {selectedLead.assigned_to ?? "-"}</div>
                  <div>Conta WhatsApp: {accounts.find((a) => a.id === selectedLead.whatsapp_account_id)?.name ?? "-"}</div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs font-semibold mb-2">Observações</div>
                <textarea className="w-full h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm" placeholder="Adicionar observação" value={note} onChange={(e) => setNote(e.target.value)}></textarea>
                <button onClick={addNote} className="mt-2 inline-flex items-center rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"><Save className="h-4 w-4 mr-1" />Salvar Nota</button>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 mt-4">
              <div className="text-xs font-semibold mb-2">Timeline / Histórico</div>
              <div className="max-h-56 overflow-y-auto space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="text-sm rounded border border-border bg-background/50 p-2">
                    <div className="font-medium">{h.type}</div>
                    <div className="text-muted-foreground">{h.message}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">{new Date(h.created_at).toLocaleString("pt-BR")}</div>
                  </div>
                ))}
                {history.length === 0 && <div className="text-xs text-muted-foreground">Sem histórico.</div>}
              </div>
            </div>

            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={async () => {
                await fetch("/api/whatsapp/dispatch/history", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contact_phone: selectedLead.phone,
                    whatsapp_account_id: selectedLead.whatsapp_account_id ?? accounts.find((a) => a.status === "connected")?.id,
                    message_used: "Disparo individual via CRM",
                    status: "sent",
                  }),
                });
                loadAll();
              }} className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-2 text-sm text-white"><Send className="h-4 w-4 mr-1" />Disparo individual</button>
              <button onClick={() => setSelectedLead(null)} className="rounded-lg border border-border px-3 py-2 text-sm">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
