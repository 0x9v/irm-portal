"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import identity from "@/components/layout/FeatureIdentity.module.css";
import Button from "@/components/ui/Button";

interface Props {
  title: string;
  heading?: string;
  description: string;
  context?: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onCheck: () => void;
}

export default function ConfirmationDialog({ title, heading, description, context, pending, error, onCancel, onConfirm, onCheck }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      queueMicrotask(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
        else {
          const fallback = document.querySelector<HTMLElement>("main h1, main h2, main");
          if (fallback) { fallback.setAttribute("tabindex", "-1"); fallback.focus(); }
        }
      });
    };
  }, []);
  useLayoutEffect(() => {
    if (pending) dialogRef.current?.focus();
  }, [pending]);
  return createPortal(
    <dialog ref={dialogRef} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(dialogRef.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        if (!controls.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
      }}
      tabIndex={-1}
      className={`${identity.feature} ${identity.dialog} ui-motion-dialog m-auto w-[calc(100%_-_2rem)] max-w-sm max-h-[85dvh] overflow-y-auto rounded-surface border border-border bg-surface p-5 text-text shadow-dropdown backdrop:bg-black/50`}>
      <h2 id={titleId} className="text-lg leading-6 font-bold [overflow-wrap:anywhere]" tabIndex={-1}>{heading ?? `${title}?`}</h2>
      {context && <p className="mt-2 text-sm font-medium text-text [overflow-wrap:anywhere]">{context}</p>}
      <p id={descriptionId} className="mt-3 text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">{description}</p>
      {error && <div className="mt-4 rounded-control border border-error-border bg-error-surface p-3 text-sm text-error" role="alert">{error}</div>}
      {pending && <p role="status" className="mt-3 text-sm text-text-muted">Checking with the server…</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2 [&>button]:w-full sm:[&>button]:w-auto">
        <Button ref={cancelRef} type="button" variant="secondary" disabled={pending} aria-busy={pending} onClick={onCancel}>Cancel</Button>
        {error && <Button type="button" variant="quiet" disabled={pending} aria-busy={pending} onClick={onCheck}>Refresh and check</Button>}
        <Button type="button" variant="destructive" disabled={pending} aria-busy={pending} onClick={onConfirm}>{title}</Button>
      </div>
    </dialog>, document.body
  );
}
