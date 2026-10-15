"use client";

import Link from "next/link";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import { IconDiscussion, IconModules, IconSupport, IconReview } from "@/components/navigation/NavIcons";
import { buttonStyles } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import styles from "./Support.module.css";

/** Existing optional contact setting: international digits only, no payment processing. */
function getWhatsAppSupportUrl(rawNumber: string | undefined, purpose: "contribution" | "help" = "contribution"): string | null {
  if (!rawNumber) return null;
  const trimmed = rawNumber.trim();
  if (!/^\d{7,15}$/.test(trimmed)) return null;
  const message = purpose === "help"
    ? "Hi! I need help with my EtudSup account or IRM community access."
    : "Hi! I'd like to support EtudSup. How can I contribute?";
  return `https://wa.me/${trimmed}?text=${encodeURIComponent(message)}`;
}

export default function SupportPage() {
  const { user, membership, isLoading, isRefreshing, isLoggingOut, error, membershipError } = useAuth();
  const signedIn = !!user && !isLoading && !isLoggingOut;
  const confirmedGuest = !user && !isLoading && !isRefreshing && !isLoggingOut && !error;
  const knownMembership = signedIn && !isRefreshing && !error && !membershipError;
  const pending = knownMembership && membership?.status === "PENDING";
  const restricted = knownMembership && !!membership && !["ACTIVE", "PENDING", "REJECTED", "REMOVED"].includes(membership.status);
  const number = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER;
  const contributionUrl = getWhatsAppSupportUrl(number);
  const helpUrl = getWhatsAppSupportUrl(number, "help");

  return (
    <PageContainer width="wide" className={styles.page}>
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Support" }]} />

      <section className={styles.hero} aria-labelledby="support-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Student-built, community-supported</p>
          <h1 id="support-heading">Support <span>EtudSup</span></h1>
          <p className={styles.heroHeading}>Keep a shared place to learn.</p>
          <p className={styles.heroLead}>EtudSup is an independent student project connecting study resources and student communities. IRM at FST Mohammedia is our first community.</p>
          <p className={styles.heroNote}>If you would like to help sustain it, your support is welcome and always voluntary.</p>
        </div>
        <div className={styles.heroMark} aria-hidden="true"><IconDiscussion /></div>
      </section>

      <div className={styles.contributionGrid}>
        <section className={styles.card} aria-labelledby="contribution-heading">
          <p className={styles.kicker}>A voluntary contribution</p>
          <h2 id="contribution-heading">Help keep EtudSup going</h2>
          <p>Support helps with the project’s domain, ongoing maintenance, and improvements to the student experience.</p>
          {contributionUrl ? (
            <div className={styles.actionArea}>
              <a href={contributionUrl} target="_blank" rel="noopener noreferrer" className={buttonStyles("primary", styles.contactButton)}>
                <IconDiscussion />Contact us about supporting EtudSup
              </a>
              <p className={styles.caption}>Opens WhatsApp in a new tab to discuss contribution details. This conversation does not process a payment.</p>
            </div>
          ) : (
            <div className={styles.unavailable}>
              <strong>Contribution details are not yet available.</strong>
              <p>Thank you for wanting to help. There is no contribution action available on this page yet.</p>
            </div>
          )}
          <p className={styles.accessNote}>Contributions do not affect membership approval, community roles, document access, or access decisions. The same rules apply to everyone.</p>
        </section>

        <aside className={styles.quietCard} aria-labelledby="sustain-heading">
          <span className={styles.cardIcon} aria-hidden="true"><IconReview /></span>
          <h2 id="sustain-heading">A little support, lasting care</h2>
          <p>Maintaining EtudSup means keeping it available, fixing problems, and making it easier for students to find useful resources.</p>
          <div className={styles.nonFinancial}>
            <h3>More than financial support</h3>
            <p>Share useful feedback with your community Delegate, report a problem, or contribute study resources through the existing community workflows when your access allows it.</p>
          </div>
        </aside>
      </div>

      <section className={`${styles.card} ${styles.help}`} aria-labelledby="help-heading">
        <div className={styles.helpCopy}>
          <p className={styles.kicker}>Practical help</p>
          <h2 id="help-heading">Need help with your account or community?</h2>
          <p>Help is available independently of contributions.</p>
          <p>{restricted
            ? "Your IRM access is restricted. Ask your community Delegate about the restriction; contributing does not change that decision."
            : pending
              ? "Your IRM application is awaiting manual review by the community Delegate. Check its status before submitting another request."
              : "IRM membership is manually verified by the community Delegate. If you have already applied, check your application status or ask your Delegate for guidance."}</p>
          {!helpUrl && <p className={styles.caption}>Online contact details are not yet available. For IRM membership or access questions, reach your student Delegate through your usual community channels. You can also share technical issues with them.</p>}
        </div>
        <div className={styles.helpActions}>
          {helpUrl && <>
            <a href={helpUrl} target="_blank" rel="noopener noreferrer" className={buttonStyles("secondary")}><IconSupport />Contact for help on WhatsApp</a>
            <p className={styles.caption}>Opens WhatsApp in a new tab for account, technical, or community help.</p>
          </>}
          {signedIn && !restricted && <Link href="/account#community-membership" className={buttonStyles("secondary")}><IconReview />{pending ? "Check application status" : "View IRM membership"}</Link>}
          {confirmedGuest && <p className={styles.caption}>Sign in to check an existing membership application. If you cannot sign in, ask your community Delegate for guidance.</p>}
        </div>
      </section>

      <nav aria-label="Support page navigation" className={styles.bottomActions}>
        <Link href="/" className={buttonStyles("secondary")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 6-6 6 6 6M4 12h16" /></svg>Back to Home
        </Link>
        {signedIn ? (
          <Link href="/communities/irm/modules" className={buttonStyles("secondary")}><IconModules />Browse IRM modules</Link>
        ) : confirmedGuest ? (
          <Link href="/login" className={buttonStyles("secondary")}><IconSupport />Sign in</Link>
        ) : null}
      </nav>
    </PageContainer>
  );
}
