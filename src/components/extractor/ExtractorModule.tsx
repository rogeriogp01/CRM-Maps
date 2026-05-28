"use client";

import {
  Search,
  MapPin,
  Download,
  Send,
  Loader2,
  CheckSquare,
  Square,
} from "lucide-react";
import { useState } from "react";

type Lead = {
  id: string;
  name: string;
  phone: string;
  address: string;
  category: string;
  rating: number;
  reviews: number;
  selected?: boolean;
};

export function ExtractorModule() {
  const [searchTerm, setSearchTerm] = useState("");
  const [location, setLocation] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isMockMode, setIsMockMode] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [sendToCrmAutomatically, setSendToCrmAutomatically] = useState(true);

  const toggleSelectAll = () => {
    const allSelected = leads.every((l) => l.selected);
    const updatedLeads = leads.map((l) => ({ ...l, selected: !allSelected }));
    setLeads(updatedLeads);
    setSelectedCount(!allSelected ? updatedLeads.length : 0);
  };

  const toggleSelect = (id: string) => {
    const updatedLeads = leads.map((l) => (l.id === id ? { ...l, selected: !l.selected } : l));
    setLeads(updatedLeads);
    setSelectedCount(updatedLeads.filter((l) => l.selected).length);
  };

  const handleExtract = async () => {
    if (!searchTerm || !location) return;

    setIsExtracting(true);
    setLeads([]);
    setIsMockMode(false);

    try {
      const response = await fetch("/api/extractor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchTerm, location }),
      });

      if (!response.ok) {
        throw new Error("Falha na conexão com a API");
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          const data = JSON.parse(line);
          if (data.error) {
            alert(data.error);
            break;
          }
          if (data.lead) {
            setLeads((prev) => [...prev, data.lead]);
          }
        }
      }
    } catch (error) {
      console.error("Erro ao extrair leads:", error);
      alert("Erro ao conectar com a API de extração.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleExportCSV = () => {
    if (leads.length === 0) return;

    const headers = ["Nome", "Telefone", "Categoria", "Nota", "Avaliações", "Endereço"];
    const csvContent = [
      headers.join(","),
      ...leads.map((lead) => [
        `"${lead.name}"`,
        `"${lead.phone}"`,
        `"${lead.category}"`,
        lead.rating,
        lead.reviews,
        `"${lead.address}"`,
      ].join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `leads_${searchTerm.replace(/\s+/g, "_")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportToDispatch = async () => {
    const selectedLeads = leads.filter((l) => l.selected);
    if (selectedLeads.length === 0) return;

    try {
      let crmOkCount = 0;
      if (sendToCrmAutomatically) {
        const responses = await Promise.all(
          selectedLeads.map((lead) =>
            fetch("/api/crm/leads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: lead.name,
                phone: lead.phone,
                origin: "maps_extractor",
                status: "Novo Lead",
                tags: [lead.category].filter(Boolean),
                company: lead.name,
              }),
            })
          )
        );
        crmOkCount = responses.filter((r) => r.ok).length;
      }

      alert(
        `${selectedLeads.length} leads importados para a fila de disparo!${
          sendToCrmAutomatically ? ` ${crmOkCount} também enviados para o CRM.` : ""
        }`
      );
    } catch (error) {
      console.error("Erro ao importar leads:", error);
      alert("Erro ao importar leads para o disparador.");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Extrator Google Maps</h1>
          <p className="text-muted-foreground mt-1">Encontre novos clientes pesquisando diretamente no Google Maps.</p>
        </div>
        {isMockMode && (
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 px-4 py-2 rounded-lg text-sm font-medium animate-pulse">
            Modo de Simulação Ativado (API sem créditos)
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">O que você busca?</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input type="text" placeholder="Ex: Restaurantes, Academias..." className="w-full pl-10 pr-4 py-2 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Onde?</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input type="text" placeholder="Ex: São Paulo, SP" className="w-full pl-10 pr-4 py-2 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={handleExtract} disabled={isExtracting || !searchTerm || !location} className="w-full inline-flex items-center justify-center rounded-lg bg-primary h-10 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {isExtracting ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Extraindo Leads...</>) : (<><Search className="mr-2 h-4 w-4" />Extrair Leads</>)}
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input id="send-crm-auto" type="checkbox" checked={sendToCrmAutomatically} onChange={(e) => setSendToCrmAutomatically(e.target.checked)} className="h-4 w-4 rounded border-border" />
          <label htmlFor="send-crm-auto" className="text-sm text-muted-foreground">Enviar para CRM automaticamente ao importar selecionados</label>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">Resultados ({leads.length})</h2>
            {selectedCount > 0 && <span className="text-sm text-primary font-medium">{selectedCount} selecionados</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExportCSV} disabled={leads.length === 0} className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"><Download className="mr-2 h-4 w-4" />Exportar CSV</button>
            <button onClick={handleImportToDispatch} disabled={selectedCount === 0} className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"><Send className="mr-2 h-4 w-4" />Enviar para Disparo</button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden overflow-x-auto">
          <table className="w-full text-left min-w-[800px]">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-4 w-10"><button onClick={toggleSelectAll} className="text-muted-foreground hover:text-primary transition-colors">{leads.every((l) => l.selected) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}</button></th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Empresa</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Telefone</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categoria</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nota</th>
                <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Endereço</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-accent/30 transition-colors group">
                  <td className="px-4 py-4"><button onClick={() => toggleSelect(lead.id)} className="text-muted-foreground hover:text-primary transition-colors">{lead.selected ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}</button></td>
                  <td className="px-4 py-4 font-medium">{lead.name}</td>
                  <td className="px-4 py-4 text-muted-foreground">{lead.phone}</td>
                  <td className="px-4 py-4"><span className="text-xs px-2 py-1 rounded bg-muted font-medium">{lead.category}</span></td>
                  <td className="px-4 py-4"><div className="flex items-center gap-1"><span className="text-sm font-bold text-amber-500">{lead.rating}</span><span className="text-xs text-muted-foreground">({lead.reviews})</span></div></td>
                  <td className="px-4 py-4 text-xs text-muted-foreground truncate max-w-xs" title={lead.address}>{lead.address}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
