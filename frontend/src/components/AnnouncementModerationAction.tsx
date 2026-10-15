"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isConfirmedDelegate, moderationCopy, moderationRequest, performModeration } from "@/lib/moderation";
import ConfirmationDialog from "@/components/moderation/ConfirmationDialog";
import styles from "./Announcements.module.css";

interface Props {
  kind: "announcement" | "announcement reply";
  id: string;
  parentId?: string;
  context: string;
  onRemoved: (unavailable: boolean) => void;
  onCheck: () => void | Promise<void>;
}

export default function AnnouncementModerationAction(props: Props) {
  const auth = useAuth();
  if (!isConfirmedDelegate(auth)) return null;
  return <AuthorizedAction key={`${auth.user!.id}:${auth.membership!.id}:${props.kind}:${props.parentId ?? ""}:${props.id}`} {...props} />;
}

function AuthorizedAction({ kind, id, parentId, context, onRemoved, onCheck }: Props) {
  const { refresh } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [menuOpen]);

  const copy = moderationCopy(kind);
  const confirm = async () => {
    if (busy.current || !alive.current || denied) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const result = await performModeration(moderationRequest(kind, "irm", id, parentId), () => alive.current);
    if (!alive.current) return;
    busy.current = false;
    setPending(false);
    if (result === "success" || result === "unavailable") {
      setConfirmOpen(false);
      onRemoved(result === "unavailable");
    } else if (result === "denied") {
      setConfirmOpen(false);
      setDenied(true);
      void refresh();
    } else if (result === "conflict") {
      setError("The server protected this item or its state changed. Refresh and check before choosing another action.");
    } else if (result === "uncertain") {
      setError("The outcome could not be confirmed. The action may have completed. Refresh and check before an explicit retry.");
    }
  };
  if (denied) return null;
  return <>
    <div ref={rootRef} className={styles.actionWrap}>
      <button ref={triggerRef} type="button" className="ui-button ui-button--quiet ui-icon-button"
        aria-label={`Actions for ${context}`} aria-expanded={menuOpen} aria-controls={menuId}
        onClick={() => {
          if (!menuOpen && triggerRef.current) setMenuUp(triggerRef.current.getBoundingClientRect().bottom > window.innerHeight - 180);
          setMenuOpen(value => !value);
        }}>
        <span aria-hidden="true">⋯</span>
      </button>
      {menuOpen && <div id={menuId} className={`${styles.actionPanel} ${menuUp ? styles.actionPanelUp : ""} ui-motion-disclosure`} aria-label={`Actions for ${context}`}>
        <button type="button" className={styles.dangerChoice} onClick={() => {
          setMenuOpen(false);
          triggerRef.current?.focus();
          setError(null);
          setConfirmOpen(true);
        }}>{copy.label}</button>
      </div>}
    </div>
    {confirmOpen && <ConfirmationDialog title={copy.label} description={copy.description} context={context}
      pending={pending} error={error} onCancel={() => { if (!busy.current) setConfirmOpen(false); }}
      onConfirm={confirm} onCheck={async () => {
        if (busy.current) return;
        busy.current = true; setPending(true);
        try { await onCheck(); } finally { if (alive.current) { busy.current = false; setPending(false); } }
      }} />}
  </>;
}
