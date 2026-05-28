"use client";

import {
  Plus,
  Trash2,
  Power,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  MoreVertical,
  QrCode,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type AccountStatus = "connected" | "disconnected" | "connecting" | "error";

type Account = {
  id: string;
  name: string;
  phone: string | null;
  status: AccountStatus;
  session_id: string;
  last_connection_at: string | null;
  created_at: string;
  updated_at: string;
};

function formatDate(value: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  return date.toLocaleString("pt-BR");
}

export function AccountTable() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [showQrModal, setShowQrModal] = useState(false);
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState<AccountStatus | "idle">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/whatsapp/accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar contas");
      setAccounts(payload.accounts ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar contas";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
    const timer = setInterval(loadAccounts, 5000);
    return () => clearInterval(timer);
  }, [loadAccounts]);

  const activeAccountLabel = useMemo(() => {
    if (!activeAccount) return "";
    return activeAccount.phone ? `${activeAccount.name} (${activeAccount.phone})` : activeAccount.name;
  }, [activeAccount]);

  const handleCreateAccount = async () => {
    const name = newAccountName.trim();
    if (!name) return;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/whatsapp/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível criar a conta");

      setNewAccountName("");
      await loadAccounts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao criar conta";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const openQrModal = async (account: Account) => {
    setShowQrModal(true);
    setActiveAccount(account);
    setQrCode(null);
    setQrStatus("connecting");
    setErrorMessage(null);

    try {
      await fetch(`/api/whatsapp/accounts/${account.id}/connect`, { method: "POST" });

      const qrResponse = await fetch(`/api/whatsapp/accounts/${account.id}/qr`, { cache: "no-store" });
      const qrPayload = await qrResponse.json();

      if (!qrResponse.ok) {
        throw new Error(qrPayload.error ?? "Falha ao gerar QR Code");
      }

      setQrCode(qrPayload.qr ?? null);
      setQrStatus((qrPayload.status as AccountStatus) ?? "connecting");
      await loadAccounts();
    } catch (error) {
      setQrStatus("error");
      const message = error instanceof Error ? error.message : "Falha ao gerar QR Code";
      setErrorMessage(message);
    }
  };

  const handleReconnect = async (account: Account) => {
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/whatsapp/accounts/${account.id}/connect`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao reconectar conta");
      await loadAccounts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao reconectar conta";
      setErrorMessage(message);
    }
  };

  const handleDisconnect = async (account: Account) => {
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/whatsapp/accounts/${account.id}/disconnect`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao desconectar conta");
      await loadAccounts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao desconectar conta";
      setErrorMessage(message);
    }
  };

  const handleDelete = async (account: Account) => {
    const shouldDelete = window.confirm(`Deseja realmente excluir a conta "${account.name}"?`);
    if (!shouldDelete) return;

    setErrorMessage(null);
    try {
      const response = await fetch(`/api/whatsapp/accounts/${account.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao excluir conta");
      await loadAccounts();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao excluir conta";
      setErrorMessage(message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gerenciar Contas</h1>
          <p className="text-muted-foreground mt-1">Conecte e gerencie suas sessões de WhatsApp para disparos em massa.</p>
        </div>
        <div className="flex gap-2 w-full max-w-md">
          <input
            value={newAccountName}
            onChange={(e) => setNewAccountName(e.target.value)}
            placeholder="Nome da nova conta"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            onClick={handleCreateAccount}
            disabled={isSaving || !newAccountName.trim()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Nova Conta
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {errorMessage}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nome da Conta</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Número</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Última Conexão</th>
              <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td className="px-6 py-6 text-muted-foreground" colSpan={5}>Carregando contas...</td>
              </tr>
            )}
            {!isLoading && accounts.length === 0 && (
              <tr>
                <td className="px-6 py-6 text-muted-foreground" colSpan={5}>Nenhuma conta cadastrada ainda.</td>
              </tr>
            )}
            {!isLoading &&
              accounts.map((account) => (
                <tr key={account.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap font-medium">{account.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">{account.phone || "Não vinculado"}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {account.status === "connected" && (
                        <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 font-medium">
                          <CheckCircle2 className="h-3 w-3" />
                          Conectado
                        </span>
                      )}
                      {account.status === "disconnected" && (
                        <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 font-medium">
                          <XCircle className="h-3 w-3" />
                          Desconectado
                        </span>
                      )}
                      {account.status === "connecting" && (
                        <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                          <RefreshCcw className="h-3 w-3 animate-spin" />
                          Conectando
                        </span>
                      )}
                      {account.status === "error" && (
                        <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 font-medium">
                          <AlertTriangle className="h-3 w-3" />
                          Erro
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">{formatDate(account.last_connection_at)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(account.status === "disconnected" || account.status === "error") && (
                        <button
                          onClick={() => openQrModal(account)}
                          className="p-2 rounded-md hover:bg-primary/10 text-primary transition-colors"
                          title="Conectar via QR"
                        >
                          <QrCode className="h-4 w-4" />
                        </button>
                      )}
                      {account.status === "connected" && (
                        <button
                          onClick={() => handleDisconnect(account)}
                          className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                          title="Desconectar"
                        >
                          <Power className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleReconnect(account)}
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground transition-colors"
                        title="Reconectar"
                      >
                        <RefreshCcw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(account)}
                        className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <button className="p-2 rounded-md hover:bg-accent text-muted-foreground transition-colors" title="Mais opções">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showQrModal && activeAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-8 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold">Conectar WhatsApp</h2>
                <p className="text-muted-foreground mt-1">Escaneie o QR da conta {activeAccountLabel}.</p>
              </div>
              <button onClick={() => setShowQrModal(false)} className="text-muted-foreground hover:text-foreground">
                <XCircle size={24} />
              </button>
            </div>

            <div className="bg-white p-6 rounded-xl aspect-square flex items-center justify-center border-4 border-muted">
              {qrCode ? (
                <img src={qrCode} alt="QR Code WhatsApp" className="w-full h-full object-contain" />
              ) : qrStatus === "error" ? (
                <div className="text-center text-red-600 px-4">
                  <AlertTriangle className="mx-auto mb-2" />
                  <p className="text-sm">Falha ao carregar QR Code</p>
                </div>
              ) : (
                <div className="text-slate-500 flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm">Gerando QR Code...</p>
                </div>
              )}
            </div>

            <div className="mt-8 flex gap-3">
              <button
                onClick={() => setShowQrModal(false)}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-medium hover:bg-accent transition-colors"
              >
                Fechar
              </button>
              <button
                onClick={() => openQrModal(activeAccount)}
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Atualizar QR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

