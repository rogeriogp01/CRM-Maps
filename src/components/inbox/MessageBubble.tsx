"use client";

import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioPlayer } from "./AudioPlayer";
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
        {msg.type === "image" && msg.media_url && (
          <a href={msg.media_url} target="_blank" rel="noreferrer">
            <img
              src={msg.media_url}
              alt={msg.body ?? "imagem"}
              className="rounded-lg max-w-full mb-1"
            />
          </a>
        )}

        {msg.type === "video" && msg.media_url && (
          <video
            src={msg.media_url}
            controls
            className="rounded-lg max-w-full mb-1"
          />
        )}

        {msg.type === "audio" && msg.media_url && (
          <AudioPlayer src={msg.media_url} isOut={isOut} />
        )}

        {msg.type === "document" && msg.media_url && (
          <a
            href={msg.media_url}
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

        {msg.type === "sticker" && msg.media_url && (
          <img
            src={msg.media_url}
            alt="figurinha"
            className="w-24 h-24 object-contain"
          />
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
