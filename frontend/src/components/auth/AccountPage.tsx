"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import GuestBrandMark from "@/components/home/GuestBrandMark";
import ThemeSelector, { SystemAppearanceAction } from "@/components/navigation/ThemeSelector";
import Button from "@/components/ui/Button";
import styles from "./AccountPage.module.css";

type Props = {
  kind: "login" | "register";
  children: ReactNode;
  submitting?: boolean;
};

export default function AccountPage({ kind, children, submitting = false }: Props) {
  const { user, isLoading, isRefreshing, isLoggingOut, error, refresh } = useAuth();
  const checking = isLoading || isLoggingOut || (!user && isRefreshing);
  const heading = kind === "register" ? "Join a place" : "Welcome back";
  const emphasis = kind === "register" ? "to learn." : "to learn.";

  return (
    <main className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.brandPanel} aria-label="EtudSup introduction">
          <Link href="/" className={styles.brand} aria-label="EtudSup home">
            <GuestBrandMark />
            <span><strong>EtudSup</strong><small>Student learning, connected</small></span>
          </Link>
          <div className={styles.brandCopy}>
            <p className={styles.eyebrow}>An independent student initiative</p>
            <p className={styles.brandHeadline}>{heading}<br /><span>{emphasis}</span></p>
            <p className={styles.brandLead}>Study resources and student community in one shared place. Start with IRM at FST Mohammedia.</p>
            <div className={styles.communityChip}>
              <span className={styles.irmMark}>IRM</span>
              <span><strong>IRM student community</strong><small>FST Mohammedia</small></span>
            </div>
          </div>
          <p className={styles.brandFoot}>EtudSup · An independent student initiative</p>
        </aside>
        <div className={styles.formSide}>
          <div className={styles.mobileTop}>
            <Link href="/" className={styles.mobileBrand} aria-label="EtudSup home"><GuestBrandMark /><strong>EtudSup</strong></Link>
          </div>
          <div className={styles.formWrap}>
            {checking ? (
              <div role="status" className={styles.state}>
                <h1>Checking your account</h1>
                <p>Please wait while we check your session.</p>
              </div>
            ) : error && !user ? (
              <div className={styles.state}>
                <h1>We couldn&apos;t check your account</h1>
                <p>Check your connection and try again to continue.</p>
                <Button type="button" onClick={() => void refresh()}>Retry account check</Button>
              </div>
            ) : user && !submitting ? (
              <div className={styles.state}>
                <h1>You&apos;re signed in</h1>
                <p>Your EtudSup account is ready. Continue to your dashboard.</p>
                <Link href="/" className="ui-button ui-button--primary">Go to Home</Link>
              </div>
            ) : children}
            <div className={styles.utilityLinks}>
              <Link href="/">Back to Home</Link>
              <Link href="/support">Support</Link>
            </div>
            <div className={styles.theme}><ThemeSelector /><SystemAppearanceAction /></div>
          </div>
        </div>
      </div>
    </main>
  );
}
