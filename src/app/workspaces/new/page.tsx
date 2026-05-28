/**
 * ROGA-81 (Fase 5 de ROGA-49) — criar workspace adicional.
 *
 * Acessado a partir do `<WorkspaceSwitcher />` no header global. Reusa
 * o mesmo `<WorkspaceForm />`, mas em modo "additional": o backend
 * preserva o claim atual (`onlyIfMissing=true`), entao o usuario
 * continua logado no workspace atual e ve o novo no switcher.
 */

import Link from "next/link";
import { WorkspaceForm } from "@/components/workspace/WorkspaceForm";
import { ArrowLeft, Building2 } from "lucide-react";

export default function NewWorkspacePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden p-6">
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.05)_0%,transparent_50%)]"></div>
      <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_70%_80%,rgba(59,130,246,0.05)_0%,transparent_50%)]"></div>

      <div className="w-full max-w-lg relative z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4 shadow-xl shadow-primary/10">
            <Building2 size={32} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Novo workspace
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Voce continuara no workspace atual. Use o seletor no topo da
            app para alternar.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          <WorkspaceForm mode="additional" redirectTo="/" />
        </div>
      </div>
    </div>
  );
}
