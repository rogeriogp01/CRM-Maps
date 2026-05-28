"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./AudioPlayer";
import { useSignedMediaUrl } from "./useSignedMediaUrl";
import type { MessageRow } from "./InboxModule";

type Props = {
  msg: MessageRow;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function MessageBubble({ msg }: Props) {
  const isOut = msg.direction === "out";

  // ROGA-35: `msg.media_url` pode chegar como storage path (Realtime/INSERT,
  // banco) ou como URL HTTPS (resposta de endpoint que já assinou). O hook
  // distingue e gera signed URL quando necessário, cacheando até o TTL.
  const { url: signedMediaUrl, loading: mediaLoading } = useSignedMediaUrl(msg.media_url);

  const hasMedia = !!signedMediaUrl;

  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          isOut
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        )}
      >
        {/* Render por tipo */}
        {msg.type === "image" && hasMedia && (
          <a href={signedMediaUrl!} target="_blank" rel="noreferrer">
            <img
              src={signedMediaUrl!}
              alt={msg.body ?? "imagem"}
              className="rounded-lg max-w-full mb-1"
            />
          </a>
        )}

        {msg.type === "video" && hasMedia && (
          <video
            src={signedMediaUrl!}
            controls
            className="rounded-lg max-w-full mb-1"
          />
        )}

        {msg.type === "audio" && hasMedia && (
          <AudioPlayer src={signedMediaUrl!} isOut={isOut} />
        )}

        {msg.type === "document" && hasMedia && (
          <a
            href={signedMediaUrl!}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2 underline mb-1",
              isOut ? "text-primary-foreground/90" : "text-primary"
            )}
          >
            <FileText className="h-4 w-4" />
            {msg.body ?? "Documento"}
          </a>
        )}

        {msg.type === "sticker" && hasMedia && (
          <img
            src={signedMediaUrl!}
            alt="figurinha"
            className="w-24 h-24 object-contain"
          />
        )}

        {/* Estado de loading da mídia: msg tem media_url mas ainda não assinou.
            Mostra placeholder discreto em vez de quebrar o layout. */}
        {!hasMedia && mediaLoading && msg.media_url && msg.type !== "text" && (
          <p className="italic opacity-60 text-xs">[carregando mídia…]</p>
        )}

        {/* Falha ao assinar (path inválido, objeto removido, etc). */}
        {!hasMedia && !mediaLoading && msg.media_url && msg.type !== "text" && (
          <p className="italic opacity-60 text-xs">[mídia indisponível]</p>
        )}

        {/* Texto / caption */}
        {msg.body && msg.type === "text" && (
          <p className="whitespace-pre-wrap break-words">{msg.body}</p>
        )}
        {msg.body && msg.type !== "text" && msg.type !== "document" && (
          <p className="whitespace-pre-wrap break-words text-xs opacity-90">
            {msg.body}
          </p>
        )}

        {msg.type === "unknown" && !msg.body && (
          <p className="italic opacity-70 text-xs">[mensagem não suportada]</p>
        )}

        <p
          className={cn(
            "text-[10px] mt-1 text-right",
            isOut ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          {formatTime(msg.timestamp)}
        </p>
      </div>
    </div>
  );
}
