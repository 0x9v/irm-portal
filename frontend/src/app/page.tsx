"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import PageContainer from "@/components/PageContainer";
import FeedbackMessage from "@/components/FeedbackMessage";
import { ContentLoading, ContentEmpty } from "@/components/ContentState";
import { fetchApi, ApiError } from "@/lib/api";
import GuestHome from "@/components/home/GuestHome";
import HomeMobileShortcuts from "@/components/home/HomeMobileShortcuts";
import HomeWelcomeHero from "@/components/home/HomeWelcomeHero";
import DashboardActionCard from "@/components/home/DashboardActionCard";
import { IconModules, IconDiscussion, IconAnnouncements, IconSaved, IconRecent, IconSubmissions, IconPendingDocs } from "@/components/navigation/NavIcons";
import DashboardPanel from "@/components/home/DashboardPanel";
import HomeAnnouncementRow from "@/components/home/HomeAnnouncementRow";
import HomeModuleCard from "@/components/home/HomeModuleCard";
import styles from "@/components/home/HomeDashboard.module.css";
import type { ModuleResponse } from "@/app/communities/irm/modules/page";
import type { AnnouncementCardData } from "@/components/AnnouncementCard";

export default function Home() {
  const {
    user,
    membership,
    isLoading: authLoading,
    isRefreshing,
    isLoggingOut,
    error: authError,
    membershipError,
    refresh,
  } = useAuth();

  const [announcements, setAnnouncements] = useState<AnnouncementCardData[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [announcementsError, setAnnouncementsError] = useState<string | null>(null);

  const [modules, setModules] = useState<ModuleResponse[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [modulesOwnerId, setModulesOwnerId] = useState<string | null>(() => user?.id ?? null);
  const [announcementsOwnerId, setAnnouncementsOwnerId] = useState<string | null>(() => user?.id ?? null);
  const [membershipOwnerId, setMembershipOwnerId] = useState<string | null>(() => user?.id ?? null);
  const announcementsOwnerRef = useRef<string | null>(user?.id ?? null);
  const modulesOwnerRef = useRef<string | null>(user?.id ?? null);
  const authUserId = user?.id;

  const announcementsAbortRef = useRef<AbortController | null>(null);
  const announcementsRequestIdRef = useRef<number>(0);

  const modulesAbortRef = useRef<AbortController | null>(null);
  const modulesRequestIdRef = useRef<number>(0);

  useEffect(() => {
    if (authUserId && !authLoading && !isRefreshing && !authError && !membershipError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMembershipOwnerId(authUserId);
    } else if (!user && !authLoading) {
      setMembershipOwnerId(null);
    }
  }, [authUserId, user, authLoading, isRefreshing, authError, membershipError]);

  const membershipKnownForUser = !!user && (membershipOwnerId === user.id || (membershipOwnerId === null && !isRefreshing)) && !authLoading && !isLoggingOut && !authError && !membershipError && !(isRefreshing && !membership);
  const isEligible = membershipKnownForUser && membership?.status === "ACTIVE";

  const loadLatest = useCallback(async () => {
    if (!isEligible || !user) {
      setAnnouncements([]);
      announcementsOwnerRef.current = null;
      setAnnouncementsOwnerId(null);
      setAnnouncementsError(null);
      setLoadingAnnouncements(false);
      return;
    }

    if (announcementsAbortRef.current) {
      announcementsAbortRef.current.abort();
    }
    const controller = new AbortController();
    announcementsAbortRef.current = controller;
    const currentRequestId = ++announcementsRequestIdRef.current;

    if (announcementsOwnerRef.current !== user.id) setAnnouncements([]);
    announcementsOwnerRef.current = user.id;
    setAnnouncementsOwnerId(user.id);
    setLoadingAnnouncements(true);
    setAnnouncementsError(null);

    try {
      const data = await fetchApi<AnnouncementCardData[]>(
        "/api/v1/communities/irm/announcements?limit=3",
        { signal: controller.signal }
      );
      if (currentRequestId === announcementsRequestIdRef.current) {
        setAnnouncements(data);
      }
    } catch (err) {
      if (currentRequestId !== announcementsRequestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setAnnouncements([]);
          setAnnouncementsError("You do not have access to view community announcements.");
          return;
        }
        setAnnouncementsError("Announcements could not be loaded. Please try again.");
      } else if (err instanceof Error) {
        setAnnouncementsError("Announcements could not be loaded. Please try again.");
      } else {
        setAnnouncementsError("Failed to load announcements.");
      }
    } finally {
      if (currentRequestId === announcementsRequestIdRef.current) {
        setLoadingAnnouncements(false);
      }
    }
  }, [isEligible, user]);

  const loadModules = useCallback(async () => {
    if (!user || authLoading || isLoggingOut) {
      setModules([]);
      modulesOwnerRef.current = null;
      setModulesOwnerId(null);
      setModulesError(null);
      setLoadingModules(false);
      return;
    }

    if (modulesAbortRef.current) {
      modulesAbortRef.current.abort();
    }
    const controller = new AbortController();
    modulesAbortRef.current = controller;
    const currentRequestId = ++modulesRequestIdRef.current;

    if (modulesOwnerRef.current !== user.id) setModules([]);
    modulesOwnerRef.current = user.id;
    setModulesOwnerId(user.id);
    setLoadingModules(true);
    setModulesError(null);

    try {
      const data = await fetchApi<ModuleResponse[]>(
        "/api/v1/communities/irm/modules",
        { signal: controller.signal }
      );
      if (currentRequestId === modulesRequestIdRef.current) {
        setModules(data.slice(0, 4));
      }
    } catch (err) {
      if (currentRequestId !== modulesRequestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setModules([]);
          setModulesError("Please log in to view modules.");
          return;
        }
        setModulesError("Modules could not be loaded. Please try again.");
      } else if (err instanceof Error) {
        setModulesError("Modules could not be loaded. Please try again.");
      } else {
        setModulesError("Failed to load modules.");
      }
    } finally {
      if (currentRequestId === modulesRequestIdRef.current) {
        setLoadingModules(false);
      }
    }
  }, [user, authLoading, isLoggingOut]);

  useEffect(() => {
    if (isEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadLatest();
    } else {
      announcementsRequestIdRef.current++;
      if (announcementsAbortRef.current) {
        announcementsAbortRef.current.abort();
      }
      setAnnouncements([]);
      announcementsOwnerRef.current = null;
      setAnnouncementsOwnerId(null);
      setAnnouncementsError(null);
      setLoadingAnnouncements(false);
    }

    return () => {
      if (announcementsAbortRef.current) {
        announcementsAbortRef.current.abort();
      }
    };
  }, [isEligible, user?.id, loadLatest]);

  useEffect(() => {
    if (user && !authLoading && !isLoggingOut) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadModules();
    } else {
      modulesRequestIdRef.current++;
      if (modulesAbortRef.current) {
        modulesAbortRef.current.abort();
      }
      setModules([]);
      modulesOwnerRef.current = null;
      setModulesOwnerId(null);
      setModulesError(null);
      setLoadingModules(false);
    }

    return () => {
      if (modulesAbortRef.current) {
        modulesAbortRef.current.abort();
      }
    };
  }, [user, authLoading, isLoggingOut, loadModules]);

  if (authLoading || (!user && (isRefreshing || isLoggingOut))) {
    return (
      <PageContainer width="wide" className={styles.guestPage}>
        <section className={styles.checkingState} aria-labelledby="session-loading-heading">
          <h1 id="session-loading-heading">EtudSup</h1>
          <p role="status">Checking your account…</p>
        </section>
      </PageContainer>
    );
  }

  // A failed session check is not proof of a guest session. Keep the page neutral
  // and let the visitor retry rather than showing guest or member content.
  if (!user && authError) {
    return (
      <PageContainer width="wide" className={styles.guestPage}>
        <section className={styles.checkingState} aria-labelledby="session-check-heading">
          <h1 id="session-check-heading">We couldn’t verify your account</h1>
          <p role="status">Your session check did not complete. Try again to continue.</p>
          <button type="button" onClick={refresh} className={buttonStyles("secondary", styles.retryAction)}>Try again</button>
        </section>
      </PageContainer>
    );
  }

  if (!user) {
    return <GuestHome />;
  }

  const membershipState = !membershipKnownForUser
    ? "checking"
    : membership?.status === "ACTIVE"
    ? "active"
    : membership?.status === "PENDING"
    ? "pending"
    : membership?.status === "REJECTED"
    ? "rejected"
    : membership?.status === "REMOVED"
    ? "removed"
    : membership?.status === "BANNED"
    ? "banned"
    : membership
    ? "restricted"
    : "none";
  const visibleAnnouncements = !isLoggingOut && announcementsOwnerId === user.id ? announcements : [];
  const visibleModules = !isLoggingOut && modulesOwnerId === user.id ? modules : [];
  const membershipAction = membershipState === "pending"
    ? { label: "View application", href: "/account#community-membership" }
    : membershipState === "rejected" || membershipState === "removed"
    ? { label: "Review or reapply", href: "/account#community-membership" }
    : membershipState === "banned" || membershipState === "restricted" || membershipState === "checking"
    ? { label: "Contact Support", href: "/support" }
    : { label: "Request membership", href: "/account#community-membership" };
  const quickLinks = [
    { label: "Saved documents", href: "/communities/irm/documents/saved", Icon: IconSaved },
    { label: "Recently opened", href: "/communities/irm/documents/recent", Icon: IconRecent },
    ...(isEligible && !isRefreshing ? [
      { label: "My submissions", href: "/communities/irm/documents/mine", Icon: IconSubmissions },
      { label: "Pending documents", href: "/communities/irm/documents/pending", Icon: IconPendingDocs },
    ] : []),
  ];
  const accessCopy = membershipState === "checking"
    ? "Checking your IRM membership. Your personal document tools remain available."
    : membershipState === "active"
    ? "Your IRM community access is active."
    : membershipState === "pending"
    ? "A Delegate is reviewing your application."
    : membershipState === "rejected"
    ? "Your application was not approved. Review the decision before reapplying."
    : membershipState === "removed"
    ? "Your community membership ended. You can review or reapply."
    : membershipState === "banned"
    ? "Community access is restricted. Reapplication is unavailable."
    : membershipState === "restricted"
    ? "This membership status does not grant community access."
    : "Request IRM membership to join the community. A Delegate reviews applications.";

  const membershipTitle = membershipError || authError
    ? "Verification unavailable"
    : membershipState === "checking" ? "Checking membership"
    : membershipState === "active" ? `Active ${membership?.role.toLowerCase()}`
    : membershipState === "pending" ? "Application pending"
    : membershipState === "rejected" ? "Application not approved"
    : membershipState === "removed" ? "Membership ended"
    : membershipState === "banned" ? "Access restricted"
    : membershipState === "restricted" ? "Membership unavailable"
    : "No membership request";

  return (
    <PageContainer width="wide" className={`${styles.page} ${styles.signedPage}`}>
      <div className={styles.dashboard}>
        <div className={styles.signedGrid}>
          <div className={styles.signedMain}>
            <HomeWelcomeHero username={user.username} />
            <section aria-label="Useful next steps" className={styles.signedFeatures}>
              <DashboardActionCard className={styles.signedFeatureCard} title="Study resources"
                description="Browse IRM modules and their approved course materials."
                action="Browse modules" href="/communities/irm/modules" icon={<IconModules />} />
              <DashboardActionCard className={styles.signedFeatureCard} title="Community spaces"
                description={isEligible ? "Connect with IRM members in posts and live discussion." : "Active IRM membership opens posts and community discussion."}
                action={isEligible ? "Join discussion" : membershipAction.label}
                href={isEligible ? "/communities/irm/discussion" : membershipAction.href} icon={<IconDiscussion />} />
              <DashboardActionCard className={styles.signedFeatureCard} title="Latest announcements"
                description={isEligible ? "Read the latest updates published for IRM members." : "Community updates become available with active membership."}
                action={isEligible ? "View announcements" : membershipAction.label}
                href={isEligible ? "/communities/irm/announcements" : membershipAction.href} icon={<IconAnnouncements />} />
            </section>
            <HomeMobileShortcuts isEligible={isEligible && !isRefreshing} guidance={isRefreshing
              ? { href: "/account#community-membership", label: "Check membership access" } : membershipAction} />

            {isEligible && <DashboardPanel
              title="Latest announcements"
              className={styles.announcementsSection}
              bare
              ariaLabelledBy="latest-announcements-heading"
              headerAction={isEligible ? (
                <Link href="/communities/irm/announcements" prefetch={false} className={buttonStyles("quiet", styles.signedPanelAction)}>
                  All announcements <span aria-hidden="true">→</span>
                </Link>
              ) : undefined}
            >
              {(loadingAnnouncements || announcementsOwnerId !== user.id) && visibleAnnouncements.length === 0 ? (
                <ContentLoading label="Loading latest announcements…" kind="announcement" count={2} />
              ) : announcementsError && visibleAnnouncements.length === 0 ? (
                <FeedbackMessage type="error" message={announcementsError} onRetry={loadLatest} retryLabel="Retry Loading" />
              ) : visibleAnnouncements.length === 0 ? (
                <ContentEmpty title="No announcements published yet." description="IRM updates will appear here when published." />
              ) : (
                <>
                  {loadingAnnouncements && <p role="status" className="ui-helper">Refreshing announcements…</p>}
                  {announcementsError && <FeedbackMessage type="error" message={announcementsError} onRetry={loadLatest} retryLabel="Retry Loading" />}
                  <div className={styles.signedAnnouncementList}>
                    {visibleAnnouncements.map((announcement) => (
                      <HomeAnnouncementRow key={announcement.id} announcement={announcement} />
                    ))}
                  </div>
                </>
              )}
            </DashboardPanel>}

            <DashboardPanel
              title="Your modules"
              className={styles.modulesSection}
              bare
              ariaLabelledBy="community-modules-heading"
              headerAction={<Link href="/communities/irm/modules" className={buttonStyles("quiet", styles.signedPanelAction)}>All modules <span aria-hidden="true">→</span></Link>}
            >
              {(loadingModules || modulesOwnerId !== user.id) && visibleModules.length === 0 ? (
                <ContentLoading label="Loading modules…" kind="module" count={2} />
              ) : modulesError && visibleModules.length === 0 ? (
                <FeedbackMessage type="error" message={modulesError} onRetry={loadModules} retryLabel="Retry Loading" />
              ) : visibleModules.length === 0 ? (
                <ContentEmpty title="No modules found." description="IRM modules will appear here when available." />
              ) : (
                <>
                  {loadingModules && <p role="status" className="ui-helper">Refreshing modules…</p>}
                  {modulesError && <FeedbackMessage type="error" message={modulesError} onRetry={loadModules} retryLabel="Retry Loading" />}
                  <div className={styles.signedModules}>
                    {visibleModules.map((module) => <HomeModuleCard key={module.id} module={module} />)}
                  </div>
                </>
              )}
            </DashboardPanel>

          </div>
          <aside className={styles.signedAside} aria-label="IRM shortcuts and access">
            <DashboardPanel title="Quick access" ariaLabelledBy="home-quick-heading" className={styles.quickPanel}>
              <div className={styles.signedQuickGrid}>
                {quickLinks.map(({ label, href, Icon }) => (
                  <Link key={href} href={href} prefetch={false} className={`ui-card-link ${styles.signedQuickTile}`}>
                    <Icon /><span>{label}</span>
                  </Link>
                ))}
              </div>
            </DashboardPanel>
            <DashboardPanel title="Your IRM access" ariaLabelledBy="home-membership-heading" className={styles.accessPanel}>
              <div className={styles.accessContent}>
                <div>
                  <p className={styles.accessContext}>IRM · FST Mohammedia</p>
                  <p className={styles.accessStatus}>{membershipTitle}</p>
                  {isRefreshing && membership && !membershipError && !authError && (
                    <p role="status" className={styles.refreshNote}>Refreshing membership details…</p>
                  )}
                  <p className={styles.signedAccessCopy}>{membershipError || authError
                    ? "We could not verify your IRM access. Retry before using protected community actions."
                    : accessCopy}</p>
                </div>
                <div className={styles.accessLinks}>
                  {membershipError || authError ? (
                    <button type="button" onClick={refresh} className={buttonStyles("secondary", styles.signedInlineAction)}>Retry verification <span aria-hidden="true">↻</span></button>
                  ) : membershipState === "checking" ? (
                    <p role="status" className="ui-helper">Your signed-in study resources remain available while membership is checked.</p>
                  ) : membershipState === "active" ? (
                    <Link href="/support" className={buttonStyles("quiet", styles.signedInlineAction)}>Need help? Contact Support</Link>
                  ) : membershipState === "banned" || membershipState === "restricted" ? (
                    <Link href="/support" className={buttonStyles("secondary", styles.signedInlineAction)}>Contact Support <span aria-hidden="true">→</span></Link>
                  ) : (
                    <Link href="/account#community-membership" className={buttonStyles("secondary", styles.signedInlineAction)}>{membershipState === "pending" ? "Check application" : membershipState === "rejected" || membershipState === "removed" ? "Review or reapply" : "Request membership"}<span aria-hidden="true">→</span></Link>
                  )}
                </div>
              </div>
            </DashboardPanel>

          </aside>
        </div>
      </div>
    </PageContainer>
  );
}
