import { InboxModule } from "@/components/inbox/InboxModule";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    // Compensa o p-8 / max-w-7xl do (dashboard)/layout para o Inbox usar
    // toda a largura disponível, sem afetar outros módulos.
    <div className="-m-8">
      <div className="p-4">
        <InboxModule />
      </div>
    </div>
  );
}
