"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAsyncScope } from "@/lib/useAsyncScope";
import AnnouncementModerationAction from "@/components/AnnouncementModerationAction";
import { RemovalLedger } from "@/lib/moderation";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import AnnouncementCard, { AnnouncementCardData } from "@/components/AnnouncementCard";
import { ContentLoading, ContentEmpty } from "@/components/ContentState";
import { PendingLabel } from "@/components/ui/Button";
import styles from "@/components/Announcements.module.css";

export default function AnnouncementsPage() {
  const { user, membership, capabilities, isLoading: authLoading, membershipError, error: authError, refresh } = useAuth();
  const [announcements, setAnnouncements] = useState<AnnouncementCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOutcomeUncertain, setFormOutcomeUncertain] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const [removed] = useState(() => new RemovalLedger());
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const reconcileRemoval = (id: string, unavailable: boolean) => {
    removed.remove(id);
    setAnnouncements(prev => prev.filter(item => item.id !== id));
    setRemovalNotice(unavailable ? "The announcement is unavailable and has been removed from this view." : "announcement removed from community view.");
  };

  const isEligible = !authLoading && !!user && !membershipError && !authError && membership?.status === "ACTIVE";

  const captureScope = useAsyncScope(`${user?.id}:${isEligible}`);

  const loadAnnouncements = useCallback(async () => {
    const isCurrent = captureScope();
    if (!isEligible) {
      setAnnouncements([]);
      setTitle(""); setContent(""); setFormError(null); setFormOutcomeUncertain(false); setFormSuccess(null);
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchApi<AnnouncementCardData[]>(
        "/api/v1/communities/irm/announcements",
        { signal: controller.signal }
      );
      if (isCurrent() && !controller.signal.aborted && currentRequestId === requestIdRef.current) {
        setAnnouncements(removed.filter(data));
      }
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted || currentRequestId !== requestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) void refresh();
        if (err.status === 401) {
          setAnnouncements([]);
          setError("Unauthorized. Please log in.");
        } else if (err.status === 403) {
          setAnnouncements([]);
          setError("Forbidden. You must be an active member of this community to view announcements.");
        } else {
          setError("Announcements could not be loaded. Please try again.");
        }
      } else if (err instanceof Error) {
        setError("Announcements could not be loaded. Please try again.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      if (isCurrent() && !controller.signal.aborted && currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [isEligible, removed, captureScope, refresh]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(""); setContent(""); setFormError(null); setFormOutcomeUncertain(false); setFormSuccess(null); setSubmitting(false);
  }, [user?.id, isEligible]);

  useEffect(() => {
    if (isEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAnnouncements();
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setAnnouncements([]);
      setTitle(""); setContent(""); setFormError(null); setFormOutcomeUncertain(false); setFormSuccess(null);
      setLoading(false);
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isEligible, loadAnnouncements]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEligible || submitting || !capabilities?.create_announcements) return;
    const isCurrent = captureScope();
    setSubmitting(true);
    setFormError(null);
    setFormOutcomeUncertain(false);
    setFormSuccess(null);

    try {
      await fetchApi("/api/v1/communities/irm/announcements", {
        method: "POST",
        body: JSON.stringify({ title, content }),
      });
      if (!isCurrent()) return;
      setFormSuccess("Announcement created successfully.");
      setTitle("");
      setContent("");
      await loadAnnouncements();
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setFormError("Forbidden. You do not have permission to create announcements.");
          await refresh(); // Refresh context and hide the form if revoked
        } else if (err.status === 422) {
          setFormError("Check the title and content, then try again.");
        } else {
          setFormOutcomeUncertain(true);
          setFormError("We could not confirm whether the announcement was posted. Check the list before submitting again.");
        }
      } else if (err instanceof Error) {
        setFormOutcomeUncertain(true);
        setFormError("We could not confirm whether the announcement was posted. Check the list before submitting again.");
      } else {
        setFormOutcomeUncertain(true);
        setFormError("We could not confirm whether the announcement was posted. Check the list before submitting again.");
      }
    } finally {
      if (isCurrent()) setSubmitting(false);
    }
  };

  useEffect(() => {
    const requestCounter = requestIdRef;
    return () => { removed.clear(); requestCounter.current++; };
  }, [user?.id, isEligible, removed]);

  const isGuest = !user && !authLoading;
  const isNonActive = !authLoading && !!user && !membershipError && !authError && membership?.status !== "ACTIVE";

  return (
    <PageContainer width="wide">
      {removalNotice && <FeedbackMessage type="info" message={removalNotice} />}
      {/* Breadcrumb Navigation */}
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Announcements" },
        ]}
      />

      <div className={`${styles.pageHeader} flex flex-wrap justify-between items-end gap-4`}>
        <div>
          <p className="ui-eyebrow">Community</p>
          <h1 className={`${styles.heading} text-text`}>Announcements</h1>
          <p className="ui-helper mt-2">Updates published for active IRM members.</p>
        </div>
        {isEligible && capabilities?.create_announcements &&
          <a href="#post-announcement" className="ui-button ui-button--secondary">Post an announcement</a>}
      </div>

      {authLoading ? (
        <ContentLoading label="Loading announcements…" kind="announcement" count={2} />
      ) : isGuest ? (
        <AccessDeniedGuidance isGuest={true} returnHref="/communities/irm/modules" returnLabel="Modules" />
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
        <AccessDeniedGuidance membershipStatus={membership?.status} returnHref="/communities/irm/modules" returnLabel="Modules" />
      ) : loading ? (
        <ContentLoading label="Loading announcements…" kind="announcement" count={2} />
      ) : error ? (
        <div className="my-4">
          <FeedbackMessage
            type="error"
            message={error}
            onRetry={loadAnnouncements}
            retryLabel="Retry Loading"
          />
        </div>
      ) : (
        <div className={styles.listLayout}>
          <div className={styles.announcementList}>
            {announcements.length === 0 ? (
              <ContentEmpty title="No announcements published yet." description="IRM updates will appear here when they are published." />
            ) : (
              announcements.map((announcement, index) => (
                <AnnouncementCard key={announcement.id} announcement={announcement} headingLevel="h2"
                  variant={index === 0 ? "featured" : "default"}
                  action={<AnnouncementModerationAction kind="announcement" id={announcement.id} context={announcement.title}
                    onRemoved={unavailable => reconcileRemoval(announcement.id, unavailable)} onCheck={loadAnnouncements} />} />
              ))
            )}
          </div>

          {capabilities?.create_announcements && (
            <div id="post-announcement" className={styles.createSection}>
              <div className="p-6 bg-surface border border-border rounded-surface shadow-none space-y-4">
                <h2 className="text-lg font-bold text-text">Post Announcement</h2>

                {formSuccess && (
                  <FeedbackMessage type="success" message={formSuccess} />
                )}

                {formError && (
                  <FeedbackMessage type="error" message={formError} onRetry={formOutcomeUncertain ? loadAnnouncements : undefined} retryLabel="Check announcements" />
                )}

                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text mb-1" htmlFor="announcement-title">
                      Title
                    </label>
                    <input
                      id="announcement-title"
                      type="text"
                      required
                      className="w-full p-2.5 bg-surface border border-border rounded-control text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent text-sm"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Title of announcement"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text mb-1" htmlFor="announcement-content">
                      Content
                    </label>
                    <textarea
                      id="announcement-content"
                      required
                      rows={5}
                      className="w-full p-2.5 bg-surface border border-border rounded-control text-text focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent text-sm"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Announcement body text..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    aria-busy={submitting}
                    className="ui-button ui-button--primary w-full"
                  >
                    <PendingLabel pending={submitting} idle="Post Announcement" busy="Posting…" />
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
