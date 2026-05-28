"use client";

/**
 * useSignedMediaUrl — converte `media_url` em URL renderizável (ROGA-35).
 *
 * Comportamento:
 *  - Se `mediaUrl` já é uma URL HTTPS (legada / vinda de signed URL pré-renderizada
 *    pelo servidor), devolve direto sem chamar a API.
 *  - Se for um storage path (sem esquema), chama `POST /api/inbox/sign-media`
 *    para obter uma signed URL com TTL e cacheia in-memory até a expiração.
 *
 * Cache:
 *  - Compartilhado por todas as instâncias do hook (Map por path).
 *  - Cada entrada expira `expiresIn - 30s` para evitar renderizar URL prestes
 *    a expirar; o hook re-busca quando lookup retorna entrada expirada.
 */
import { useEffect, useRef, useState } from "react";

type CacheEntry = { url: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

const SAFETY_MARGIN_MS = 30_000;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function fetchSignedUrl(path: string): Promise<string | null> {
  const existing = inFlight.get(path);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch("/api/inbox/sign-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) return null;
      const data: { signedUrl: string | null; expiresIn: number } = await res.json();
      if (!data.signedUrl) return null;
      const ttlMs = Math.max(0, data.expiresIn * 1000 - SAFETY_MARGIN_MS);
      cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + ttlMs });
      return data.signedUrl;
    } catch {
      return null;
    } finally {
      inFlight.delete(path);
    }
  })();

  inFlight.set(path, promise);
  return promise;
}

export function useSignedMediaUrl(mediaUrl: string | null | undefined): {
  url: string | null;
  loading: boolean;
} {
  const [url, setUrl] = useState<string | null>(() => {
    if (!mediaUrl) return null;
    if (isHttpUrl(mediaUrl)) return mediaUrl;
    const cached = cache.get(mediaUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    return null;
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!mediaUrl) return false;
    if (isHttpUrl(mediaUrl)) return false;
    const cached = cache.get(mediaUrl);
    return !(cached && cached.expiresAt > Date.now());
  });

  // Track latest mediaUrl to avoid setting state after unmount or stale resolves.
  const latestRef = useRef(mediaUrl);
  useEffect(() => {
    latestRef.current = mediaUrl;
  }, [mediaUrl]);

  useEffect(() => {
    if (!mediaUrl) {
      setUrl(null);
      setLoading(false);
      return;
    }
    if (isHttpUrl(mediaUrl)) {
      setUrl(mediaUrl);
      setLoading(false);
      return;
    }
    const cached = cache.get(mediaUrl);
    if (cached && cached.expiresAt > Date.now()) {
      setUrl(cached.url);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchSignedUrl(mediaUrl).then((signed) => {
      if (cancelled) return;
      // Guard: only commit if mediaUrl prop hasn't changed under us.
      if (latestRef.current !== mediaUrl) return;
      setUrl(signed);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaUrl]);

  return { url, loading };
}
