"use client";

import { buttonStyles } from "@/components/ui/Button";

import { useCallback, useEffect, useId, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import AccountAvatar from "@/components/account/AccountAvatar";
import AccountPanel from "./AccountPanel";
import ThemeSelector from "./ThemeSelector";
import styles from "./AccountControls.module.css";

interface AccountControlsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compact?: boolean;
}

/** Non-modal disclosure: ordinary Tab order, no incomplete ARIA menu pattern. */
export default function AccountControls({ open, onOpenChange, compact = false }: AccountControlsProps) {
  const { user } = useAuth();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const pathname = usePathname();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const closeAndRestore = () => { close(); trigger.current?.focus(); };

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(); trigger.current?.focus();
      }
    };
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        // Restore before a pointer's normal focus action, avoiding hidden-panel focus.
        if (panel.current?.contains(document.activeElement)) trigger.current?.focus();
        close();
      }
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const resize = () => {
      if ((window.innerWidth < 1280) !== compact) close();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", resize);
    };
  }, [open, close, compact]);

  return (
    <div ref={root} data-account-controls className={styles.controls}>
      <ThemeSelector />
      <button ref={trigger} type="button" aria-label="Account options"
        aria-expanded={open} aria-controls={id}
        title={user?.username} className={buttonStyles("quiet", `${styles.trigger} ${compact ? styles.compactTrigger : ""}`)}
        onClick={() => onOpenChange(!open)}>
        <AccountAvatar userId={user?.id ?? ""} username={user?.username ?? ""}
          avatarUrl={user?.avatar_url ?? null} compact decorative />
        <span className={styles.username}>{user?.username}</span>
        <svg className={styles.chevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
      </button>
      {/* Keep mounted so explicit dismissal/reopening retains logout error/retry feedback. */}
      <div ref={panel} id={id} hidden={!open} role="region" aria-label="Account options" className={`${styles.panel} ui-motion-disclosure`}>
        <AccountPanel onNavigate={closeAndRestore} />
      </div>
    </div>
  );
}
