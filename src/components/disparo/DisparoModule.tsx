"use client";

import {
  FileUp,
  MessageSquare,
  Paperclip,
  Clock,
  Play,
  Pause,
  Square,
  X,
  Image as ImageIcon,
  Plus,
  RefreshCcw,
  AlertTriangle,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { SUPPORTED_VARS, VAR_LABELS, type SupportedVar } from "@/lib/template";
import { RecipientsSection } from "./RecipientsSection";
import { formatPhone } from "@/lib/phone";

type AccountStatus = "connected" | "disconnected" | "connecting" | "error";

type ConnectedAccount = {
  id: string;
  name: string;
  phone: string | null;
  status: AccountStatus;
};

type CampaignLead = {
  id: number | string;
  phone: string;
  name: string;
  status: "pending" | "sent" | "failed";
  time: string;
  accountName?: string;
  accountId?: string;
  variation?: number;
  messageUsed?: string;
  error?: string;
};

const MAX_MESSAGES = 5;

export function DisparoModule() {
  const [activeTab, setActiveTab] = useState(0);
  const [messages, setMessages] = useState<string[]>([
    "Ola {{nome}}, tudo bem? Mensagem 1 aqui.",
    "Oi {{nome}}, como vai? Mensagem 2.",
    "",
    "",
    "",
  ]);
  const [delayMin, setDelayMin] = useState(2);
  const [delayMax, setDelayMax] = useState(5);
  const [pauseMinutes, setPauseMinutes] = useState(15);
  const [pauseEvery, setPauseEvery] = useState(50);
  const [isCampaignRunning, setIsCampaignRunning] = useState(false);
  const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
  const [isVarMenuOpen, setIsVarMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const varMenuRef = useRef<HTMLDivElement | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [currentAccountName, setCurrentAccountName] = useState<string | null>(null);
  const [restingUntil, setRestingUntil] = useState<number | null>(null);

  // Destinatários da campanha vêm do banco (tabela campaign_leads).
  // RecipientsSection é a fonte da verdade — popula este estado via onLeadsChange.
  const [campaignStatus, setCampaignStatus] = useState<CampaignLead[]>([]);

  const messageIndexRef = useRef(0);
  const sentPhonesRef = useRef<Set<string>>(new Set());
  const sentCountRef = useRef(0);

  const activeAccounts = connectedAccounts.filter((a) => a.status === "connected");

  const completedCount = campaignStatus.filter((s) => s.status === "sent" || s.status === "failed").length;
  const progress = campaignStatus.length > 0 ? Math.round((completedCount / campaignStatus.length) * 100) : 0;

  const loadAccounts = async () => {
    try {
      const response = await fetch("/api/whatsapp/accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) return;
      setConnectedAccounts(payload.accounts ?? []);
    } catch {
      // noop
    }
  };

  useEffect(() => {
    loadAccounts();
    const timer = setInterval(loadAccounts, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isCampaignRunning) return;

    if (restingUntil && Date.now() < restingUntil) {
      const restTimer = setTimeout(() => setRestingUntil(null), restingUntil - Date.now());
      return () => clearTimeout(restTimer);
    }

    const pendingIndex = campaignStatus.findIndex((s) => s.status === "pending");
    if (pendingIndex === -1) {
      setIsCampaignRunning(false);
      setCurrentAccountName(null);
      return;
    }

    const validMessages = messages.map((m, i) => ({ text: m, idx: i })).filter((m) => m.text.trim() !== "");
    if (validMessages.length === 0 || activeAccounts.length === 0) {
      setIsCampaignRunning(false);
      alert("Adicione pelo menos uma mensagem e tenha uma conta conectada.");
      return;
    }

    const nextLead = campaignStatus[pendingIndex];
    if (sentPhonesRef.current.has(nextLead.phone)) {
      setCampaignStatus((prev) => {
        const clone = [...prev];
        clone[pendingIndex] = { ...clone[pendingIndex], status: "failed", error: "Duplicado bloqueado", time: new Date().toLocaleTimeString("pt-BR") };
        return clone;
      });
      return;
    }

    const delay = Math.floor(Math.random() * (Math.max(delayMax, delayMin) - Math.min(delayMin, delayMax) + 1) + Math.min(delayMin, delayMax)) * 1000;

    const timer = setTimeout(async () => {
      const msgObj = validMessages[messageIndexRef.current % validMessages.length];
      messageIndexRef.current += 1;

      const stamp = () =>
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

      try {
        const response = await fetch("/api/whatsapp/dispatch/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: String(nextLead.id),
            messageTemplate: msgObj.text,
            variationIndex: msgObj.idx,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        const now = stamp();

        if (response.ok && payload && payload.ok === true) {
          setCurrentAccountName(payload.accountName ?? null);
          setCampaignStatus((prev) => {
            const clone = [...prev];
            clone[pendingIndex] = {
              ...clone[pendingIndex],
              status: "sent",
              error: undefined,
              time: now,
              accountName: payload.accountName,
              accountId: payload.accountId,
              variation: msgObj.idx + 1,
              messageUsed: payload.renderedMessage ?? msgObj.text,
            };
            return clone;
          });

          sentPhonesRef.current.add(nextLead.phone);
          sentCountRef.current += 1;

          if (pauseEvery > 0 && sentCountRef.current % pauseEvery === 0) {
            setRestingUntil(Date.now() + pauseMinutes * 60 * 1000);
          }
        } else {
          // Erro de negócio (ok:false) ou HTTP error
          const errCode: string = payload?.error ?? "SEND_FAILED";
          const errDetail: string | undefined = payload?.finalError;
          const errLabel = errDetail ? `${errCode}: ${errDetail}` : errCode;

          setCampaignStatus((prev) => {
            const clone = [...prev];
            clone[pendingIndex] = {
              ...clone[pendingIndex],
              status: "failed",
              error: errLabel,
              time: now,
              variation: msgObj.idx + 1,
            };
            return clone;
          });
        }
      } catch (error) {
        const now = stamp();
        const message = error instanceof Error ? error.message : "Erro no envio";
        setCampaignStatus((prev) => {
          const clone = [...prev];
          clone[pendingIndex] = {
            ...clone[pendingIndex],
            status: "failed",
            error: message,
            time: now,
          };
          return clone;
        });
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [isCampaignRunning, campaignStatus, delayMin, delayMax, messages, activeAccounts.length, pauseEvery, pauseMinutes, restingUntil]);

  const updateMessage = (index: number, value: string) => {
    const newMessages = [...messages];
    newMessages[index] = value;
    setMessages(newMessages);
  };

  const insertVariable = (variable: SupportedVar) => {
    const token = `{{${variable}}}`;
    const ta = textareaRef.current;
    const current = messages[activeTab] ?? "";
    if (ta && typeof ta.selectionStart === "number") {
      const start = ta.selectionStart;
      const end = ta.selectionEnd ?? start;
      const next = current.slice(0, start) + token + current.slice(end);
      updateMessage(activeTab, next);
      // recoloca o cursor depois do token inserido
      requestAnimationFrame(() => {
        ta.focus();
        const cursor = start + token.length;
        ta.setSelectionRange(cursor, cursor);
      });
    } else {
      updateMessage(activeTab, current + token);
    }
    setIsVarMenuOpen(false);
  };

  useEffect(() => {
    if (!isVarMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (varMenuRef.current && !varMenuRef.current.contains(e.target as Node)) {
        setIsVarMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isVarMenuOpen]);

  const handleGenerateVariations = async () => {
    if (isGeneratingVariations || isCampaignRunning) return;
    const baseMessage = messages[activeTab]?.trim() ?? "";
    if (baseMessage === "") {
      alert("Escreva uma mensagem base na aba atual para gerar variações.");
      return;
    }
    setIsGeneratingVariations(true);
    try {
      const response = await fetch("/api/ai/message-variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseMessage, count: 5 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errMsg = (payload && (payload as { error?: string }).error) || "Erro desconhecido";
        throw new Error(errMsg);
      }
      const variations = (payload as { variations?: unknown }).variations;
      if (!Array.isArray(variations) || variations.length === 0) {
        throw new Error("A IA não retornou variações válidas.");
      }
      const cleaned = variations
        .filter((v): v is string => typeof v === "string")
        .slice(0, MAX_MESSAGES);
      const padded = [...cleaned];
      while (padded.length < MAX_MESSAGES) padded.push("");
      setMessages(padded.slice(0, MAX_MESSAGES));
      setActiveTab(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao gerar variações";
      alert("Erro ao gerar variações: " + message);
    } finally {
      setIsGeneratingVariations(false);
    }
  };

  const handleStartCampaign = () => {
    if (campaignStatus.every((s) => s.status !== "pending")) {
      setCampaignStatus((prev) => prev.map((s) => ({ ...s, status: "pending", time: "-", accountName: undefined, variation: undefined, error: undefined, messageUsed: undefined, accountId: undefined })));
      messageIndexRef.current = 0;
      sentPhonesRef.current.clear();
      sentCountRef.current = 0;
      setRestingUntil(null);
    }
    setIsCampaignRunning(true);
  };

  const handleStopCampaign = () => {
    setIsCampaignRunning(false);
    setCurrentAccountName(null);
  };

  return (
    <div className="space-y-8 pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">Disparo em Massa</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">Configure sua campanha, defina as mensagens rotativas e inicie o envio.</p>
        </div>
        <div className="relative z-10 flex gap-3 w-full sm:w-auto">
          {!isCampaignRunning ? (
            <button onClick={handleStartCampaign} className="group flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-green-500 to-green-600 px-8 py-3 text-sm font-bold text-white hover:from-green-600 hover:to-green-700 transition-all shadow-lg shadow-green-500/30 hover:shadow-green-500/50 hover:-translate-y-0.5 active:translate-y-0">
              <Play className="mr-2 h-5 w-5 fill-current group-hover:scale-110 transition-transform" />Iniciar Campanha
            </button>
          ) : (
            <div className="flex gap-2 w-full sm:w-auto">
              <button className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3 text-sm font-bold text-white hover:from-amber-600 hover:to-amber-700 transition-all shadow-lg shadow-amber-500/30 hover:-translate-y-0.5">
                <Pause className="mr-2 h-5 w-5 fill-current" />Pausar
              </button>
              <button onClick={handleStopCampaign} className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-destructive/90 to-destructive px-6 py-3 text-sm font-bold text-white hover:from-destructive hover:to-destructive/90 transition-all shadow-lg shadow-destructive/30 hover:-translate-y-0.5">
                <Square className="mr-2 h-5 w-5 fill-current" />Parar
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-6">
          <RecipientsSection
            onLeadsChange={(rows) => {
              // Mapeia os destinatários do banco para o formato CampaignLead consumido
              // pelo useEffect do disparador. Preserva status atualizado (sent/failed)
              // de execuções anteriores; só leads "pending" entram na fila.
              setCampaignStatus((prev) => {
                const prevById = new Map(prev.map((p) => [String(p.id), p]));
                return rows.map((r) => {
                  const existing = prevById.get(r.id);
                  if (existing) return existing;
                  const display = formatPhone(r.phone_normalized) || r.phone;
                  return {
                    id: r.id,
                    phone: display,
                    name: r.name ?? "(sem nome)",
                    status: (r.status === "sent" || r.status === "failed" ? r.status : "pending") as CampaignLead["status"],
                    time: "-",
                  } satisfies CampaignLead;
                });
              });
            }}
          />

          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden flex flex-col h-[500px]">
            <div className="border-b border-border bg-muted/40 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg"><MessageSquare className="h-5 w-5 text-primary" /></div>
                <div><h3 className="font-semibold text-lg leading-tight">Mensagens Rotativas</h3><p className="text-xs text-muted-foreground">O sistema intercala as abas para evitar bloqueios</p></div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleGenerateVariations}
                  disabled={isGeneratingVariations || isCampaignRunning}
                  className="group inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-purple-500 to-fuchsia-600 px-4 py-2 text-xs font-bold text-white hover:from-purple-600 hover:to-fuchsia-700 transition-all shadow-md shadow-purple-500/30 hover:shadow-purple-500/50 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                  title={isCampaignRunning ? "Pause a campanha para gerar variações" : "Gera 5 variações com IA a partir da aba atual"}
                >
                  {isGeneratingVariations ? (
                    <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                  )}
                  {isGeneratingVariations ? "Gerando..." : "Gerar Variações com IA"}
                </button>
                <div className="flex items-center gap-2 bg-background px-3 py-1.5 rounded-full border border-border shadow-sm"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span></span><span className="text-xs font-semibold text-foreground">Anti-Spam Ativo</span></div>
              </div>
            </div>

            <div className="p-6 flex flex-col flex-1">
              <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                {messages.map((_, i) => (
                  <button key={i} onClick={() => setActiveTab(i)} className={`relative px-5 py-2.5 rounded-xl text-sm font-medium transition-all flex-shrink-0 overflow-hidden ${activeTab === i ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-100" : "bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground scale-95 hover:scale-100"}`}>
                    {activeTab === i && <span className="absolute inset-0 bg-white/10" />}
                    <span className="relative flex items-center gap-2">Mensagem {i + 1}<span className={`w-2 h-2 rounded-full transition-colors ${messages[i].length > 0 ? (activeTab === i ? "bg-white" : "bg-green-500") : "bg-transparent"}`} /></span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col flex-1 gap-4">
                <div className="relative flex-1 flex flex-col group">
                  <textarea ref={textareaRef} className="flex-1 w-full p-5 rounded-xl border border-input bg-background/50 hover:bg-background focus:bg-background focus:ring-2 focus:ring-primary/50 outline-none resize-none transition-all font-sans text-base leading-relaxed shadow-inner" placeholder={`Escreva o texto para a Variacao ${activeTab + 1}...`} value={messages[activeTab]} onChange={(e) => updateMessage(activeTab, e.target.value)} />
                  <div className="absolute bottom-4 right-4 text-xs font-medium text-muted-foreground bg-secondary/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-border shadow-sm transition-opacity group-focus-within:opacity-100">{messages[activeTab].length} caracteres</div>
                </div>

                <div className="flex flex-wrap items-center gap-2 bg-secondary/30 p-3 rounded-xl border border-border">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider ml-1 mr-2">Inserir Variavel:</span>
                  {(["nome", "empresa", "endereco", "telefone"] as SupportedVar[]).map((v) => (
                    <button key={v} onClick={() => insertVariable(v)} className="text-xs px-4 py-2 rounded-lg bg-background hover:bg-primary hover:text-primary-foreground hover:shadow-md transition-all border border-border font-medium">{`{{${v}}}`}</button>
                  ))}
                  <div className="relative ml-auto" ref={varMenuRef}>
                    <button
                      onClick={() => setIsVarMenuOpen((v) => !v)}
                      className="text-xs px-4 py-2 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 hover:from-primary/20 hover:to-primary/10 hover:shadow-md transition-all border border-primary/30 text-primary font-semibold inline-flex items-center gap-1.5"
                      type="button"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Inserir Variavel
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isVarMenuOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isVarMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden">
                        <div className="px-3 py-2 bg-muted/40 border-b border-border">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Variaveis disponiveis</span>
                        </div>
                        <div className="max-h-72 overflow-y-auto p-1">
                          {SUPPORTED_VARS.map((v) => (
                            <button
                              key={v}
                              onClick={() => insertVariable(v)}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-secondary transition-colors flex items-center justify-between gap-3 group"
                              type="button"
                            >
                              <span className="text-xs text-foreground font-medium">{VAR_LABELS[v]}</span>
                              <code className="text-[10px] font-mono text-muted-foreground bg-secondary/60 group-hover:bg-background px-2 py-0.5 rounded">{`{{${v}}}`}</code>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-3"><div className="p-2 bg-primary/10 rounded-lg"><Paperclip className="h-5 w-5 text-primary" /></div><h3 className="font-semibold text-lg">Midia Adicional</h3></div><button className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors flex items-center bg-primary/5 hover:bg-primary/10 px-4 py-2 rounded-lg"><Plus className="h-4 w-4 mr-2" />Anexar Arquivo</button></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div className="p-3 rounded-xl border border-border bg-gradient-to-b from-secondary/50 to-background flex items-center justify-between group hover:border-primary/30 transition-colors shadow-sm"><div className="flex items-center gap-3 overflow-hidden"><div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0"><ImageIcon className="h-5 w-5 text-blue-500" /></div><div className="flex flex-col truncate"><span className="text-sm font-medium truncate">flyer_promo.jpg</span><span className="text-xs text-muted-foreground">1.2 MB</span></div></div><button className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"><X className="h-4 w-4" /></button></div></div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="rounded-2xl border border-border bg-card shadow-sm p-6">
            <h3 className="font-semibold text-lg mb-4">Contas Ativas</h3>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Conectadas agora</span>
              <span className="text-lg font-bold text-primary">{activeAccounts.length}</span>
            </div>
            <div className="text-xs text-muted-foreground mb-3">Conta em uso: <span className="text-foreground font-semibold">{currentAccountName ?? "Aguardando envio"}</span></div>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {connectedAccounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                  <span className="truncate mr-2">{account.name}</span>
                  <span className={account.status === "connected" ? "text-green-500" : account.status === "connecting" ? "text-amber-500" : "text-destructive"}>{account.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden relative group">
            {isCampaignRunning && <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-blue-400 to-primary background-animate" style={{ backgroundSize: "200% 200%", animation: "gradient 2s ease infinite" }} />}
            <div className="p-6">
              <div className="flex items-center justify-between mb-6"><h3 className="font-semibold text-lg">Estatisticas</h3>{isCampaignRunning && <span className="text-xs font-bold text-primary animate-pulse bg-primary/10 px-2 py-1 rounded-md">RODANDO</span>}</div>
              <div className="flex items-center justify-center mb-8 relative"><svg className="w-32 h-32 transform -rotate-90"><circle cx="64" cy="64" r="56" className="stroke-muted fill-none" strokeWidth="12" /><circle cx="64" cy="64" r="56" className="stroke-primary fill-none transition-all duration-1000 ease-out" strokeWidth="12" strokeDasharray="351.8" strokeDashoffset={351.8 - (351.8 * progress) / 100} strokeLinecap="round" /></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-3xl font-bold">{progress}%</span><span className="text-xs text-muted-foreground font-medium">Concluido</span></div></div>
              <div className="grid grid-cols-2 gap-3"><div className="p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-green-500/5 border border-green-500/20"><div className="text-green-600 font-bold text-2xl">{campaignStatus.filter((s) => s.status === "sent").length}</div><div className="text-xs font-semibold text-green-600/80 mt-1 uppercase tracking-wider">Entregues</div></div><div className="p-4 rounded-xl bg-gradient-to-br from-destructive/10 to-destructive/5 border border-destructive/20"><div className="text-destructive font-bold text-2xl">{campaignStatus.filter((s) => s.status === "failed").length}</div><div className="text-xs font-semibold text-destructive/80 mt-1 uppercase tracking-wider">Falhas</div></div></div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm p-6">
            <div className="flex items-center gap-3 mb-6"><div className="p-2 bg-primary/10 rounded-lg"><Clock className="h-5 w-5 text-primary" /></div><h3 className="font-semibold text-lg">Temporizador</h3></div>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-end mb-3"><label className="text-sm font-medium text-foreground">Atraso Aleatorio</label><span className="text-[10px] uppercase font-bold text-muted-foreground bg-secondary px-2 py-1 rounded">Anti-spam</span></div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1"><input type="number" className="w-full pl-3 pr-8 py-2.5 rounded-xl border border-input bg-background font-medium text-center focus:ring-2 focus:ring-primary/50 outline-none transition-all" value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">s</span></div>
                  <span className="text-muted-foreground font-medium">-</span>
                  <div className="relative flex-1"><input type="number" className="w-full pl-3 pr-8 py-2.5 rounded-xl border border-input bg-background font-medium text-center focus:ring-2 focus:ring-primary/50 outline-none transition-all" value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value))} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">s</span></div>
                </div>
              </div>
              <div className="pt-5 border-t border-border">
                <label className="text-sm font-medium text-foreground block mb-3">Descanso Automatico</label>
                <div className="bg-secondary/50 rounded-xl p-4 border border-border/50 text-sm flex items-center justify-center flex-wrap gap-x-2 gap-y-3">
                  <span className="text-muted-foreground">Pausa de</span>
                  <input type="number" value={pauseMinutes} onChange={(e) => setPauseMinutes(Number(e.target.value))} className="w-14 px-1 py-1.5 rounded-md border border-input bg-background text-center font-semibold focus:ring-2 focus:ring-primary/50 outline-none" />
                  <span className="text-muted-foreground">minutos a cada</span>
                  <input type="number" value={pauseEvery} onChange={(e) => setPauseEvery(Number(e.target.value))} className="w-14 px-1 py-1.5 rounded-md border border-input bg-background text-center font-semibold focus:ring-2 focus:ring-primary/50 outline-none" />
                  <span className="text-muted-foreground">envios</span>
                </div>
                {restingUntil && Date.now() < restingUntil && <div className="mt-3 text-xs text-amber-500 flex items-center gap-2"><RefreshCcw className="h-3 w-3 animate-spin" />Descanso ativo para protecao anti-spam.</div>}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm flex flex-col h-[350px]">
            <div className="px-6 py-4 border-b border-border bg-muted/40 flex items-center justify-between"><h3 className="font-semibold text-lg">Log ao Vivo</h3><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span></span></div>
            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
              <div className="space-y-1">
                {campaignStatus.map((item) => (
                  <div key={item.id} className="p-3 rounded-xl flex items-center justify-between hover:bg-secondary/50 transition-colors group cursor-default">
                    <div className="flex flex-col overflow-hidden mr-2">
                      <span className="text-sm font-semibold truncate text-foreground group-hover:text-primary transition-colors">{item.name}</span>
                      <span className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.phone}</span>
                      {(item.accountName || item.variation) && <div className="flex gap-2 mt-1"><span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Var {item.variation}</span><span className="text-[9px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded truncate max-w-[100px] font-medium">{item.accountName}</span></div>}
                      {item.messageUsed && <span className="text-[10px] text-muted-foreground mt-1 truncate">Msg: {item.messageUsed}</span>}
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0">
                      {item.status === "sent" ? <span className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md bg-green-500/10 text-green-600 font-bold">Enviado</span> : item.status === "failed" ? <span className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md bg-destructive/10 text-destructive font-bold" title={item.error}>Falha</span> : <span className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md bg-secondary text-muted-foreground font-bold border border-border/50">Na Fila</span>}
                      <span className="text-[10px] text-muted-foreground mt-1.5 font-medium">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <button className="py-3 text-xs font-bold text-muted-foreground hover:text-foreground bg-secondary/30 hover:bg-secondary/80 border-t border-border transition-colors w-full rounded-b-2xl">ABRIR RELATORIO DETALHADO</button>
          </div>
        </div>
      </div>

    </div>
  );
}
