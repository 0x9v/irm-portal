"use client";

import { useEffect, useRef, useState } from "react";
import { resourcePreviewUrl, type ResourceItem } from "@/lib/moduleResources";

export default function ResourceImage({ item, community = "irm" }: { item: ResourceItem; community?: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const currentUrl = useRef<string | null>(null);
  const route = resourcePreviewUrl(community, item);

  useEffect(() => {
    const controller = new AbortController();
    const release = () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = null;
    };
    if (!route) return () => { controller.abort(); release(); };
    fetch(route, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        if (mediaType !== "image/webp" && mediaType !== "image/png") throw new Error("invalid media type");
        const blob = await response.blob();
        if (blob.size === 0 || blob.size > 8 * 1024 * 1024) throw new Error("invalid media size");
        if (controller.signal.aborted) return;
        const next = URL.createObjectURL(blob);
        release();
        currentUrl.current = next;
        setImageUrl(next);
        setState("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setState("unavailable"); });
    return () => { controller.abort(); release(); };
  }, [route]);

  return <div className="mt-3 flex min-h-32 max-w-full items-center justify-center overflow-hidden rounded-control border border-border bg-surface-secondary p-2">
    {!route && <p role="status" className="ui-helper">Image unavailable.</p>}
    {route && state === "loading" && <p role="status" className="ui-helper">Loading private image…</p>}
    {route && state === "unavailable" && <p role="status" className="ui-helper">Image unavailable.</p>}
    {route && state === "ready" && imageUrl && <>
      {/* Private bytes live only in a revocable blob URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={`Image resource: ${item.title}`} className="block h-auto max-h-96 max-w-full object-contain"
        onError={() => { if (currentUrl.current === imageUrl) { URL.revokeObjectURL(imageUrl); currentUrl.current = null; } setImageUrl(null); setState("unavailable"); }} />
    </>}
  </div>;
}
