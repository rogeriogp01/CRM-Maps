"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Send } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import type { ConversationRow, MessageRow } from "./InboxModule";

type Props = {
  conversation: ConversationRow | null;
  messages: MessageRow[];
  isLoading: boolean;
  onSendText: (text: string) => Promise<boolean>;
  onSendAttachment: (file: File, caption: string | null) => Promise<boolean>;
};

export function ChatView({
  conversation,
  messages,
  isLoading,
  onSendText,
  onSendAttachment,
}: Props) {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, conversation?.id]);

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Selecione uma conversa
      </div>
    );
  }

  const displayName =
    conversation.crm_leads?.name ??
    conversation.contact_name ??
    conversation.contact_jid.split("@")[0];

  async function handleSend() {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    const ok = await onSendText(text);
    if (ok) setText("");
    setIsSending(false);
  }

  async function handleFile(file: File) {
    setIsSending(true);
    await onSendAttachment(file, text || null);
    setText("");
    setIsSending(false);
  }

  return (
    <>
      <header className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
          {displayName.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{displayName}</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {conversation.contact_jid.split("@")[0]}
            {conversation.crm_leads?.status &&
              ` • ${conversation.crm_leads.status}`}
          </p>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 py-4 space-y-2 bg-background/30"
      >
        {isLoading ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Carregando mensagens...
          </div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Sem mensagens ainda.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} msg={m} />)
        )}
      </div>

      <footer className="border-t border-border p-3 flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
          className="h-10 w-10 shrink-0 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"
          title="Anexar arquivo"
        >
          <Paperclip className="h-5 w-5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="Digite uma mensagem..."
          className="flex-1 resize-none rounded-lg bg-muted/50 border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 max-h-32"
          disabled={isSending}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isSending || !text.trim()}
          className="h-10 w-10 shrink-0 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center"
          title="Enviar"
        >
          <Send className="h-5 w-5" />
        </button>
      </footer>
    </>
  );
}
