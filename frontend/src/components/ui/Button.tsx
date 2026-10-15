import type { ComponentPropsWithRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "destructive";

export function buttonStyles(variant: ButtonVariant = "primary", className = "") {
  return `ui-button ui-button--${variant} ${className}`.trim();
}

export function iconButtonStyles(className = "") {
  return buttonStyles("secondary", `ui-icon-button ${className}`);
}

/** Reserve both labels' width so existing pending copy does not move controls. */
export function PendingLabel({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return <span className="ui-button-label">
    <span aria-hidden={pending} style={{ visibility: pending ? "hidden" : "visible" }}>{idle}</span>
    <span aria-hidden={!pending} style={{ visibility: pending ? "visible" : "hidden" }}>{busy}</span>
  </span>;
}

type ButtonProps = ComponentPropsWithRef<"button"> & { variant?: ButtonVariant; pending?: boolean };

// Callers retain native type, refs, disabled state, labels, and event handlers.
export default function Button({ variant = "primary", className = "", pending = false, disabled, ...props }: ButtonProps) {
  return <button {...props} disabled={disabled || pending} aria-busy={pending || props["aria-busy"]} className={buttonStyles(variant, className)} />;
}
