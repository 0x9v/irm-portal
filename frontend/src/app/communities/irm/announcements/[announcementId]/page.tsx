"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAsyncScope } from "@/lib/useAsyncScope";
import AnnouncementModerationAction from "@/components/AnnouncementModerationAction";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import AnnouncementReplies from "@/components/AnnouncementReplies";
import styles from "@/components/Announcements.module.css";

interface AnnouncementDetail {
  id: string;
  community_id: string;
  author_id: string;
  author_username?: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

function isMeaningfullyUpdated(created: string, updated: string): boolean {
  try {
    const c = new Date(created).getTime();
    const u = new Date(updated).getTime();
    if (isNaN(c) || isNaN(u)) return false;
    return u - c > 60000;
  } catch {
    return false;
  }
}

export default function AnnouncementDetailPage() {
  const params = useParams();
  const rawId = params?.announcementId;
  const announcementId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const { user, membership, isLoading: authLoading, membershipError, error: authError, refresh } = useAuth();
  const [announcement, setAnnouncement] = useState<AnnouncementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const isEligible = !authLoading && !!user && !membershipError && !authError && membership?.status === "ACTIVE";

  const captureScope = useAsyncScope(`${user?.id}:${isEligible}:${announcementId}`);

  const loadDetail = useCallback(async () => {
      const isCurrent = captureScope();
    if (!isEligible) {
      setAnnouncement(null);
      setLoading(false);
      return;
    }

    if (!announcementId || !UUID_REGEX.test(announcementId)) {
      setAnnouncement(null);
      setIsNotFound(true);
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;

    setAnnouncement(null);
    setLoading(true);
    setError(null);
    setIsNotFound(false);

    try {
      const data = await fetchApi<AnnouncementDetail>(
        `/api/v1/communities/irm/announcements/${announcementId}`,
        { signal: controller.signal }
      );
      if (isCurrent() && !controller.signal.aborted && currentRequestId === requestIdRef.current) {
        setAnnouncement(data);
      }
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted || currentRequestId !== requestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) void refresh();
        if (err.status === 404 || err.status === 422) {
          setAnnouncement(null);
          setIsNotFound(true);
        } else if (err.status === 401) {
          setAnnouncement(null);
          setError("Unauthorized. Please log in.");
        } else if (err.status === 403) {
          setAnnouncement(null);
          setError("Forbidden. You must be an active member of this community to view announcements.");
        } else {
          setError("Announcement could not be loaded. Please try again.");
        }
      } else if (err instanceof Error) {
        setError("Announcement could not be loaded. Please try again.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      if (isCurrent() && !controller.signal.aborted && currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [announcementId, isEligible, captureScope, refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [loadDetail]);

  const isGuest = !user && !authLoading;
  const isNonActive = !authLoading && !!user && !membershipError && !authError && membership?.status !== "ACTIVE";

  return (
    <PageContainer width="default">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Announcements", href: "/communities/irm/announcements" },
          { label: announcement?.title || "Announcement" },
        ]}
      />

      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <Link href="/communities/irm/announcements"
          className="ui-button ui-button--secondary">
          &larr; Back to Announcements
        </Link>
      </div>

      {authLoading ? (
        <div className="py-12 text-center text-text-muted text-sm">
          Loading announcement...
        </div>
      ) : isGuest ? (
        <AccessDeniedGuidance
          isGuest={true}
          returnHref="/communities/irm/announcements"
          returnLabel="Announcements"
        />
      ) : membershipError || authError ? (
        <div className="my-4">
          <FeedbackMessage
            type="error"
            message="Membership could not be verified. Retry to check access."
            onRetry={refresh}
            retryLabel="Retry Verification"
          />
        </div>
      ) : isNonActive ? (
        <AccessDeniedGuidance
          membershipStatus={membership?.status}
          returnHref="/communities/irm/announcements"
          returnLabel="Announcements"
        />
      ) : isNotFound ? (
        <AccessDeniedGuidance
          isNotFound={true}
          notFoundMessage="The requested announcement could not be found or may have been removed."
          returnHref="/communities/irm/announcements"
          returnLabel="Announcements"
        />
      ) : loading ? (
        <div className="py-12 text-center text-text-muted text-sm">
          Loading announcement...
        </div>
      ) : error ? (
        <div className="my-4">
          <FeedbackMessage
            type="error"
            message={error}
            onRetry={loadDetail}
            retryLabel="Retry Loading"
          />
        </div>
      ) : announcement ? (
        <article className={styles.detail}>
          <div className={`${styles.detailHeader} space-y-3`}>
            <div className={styles.detailTop}>
              <p className="ui-eyebrow">IRM / Community</p>
              <AnnouncementModerationAction kind="announcement" id={announcement.id} context={announcement.title} onCheck={loadDetail}
                onRemoved={() => { requestIdRef.current++; abortControllerRef.current?.abort(); setAnnouncement(null); setIsNotFound(true); setLoading(false); }} />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-text break-words tracking-tight">
              {announcement.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              <time dateTime={announcement.created_at}>
                Posted {formatDate(announcement.created_at)}
              </time>
              {announcement.author_username && (
                <>
                  <span aria-hidden="true">&bull;</span>
                  <span>By @{announcement.author_username}</span>
                </>
              )}
              {isMeaningfullyUpdated(announcement.created_at, announcement.updated_at) && (
                <>
                  <span aria-hidden="true">&bull;</span>
                  <time dateTime={announcement.updated_at} className="italic text-text-subtle">
                    (Updated {formatDate(announcement.updated_at)})
                  </time>
                </>
              )}
            </div>
          </div>

          <div className={styles.detailBody}>
          <div className={styles.bodyText}>
            {announcement.content}
          </div>

          {isEligible && (
            <AnnouncementReplies
              key={`${announcement.id}-${user?.id ?? "guest"}`}
              communitySlug="irm"
              announcementId={announcement.id}
            />
          )}
          </div>
        </article>
      ) : null}
    </PageContainer>
  );
}
