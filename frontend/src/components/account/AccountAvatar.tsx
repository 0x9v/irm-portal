"use client";

import { useEffect, useState } from "react";
import { accountInitials } from "./accountInitials";
import { API_URL } from "@/lib/api";
import styles from "./AccountAvatar.module.css";

type LoadedImage = { key: string; objectUrl: string };

export default function AccountAvatar({ userId, username, avatarUrl, compact = false, decorative = false }: {
  userId: string;
  username: string;
  avatarUrl: string | null;
  compact?: boolean;
  decorative?: boolean;
}) {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [brokenKey, setBrokenKey] = useState<string | null>(null);
  const imageKey = `${userId}:${avatarUrl ?? ""}`;

  useEffect(() => {
    const prefix = `/api/v1/users/${encodeURIComponent(userId)}/avatar/`;
    if (!avatarUrl?.startsWith(prefix)) return;
    const target = new URL(avatarUrl, API_URL);
    const version = target.pathname.slice(prefix.length);
    if (target.origin !== new URL(API_URL).origin || !target.pathname.startsWith(prefix) ||
      !version || version.includes("/") || target.search || target.hash) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let current = true;

    fetch(target.toString(), { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) return;
        const blob = await response.blob();
        if (!current) return;
        objectUrl = URL.createObjectURL(blob);
        setBrokenKey(null);
        setImage({ key: imageKey, objectUrl });
      })
      .catch(() => { /* Keep initials when the authenticated image is unavailable. */ });

    return () => {
      current = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [avatarUrl, imageKey, userId]);

  const source = image?.key === imageKey && brokenKey !== imageKey ? image.objectUrl : null;
  return <span className={`${styles.avatar} ${compact ? styles.compact : ""}`}
    role={decorative ? undefined : "img"}
    aria-label={decorative ? undefined : `${username}'s avatar`}
    aria-hidden={decorative ? true : undefined}>
    {source ? /* Authenticated blob URLs cannot use Next's public image optimizer. */
      // eslint-disable-next-line @next/next/no-img-element
      <img src={source} alt="" onError={() => setBrokenKey(imageKey)} /> : <span aria-hidden="true">{accountInitials(username)}</span>}
  </span>;
}
