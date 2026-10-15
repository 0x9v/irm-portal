"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchApi } from "@/lib/api";
import { buttonStyles } from "@/components/ui/Button";
import SavedDocumentButton from "@/components/SavedDocumentButton";

/** The typed IMAGE item does not distinguish a legacy file-backed document. */
export default function LegacyImageLink({ moduleSlug, id, href }: { moduleSlug: string; id: string; href: string }) {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchApi<{ id: string; type: string }>(
      `/api/v1/communities/irm/modules/${encodeURIComponent(moduleSlug)}/documents/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    ).then(value => {
      if (!controller.signal.aborted && value.id === id && typeof value.type === "string") setSupported(true);
    }).catch(() => { /* Canonical images have no legacy document destination. */ });
    return () => controller.abort();
  }, [moduleSlug, id]);
  return supported ? <>
    <Link href={href} className={buttonStyles("secondary", "min-h-[44px]")}>Open in document reader</Link>
    <SavedDocumentButton documentId={id} />
  </> : null;
}
