"use client";

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

interface AuthenticatedStickerImageProps {
  path: string;
  accessKey: string;
  label: string;
  size?: number;
}

/** Loads private sticker bytes with the signed-in session; no public image proxy is used. */
export function AuthenticatedStickerImage({ path, accessKey, label, size = 144 }: AuthenticatedStickerImageProps) {
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = `${accessKey}:${path}`;

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    let target: URL;
    try {
      if (!path.startsWith('/api/v1/auth/me/stickers/') && !path.startsWith('/api/v1/communities/')) return;
      target = new URL(`${API_URL.replace(/\/+$/, '')}${path}`);
      if (target.origin !== new URL(API_URL).origin) return;
    } catch { return; }

    fetch(target.toString(), { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'image/webp') throw new Error('unavailable');
        const blob = await response.blob();
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setFailedKey(null);
        setImage({ key, url: objectUrl });
      })
      .catch(() => { if (live && !controller.signal.aborted) setFailedKey(key); });

    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, path]);

  const url = image?.key === key && failedKey !== key ? image.url : null;
  return (
    <span className="inline-flex items-center justify-center overflow-hidden" style={{ width: size, height: size, maxWidth: '100%', aspectRatio: '1 / 1' }}>
      {url ? <>
        {/* Credentialed blob images must bypass the Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} width={size} height={size} className="h-full w-full object-contain" onError={() => setFailedKey(key)} />
      </> : failedKey === key ?
        <span className="px-2 text-center text-xs text-text-muted" role="status">Sticker unavailable</span> :
        <span aria-label={`Loading ${label}`} role="status" className="h-full w-full rounded-lg bg-surface-secondary" />}
    </span>
  );
}
