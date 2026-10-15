"use client";

import { buttonStyles, iconButtonStyles } from "@/components/ui/Button";
import { useTheme } from "@/context/ThemeContext";
import styles from "./ThemeSelector.module.css";

/** The icon always selects an explicit preference opposite to the effective theme. */
export default function ThemeSelector() {
  const { resolvedTheme, setPreference } = useTheme();
  const dark = resolvedTheme === "dark";
  const action = `Switch to ${dark ? "light" : "dark"} mode`;
  return (
    <button type="button" data-theme-control aria-label={action} title={action}
      onClick={() => setPreference(dark ? "light" : "dark")} className={iconButtonStyles(styles.toggle)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>
          : <path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z" />}
      </svg>
    </button>
  );
}

/** Shared preference action for authenticated account and public navigation areas. */
export function SystemAppearanceAction({ className = "" }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const selected = preference === "system";
  return (
    <button type="button" aria-pressed={selected} onClick={() => setPreference(selected ? "light" : "system")}
      className={buttonStyles("quiet", `${styles.systemAction} ${className}`)}>
      <span className={styles.systemIndicator} aria-hidden="true">{selected ? "✓" : ""}</span>
      Use system appearance
    </button>
  );
}
