"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import AccountAvatar from "@/components/account/AccountAvatar";
import styles from "./NavigationShell.module.css";

export default function SidebarProfile({ onNavigate }: { onNavigate?: () => void }) {
  const { user, isLoading, isRefreshing, isLoggingOut, error } = useAuth();
  if (!user || isLoading || isRefreshing || isLoggingOut || error) return null;

  return (
    <div className={styles.profileFooter}>
      <Link href="/account" onClick={onNavigate} className={`ui-nav-link ${styles.profileRow}`}>
        <AccountAvatar userId={user.id} username={user.username} avatarUrl={user.avatar_url ?? null} compact decorative />
        <span className={styles.profileText}>
          <strong title={user.username}>{user.username}</strong>
          <small>View account</small>
        </span>
      </Link>
    </div>
  );
}
