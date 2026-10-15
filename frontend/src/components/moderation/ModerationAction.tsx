"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { isConfirmedDelegate, moderationCopy, moderationRequest, performModeration, ModerationKind } from "@/lib/moderation";
import ConfirmationDialog from "./ConfirmationDialog";
import discussionStyles from "@/components/discussion/Discussion.module.css";

interface Props {
  kind: ModerationKind;
  id: string;
  parentId?: string;
  communitySlug?: string;
  context?: string;
  scopeKey?: string;
  disabled?: boolean;
  onRemoved: (unavailable: boolean) => void;
  onCheck: () => void | Promise<void>;
  onDenied?: () => void;
  onConflict?: () => void;
  presentation?: "button" | "message-menu";
}
export default function ModerationAction(props: Props) {
  const auth = useAuth();
  const slug = props.communitySlug ?? "irm";
  if (!isConfirmedDelegate(auth, slug)) return null;
  return <AuthorizedAction key={`${auth.user!.id}:${auth.membership!.id}:${slug}:${props.kind}:${props.parentId}:${props.id}:${props.scopeKey ?? ""}`} {...props} communitySlug={slug} />;
}
function AuthorizedAction({ kind, id, parentId, communitySlug = "irm", context, disabled, onRemoved, onCheck, onDenied, onConflict, presentation = "button" }: Props) {
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuDown, setMenuDown] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); triggerRef.current?.focus(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onPointerDown); };
  }, [menuOpen]);
  const copy = moderationCopy(kind);
  const confirm = async () => {
    if (busy.current || !alive.current || denied) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const result = await performModeration(moderationRequest(kind, communitySlug, id, parentId), () => alive.current);
    if (!alive.current) return;
    busy.current = false;
    setPending(false);
    if (result === "success" || result === "unavailable") {
      setOpen(false);
      onRemoved(result === "unavailable");
    } else if (result === "denied") {
      setOpen(false);
      setDenied(true);
      onDenied?.();
      void refresh();
    } else if (result === "conflict") {
      setError("The server protected this target or its state changed. Refresh and check before choosing another action.");
      onConflict?.();
    } else if (result === "uncertain") {
      setError("The outcome could not be confirmed. The action may have completed. Refresh and check before an explicit retry.");
    }
  };
  if (denied) return null;
  return <>
    {presentation === "message-menu" ? <div ref={menuRef} className={discussionStyles.menuWrap}>
      <button ref={triggerRef} type="button" disabled={disabled} aria-label={`Actions for ${context ?? "message"}`}
        aria-expanded={menuOpen} aria-controls={menuId} onClick={() => {
          if (!menuOpen && triggerRef.current) setMenuDown(triggerRef.current.getBoundingClientRect().top < 100);
          setMenuOpen(value => !value);
        }}
        className="ui-button ui-button--quiet ui-icon-button" title="Message actions">
        <span aria-hidden="true">⋯</span>
      </button>
      {menuOpen && <div id={menuId} className={`${discussionStyles.menu} ${menuDown ? discussionStyles.menuDown : ""} ui-motion-disclosure`} aria-label="Message actions">
        <button type="button" className="ui-button ui-button--quiet" onClick={() => {
          setMenuOpen(false); triggerRef.current?.focus(); setError(null); setOpen(true);
        }}>Remove message</button>
      </div>}
    </div> : <button type="button" disabled={disabled} onClick={() => { setError(null); setOpen(true); }}
      className="ui-button ui-button--destructive">{copy.label}</button>}
    {open && <ConfirmationDialog title={copy.label} heading={kind === "unban" && context ? `Unban ${context}?` : undefined} description={copy.description} context={context} pending={pending} error={error}
      onCancel={() => { if (!busy.current) setOpen(false); }} onConfirm={confirm}
      onCheck={async () => {
        if (busy.current) return;
        busy.current = true; setPending(true);
        try { await onCheck(); } finally { if (alive.current) { busy.current = false; setPending(false); } }
      }} />}
  </>;
}
