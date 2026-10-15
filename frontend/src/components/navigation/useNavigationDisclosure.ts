"use client";

import { useEffect, type RefObject } from "react";

/** Public disclosure or signed-in modal drawer, sharing dismissal and focus return. */
export default function useNavigationDisclosure(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLButtonElement | null>,
  modal = false,
) {
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('nav a')?.focus();
    const dismiss = (restore: boolean) => { close(); if (restore) trigger.current?.focus(); };
    const bodyOverflow = document.body.style.overflow;
    const siblings = modal ? Array.from(root.current?.parentElement?.children ?? []).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node !== root.current
    ) : [];
    const inertStates = siblings.map(node => node.inert);
    if (modal) { document.body.style.overflow = "hidden"; siblings.forEach(node => { node.inert = true; }); }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(true); }
      if (modal && event.key === "Tab") {
        const focusable = Array.from(root.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled):not([tabindex="-1"]), summary, input:not(:disabled)') ?? [])
          .filter(node => node.getClientRects().length > 0);
        const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss(false);
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        if (modal) trigger.current?.focus(); else dismiss(false);
      }
    };
    const resize = () => { if (window.innerWidth >= 1280) dismiss(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", resize);
    return () => {
      if (modal) { document.body.style.overflow = bodyOverflow; siblings.forEach((node, index) => { node.inert = inertStates[index]; }); }
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", resize);
    };
  }, [open, close, root, trigger, modal]);
}
