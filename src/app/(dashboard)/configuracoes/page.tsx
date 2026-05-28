"use client";

import { useEffect, useState } from "react";
import { User, Phone, Building2, Globe, Save, RefreshCcw } from "lucide-react";

type SystemSettings = {
  operator_name: string | null;
  operator_whatsapp: string | null;
  company_name: string | null;
  company_website: string | null;
};

export default function ConfiguracoesPage() {
  const [operatorName, setOperatorName] = useState("");
  const [operatorWhatsapp, setOperatorWhatsapp] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Erro ao carregar");
      const settings = (payload?.settings ?? {}) as SystemSettings;
      setOperatorName(settings.operator_name ?? "");
      setOperatorWhatsapp(settings.operator_whatsapp ?? "");
      setCompanyName(settings.company_name ?? "");
      setCompanyWebsite(settings.company_website ?? "");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      alert("Falha ao carregar configurações: " + message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator_name: operatorName,
          operator_whatsapp: operatorWhatsapp,
          company_name: companyName,
          company_website: companyWebsite,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "Erro ao salvar");
      alert("Configurações salvas com sucesso!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      alert("Falha ao salvar: " + message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 pb-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
            Configurações
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Gerencie as preferências da sua conta e integração com APIs.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border bg-muted/40 px-6 py-5 flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-lg leading-tight">Identidade do Operador</h3>
            <p className="text-xs text-muted-foreground">
              Estes valores substituem <code className="px-1 py-0.5 bg-secondary rounded text-[10px]">{`{{meu_nome}}`}</code>,{" "}
              <code className="px-1 py-0.5 bg-secondary rounded text-[10px]">{`{{meu_whatsapp}}`}</code>,{" "}
              <code className="px-1 py-0.5 bg-secondary rounded text-[10px]">{`{{minha_empresa}}`}</code> e{" "}
              <code className="px-1 py-0.5 bg-secondary rounded text-[10px]">{`{{meu_site}}`}</code>{" "}
              automaticamente em todas as mensagens enviadas.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCcw className="h-5 w-5 animate-spin mr-2" />
              Carregando configurações...
            </div>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Meu nome"
                  icon={<User className="h-4 w-4 text-muted-foreground" />}
                  placeholder="Ex.: Rogério"
                  value={operatorName}
                  onChange={setOperatorName}
                  helper={`Substitui {{meu_nome}}`}
                />
                <Field
                  label="Meu WhatsApp"
                  icon={<Phone className="h-4 w-4 text-muted-foreground" />}
                  placeholder="Ex.: +55 11 99999-9999"
                  value={operatorWhatsapp}
                  onChange={setOperatorWhatsapp}
                  helper={`Substitui {{meu_whatsapp}}`}
                />
                <Field
                  label="Minha empresa"
                  icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
                  placeholder="Ex.: MapDisparo"
                  value={companyName}
                  onChange={setCompanyName}
                  helper={`Substitui {{minha_empresa}}`}
                />
                <Field
                  label="Meu site"
                  icon={<Globe className="h-4 w-4 text-muted-foreground" />}
                  placeholder="Ex.: mapdisparo.com"
                  value={companyWebsite}
                  onChange={setCompanyWebsite}
                  helper={`Substitui {{meu_site}}`}
                />
              </div>

              <div className="flex justify-end pt-4 border-t border-border">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-primary to-primary/80 px-6 py-3 text-sm font-bold text-primary-foreground hover:from-primary/90 hover:to-primary/70 transition-all shadow-lg shadow-primary/30 hover:shadow-primary/50 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                >
                  {isSaving ? (
                    <>
                      <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Salvar configurações
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  value,
  onChange,
  placeholder,
  helper,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  helper: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground flex items-center gap-2">
        {icon}
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2.5 rounded-xl border border-input bg-background/50 hover:bg-background focus:bg-background focus:ring-2 focus:ring-primary/50 outline-none transition-all text-sm"
      />
      <p className="text-[11px] text-muted-foreground font-mono ml-1">{helper}</p>
    </div>
  );
}
