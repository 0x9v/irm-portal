"use client";

import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import PageContainer from "@/components/PageContainer";
import { buttonStyles } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import ProfileContent from "./ProfileContent";
import styles from "./AccountPage.module.css";

export default function AccountPage() {
  const { user, isLoading, isRefreshing, isLoggingOut, error, refresh } = useAuth();
  const checking = isLoading || isRefreshing || isLoggingOut;

  return <PageContainer width="default" className={styles.page}>
    <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "My account" }]} />
    <header className={styles.heading}>
      <h1>My account</h1>
      <p>Your EtudSup identity and contact details.</p>
    </header>

    {checking && <section className={styles.stateCard} role="status" aria-label="Checking account">
      <h2>Checking your account</h2>
      <p>Loading your account details…</p>
    </section>}
    {!checking && !user && (error ? <FeedbackMessage type="error" message="We couldn't check your account. Please try again." onRetry={() => { void refresh(); }} retryLabel="Retry account check" />
      : <section className={styles.stateCard}>
        <h2>Sign in to view your account</h2>
        <p>Your account details are available after you sign in.</p>
        <Link href="/login" className={buttonStyles("primary", styles.stateAction)}>Sign in</Link>
      </section>)}
    {user && <ProfileContent key={user.id} user={user} masked={checking || !!error} loggingOut={isLoggingOut} authError={error} refresh={refresh} />}
  </PageContainer>;
}
