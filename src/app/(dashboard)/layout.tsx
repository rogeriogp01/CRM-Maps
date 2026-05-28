import { Sidebar } from "@/components/layout/Sidebar";
import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";
import { ensureUserHasWorkspace } from "@/lib/server/workspace-guard";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ROGA-81 (Fase 5): se o usuario esta autenticado e nao tem nenhum
  // workspace, redireciona para o onboarding antes de renderizar a app.
  // Quando nao ha sessao, segue normalmente (o middleware/login cuida).
  await ensureUserHasWorkspace();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 transition-all duration-300 ml-20 lg:ml-64">
        {/* Header global com o WorkspaceSwitcher (ROGA-81). */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-6 backdrop-blur">
          <WorkspaceSwitcher />
          <div className="text-xs text-muted-foreground">MapDisparo CRM</div>
        </header>
        <div className="p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
