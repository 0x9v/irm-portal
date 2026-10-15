"use client";

import { PendingLabel, buttonStyles } from "@/components/ui/Button";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import AccountAvatar from "@/components/account/AccountAvatar";
import { IconLogout, IconSupport } from "./NavIcons";
import { SystemAppearanceAction } from "./ThemeSelector";
import styles from "./AccountControls.module.css";

export default function AccountPanel({ onNavigate }: { onNavigate: () => void }) {
  const { user, isLoggingOut, error, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const submitting = useRef(false);
  const router = useRouter();
  const busy = pending || isLoggingOut;
  const handleLogout = async () => {
    if (busy || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setLogoutError(null);
    try {
      await logout();
      onNavigate();
      router.push("/login");
    } catch (error) {
      setLogoutError(error instanceof Error && error.name === "AbortError"
        ? "Logout request timed out. Please try again."
        : "Logout failed. Please try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <div className={styles.accountPanel}>
      {user && !busy && !error && <Link href="/account" onClick={onNavigate} className={`ui-nav-link ${styles.accountIdentity}`}>
        <AccountAvatar userId={user.id} username={user.username} avatarUrl={user.avatar_url ?? null} compact decorative />
        <span className={styles.accountText}>
          <strong>{user.username}</strong>
          <span>EtudSup account</span>
        </span>
      </Link>}
      <div className={styles.accountUtilities}>
        <Link href="/support" onClick={onNavigate} className={buttonStyles("quiet", styles.utilityLink)}><IconSupport />Support</Link>
        <button type="button" onClick={handleLogout} disabled={busy} aria-busy={busy} aria-label="Logout" className={buttonStyles("quiet", styles.utilityLink)}>
          <IconLogout /><PendingLabel pending={!!(busy)} idle="Sign out" busy="Signing out…" />
        </button>
      </div>
      <div className={styles.appearanceGroup} aria-label="Appearance preference">
        <SystemAppearanceAction />
      </div>
      {busy && <p role="status" className={styles.pending}>Signing out…</p>}
      {logoutError && (
        <div role="alert" className={styles.logoutError}>
          <p>{logoutError}</p>
          <button type="button" onClick={handleLogout} disabled={busy} className={buttonStyles("secondary", styles.retryLogout)}>Retry logout</button>
        </div>
      )}
    </div>
  );
}
