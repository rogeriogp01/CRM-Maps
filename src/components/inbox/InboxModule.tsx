"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { ConversationList } from "./ConversationList";
import { ChatView } from "./ChatView";
import { CrmPanel } from "./CrmPanel";

export type ConversationRow = {
  id: string;
  account_id: string;
  contact_jid: string;
  contact_name: string | null;
  lead_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  updated_at: string;
  crm_leads: { id: string; name: string; status: string } | null;
  whatsapp_accounts: { id: string; name: string; phone: string | null } | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  baileys_message_id: string;
  direction: "in" | "out";
  from_me: boolean;
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "unknown";
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  status: string | null;
  timestamp: string;
};

export function InboxModule() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) {
    supabaseRef.current = createClient();
  }

  // ---------------- Load list ----------------
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/conversations", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro ao carregar conversas");
      setConversations((data?.conversations ?? []) as ConversationRow[]);
    } catch (err) {
      console.error("[inbox] loadConversations failed:", err);
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  // ---------------- Load messages of selected ----------------
  const loadMessages = useCallback(async (conversationId: string) => {
    setIsLoadingMessages(true);
    try {
      const res = await fetch(
        `/api/inbox/conversations/${conversationId}/messages?limit=100`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro ao carregar mensagens");
      setMessages((data?.messages ?? []) as MessageRow[]);
    } catch (err) {
      console.error("[inbox] loadMessages failed:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // ---------------- Mount: list + realtime conversations ----------------
  useEffect(() => {
    loadConversations();
    const sb = supabaseRef.current!;
    const channel = sb
      .channel("inbox-conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversations" },
        () => {
          // Recarrega lista a cada evento (INSERT/UPDATE)
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [loadConversations]);

  // ---------------- Select conversation: load history + subscribe ----------------
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    loadMessages(selectedId);

    // Marca como lida
    fetch(`/api/inbox/conversations/${selectedId}/read`, { method: "POST" }).catch(
      () => {}
    );

    const sb = supabaseRef.current!;
    const channel = sb
      .channel(`inbox-messages-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const newMsg = payload.new as MessageRow;
          setMessages((prev) => {
            // Dedupe se já existe (echo do envio próprio chega via realtime também)
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [selectedId, loadMessages]);

  // ---------------- Send text ----------------
  const handleSendText = useCallback(
    async (text: string) => {
      if (!selectedId || !text.trim()) return false;
      try {
        const res = await fetch(`/api/inbox/conversations/${selectedId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Erro ao enviar");
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert("Falha ao enviar: " + msg);
        return false;
      }
    },
    [selectedId]
  );

  // ---------------- Send attachment ----------------
  const handleSendAttachment = useCallback(
    async (file: File, caption: string | null) => {
      if (!selectedId) return false;
      const fd = new FormData();
      fd.append("file", file);
      if (caption) fd.append("caption", caption);
      try {
        const res = await fetch(`/api/inbox/conversations/${selectedId}/attach`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Erro ao enviar arquivo");
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        alert("Falha ao enviar arquivo: " + msg);
        return false;
      }
    },
    [selectedId]
  );

  const selectedConversation =
    conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="h-[calc(100vh-2rem)] grid grid-cols-12 gap-3">
      {/* LEFT — Conversation list */}
      <aside className="col-span-3 rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          isLoading={isLoadingList}
          onSelect={setSelectedId}
        />
      </aside>

      {/* CENTER — Chat */}
      <main className="col-span-6 rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
        <ChatView
          conversation={selectedConversation}
          messages={messages}
          isLoading={isLoadingMessages}
          onSendText={handleSendText}
          onSendAttachment={handleSendAttachment}
        />
      </main>

      {/* RIGHT — CRM panel */}
      <aside className="col-span-3 rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
        <CrmPanel
          leadId={selectedConversation?.lead_id ?? null}
          onStageChanged={() => loadConversations()}
        />
      </aside>
    </div>
  );
}
