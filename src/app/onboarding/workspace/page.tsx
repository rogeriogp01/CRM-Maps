/**
 * ROGA-81 (Fase 5 de ROGA-49) — tela de onboarding pos-signup.
 *
 * Esta rota e o destino do redirect quando:
 *  - O middleware (ROGA_REQUIRE_WORKSPACE_CLAIM=1) detecta sessao sem
 *    claim `workspace_id` em uma rota autenticada.
 *  - `ensureUserHasWorkspace()` (layout do dashboard) detecta zero
 *    memberships na tabela `workspace_members`.
 *
 * Mostra o formulario unico de criacao em modo "onboarding": ao
 * submeter, o backend cria o workspace, insere o usuario como `owner` e
 * grava o claim no `app_metadata`. O form chama `refreshSession()` antes
 * de mandar o usuario para `/`.
 */

import { WorkspaceForm } from "@/components/workspace/WorkspaceForm";
import { MapPin } from "lucide-react";

export default function OnboardingWorkspacePage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string }>;
}) {
  // Mantemos `searchParams` como Promise para alinhar com o tipo das
  // novas APIs do Next 15. Nao usamos o valor agora — o redirect e
  // sempre para "/" apos criar. (Usar `from` aqui seria um vetor
  // potencial de open-redirect; deliberadamente ignorado por enquanto.)
  void searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden p-6">
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.05)_0%,transparent_50%)]"></div>
      <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(circle_at_70%_80%,rgba(59,130,246,0.05)_0%,transparent_50%)]"></div>

      <div className="w-full max-w-lg relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-4 shadow-xl shadow-primary/10">
            <MapPin size={32} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Crie seu primeiro workspace
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Workspaces sao tenants isolados — voce pode ter quantos quiser
            depois.
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          <WorkspaceForm mode="onboarding" redirectTo="/" />
        </div>
      </div>
    </div>
  );
}
