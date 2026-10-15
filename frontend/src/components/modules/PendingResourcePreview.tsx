"use client";

import { useEffect, useRef, useState } from "react";
import { pendingResourcePreviewUrl, type PendingResourceItem } from "@/lib/moduleResources";

export default function PendingResourcePreview({ item, onAccessLost }: { item: PendingResourceItem; onAccessLost: (status: 401 | 403) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const current = useRef<string | null>(null);
  const route = pendingResourcePreviewUrl("irm", item);
  useEffect(() => {
    const controller = new AbortController();
    const release = () => { if (current.current) URL.revokeObjectURL(current.current); current.current = null; };
    if (!route) return () => { controller.abort(); release(); };
    fetch(route, { credentials: "include", cache: "no-store", signal: controller.signal }).then(async response => {
      if (response.status === 401 || response.status === 403) { onAccessLost(response.status); return; }
      if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== item.preview.media_type) throw new Error("invalid preview");
      const blob = await response.blob();
      if (!blob.size || blob.size > 8 * 1024 * 1024 || controller.signal.aborted) throw new Error("invalid preview");
      const next = URL.createObjectURL(blob);
      release(); current.current = next; setUrl(next); setState("ready");
    }).catch(() => { if (!controller.signal.aborted) setState("unavailable"); });
    return () => { controller.abort(); release(); };
  }, [route, item.preview.media_type, onAccessLost]);
  if (!route || state === "unavailable") return <p role="status" className="ui-helper">Preview unavailable.</p>;
  if (state === "loading") return <p role="status" className="ui-helper">Loading protected preview…</p>;
  return <div className="max-w-full overflow-hidden rounded-control border border-border bg-reader-viewport p-2">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url!} alt={`${item.kind === "PDF" ? "First page" : "Image"} preview of ${item.title}`} className="block h-auto max-h-96 max-w-full object-contain mx-auto"
      onError={() => { if (current.current === url) { URL.revokeObjectURL(url!); current.current = null; } setUrl(null); setState("unavailable"); }} />
  </div>;
}
