"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

interface CommunityPostReplyImageProps {
  imageUrl: string | null | undefined;
  communitySlug: string;
  postId: string;
  replyId: string;
  accountId: string;
  authorUsername: string;
  onAccessLost: () => void;
}

/** Loads private reply media with the current session, without the Next image proxy. */
export default function CommunityPostReplyImage({
  imageUrl,
  communitySlug,
  postId,
  replyId,
  accountId,
  authorUsername,
  onAccessLost,
}: CommunityPostReplyImageProps) {
  const key = `${accountId}:${communitySlug}:${postId}:${replyId}:${imageUrl ?? ""}`;
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const [unavailableKey, setUnavailableKey] = useState<string | null>(null);

  let targetUrl: string | null = null;
  if (imageUrl) {
    try {
      const base = new URL(API_URL, window.location.origin);
      const target = new URL(imageUrl, base);
      const expectedPath = `/api/v1/communities/${encodeURIComponent(communitySlug)}/posts/${encodeURIComponent(postId)}/replies/${encodeURIComponent(replyId)}/image`;
      if (target.origin === base.origin && target.pathname === expectedPath && !target.search && !target.hash && !target.username && !target.password) {
        targetUrl = target.toString();
      }
    } catch { targetUrl = null; }
  }

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    if (!targetUrl) return;

    fetch(targetUrl, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "image/jpeg" },
        signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          onAccessLost();
          throw new Error("access lost");
        }
        if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "image/jpeg") {
          throw new Error("unavailable");
        }
        const blob = await response.blob();
        if (blob.size > 2_097_152 || (blob.type && blob.type.toLowerCase() !== "image/jpeg")) throw new Error("unavailable");
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUnavailableKey(null);
        setLoaded({ key, url: objectUrl });
      })
      .catch(() => {
        if (live && !controller.signal.aborted) setUnavailableKey(key);
      });

    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, targetUrl, onAccessLost]);

  if (!imageUrl) return null;
  const label = `Image attached to reply by @${authorUsername}`;
  const image = loaded?.key === key ? loaded.url : null;
  if (!targetUrl) return <p className="text-xs text-text-muted" role="status">Reply image unavailable.</p>;
  return (
    <div className="min-w-0 max-w-full" aria-label={label}>
      {unavailableKey === key ? (
        <p className="text-xs text-text-muted" role="status">Reply image unavailable.</p>
      ) : image ? (
        // Private credentialed bytes use a local blob URL, not Next's optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={label}
          className="block max-w-full rounded-control"
          style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: "40rem", objectFit: "contain" }}
          onError={() => setUnavailableKey(key)}
        />
      ) : (
        <p className="text-xs text-text-muted" role="status">Loading reply image…</p>
      )}
    </div>
  );
}
