"use client";

import { MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationRow } from "./InboxModule";

type Props = {
  conversations: ConversationRow[];
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (id: string) => void;
};

function initialsOf(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ConversationList({
  conversations,
  selectedId,
  isLoading,
  onSelect,
}: Props) {
  return (
    <>
      <header className="px-4 py-4 border-b border-border flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Conversas</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {conversations.length}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Carregando...
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            Nenhuma conversa ainda. Aguarde mensagens dos leads.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {conversations.map((c) => {
              const isActive = c.id === selectedId;
              const displayName =
                c.crm_leads?.name ?? c.contact_name ?? c.contact_jid.split("@")[0];
              return (
                <li key={c.id}>
                  <button
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      "w-full px-4 py-3 flex items-start gap-3 hover:bg-accent/40 transition-colors text-left",
                      isActive && "bg-accent/60"
                    )}
                  >
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-sm font-semibold text-primary shrink-0">
                      {initialsOf(displayName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium truncate">{displayName}</p>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {timeAgo(c.last_message_at)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {c.last_message_preview ?? "—"}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        {c.whatsapp_accounts?.name && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                            <Phone className="h-2.5 w-2.5" />
                            {c.whatsapp_accounts.name}
                          </span>
                        )}
                        {c.unread_count > 0 && (
                          <span className="ml-auto inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                            {c.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
