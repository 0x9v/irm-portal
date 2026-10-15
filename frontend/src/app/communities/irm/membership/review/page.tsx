"use client";

import { PendingLabel } from "@/components/ui/Button";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { isConfirmedDelegate } from "@/lib/moderation";
import { useAsyncScope } from "@/lib/useAsyncScope";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import { ContentEmpty } from "@/components/ContentState";

type PendingMembership = {
  id: string;
  status: string;
  role: string;
  cne: string | null;
  applicant_type: "STUDENT" | "LAUREATE" | null;
  applicant_first_name: string | null;
  applicant_family_name: string | null;
  identifier_type: "MASSAR" | "FOREIGN" | null;
  promotion: string | null;
  created_at: string;
  updated_at: string;
  username: string;
  first_name: string;
  family_name: string;
};

export default function MembershipReviewPage() {
  const auth = useAuth();
  if (!isConfirmedDelegate(auth)) return <PageContainer width="wide">
    {auth.isLoading || auth.isRefreshing ? <p role="status">Checking Delegate access…</p>
      : <FeedbackMessage type="error" message={auth.membershipError || auth.error ? "Delegate access could not be verified. Please try again." : "Only confirmed ACTIVE Delegates can review applications."} onRetry={auth.refresh} retryLabel="Verify access" />}
    <Link href="/account#community-membership" className="inline-flex min-h-[44px] items-center text-accent">Back to Community membership</Link>
  </PageContainer>;
  return <AuthorizedMembershipReview key={`${auth.user!.id}:${auth.membership!.id}`} />;
}

function AuthorizedMembershipReview() {
  const { user, membership, isLoading: authLoading, refresh } = useAuth();

  const [queue, setQueue] = useState<PendingMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ text: string; safeToRetry: boolean } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  const captureScope = useAsyncScope(`${user?.id}:${membership?.id}`);

  const fetchQueue = useCallback(async () => {
    const isCurrent = captureScope();
    setLoading(true);
    setError(null);
    setRefreshWarning(null);
    try {
      const data = await fetchApi("/api/v1/communities/irm/membership/pending");
      if (!isCurrent()) return;
      setQueue(data as PendingMembership[]);
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError({ text: "Authentication expired. Please log in again.", safeToRetry: false });
          refresh();
        } else if (err.status === 403) {
          setError({ text: "Authorization denied. You must be an ACTIVE DELEGATE.", safeToRetry: false });
          refresh();
        } else if (err.status === 404) {
          setError({ text: "Community not found or unavailable.", safeToRetry: false });
        } else {
          setError({ text: "Could not fetch pending applications. Please try again.", safeToRetry: true });
        }
      } else {
        setError({ text: "A network error occurred.", safeToRetry: true });
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [refresh, captureScope]);

  useEffect(() => {
    if (membership && membership.status === "ACTIVE" && membership.role === "DELEGATE") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchQueue();
    }
  }, [membership, fetchQueue]);

  // Clear data on unmount or auth loss
  useEffect(() => {
    if (!user || (membership && (membership.status !== "ACTIVE" || membership.role !== "DELEGATE"))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQueue([]);
      setConfirmation(null);
      setError(null);
    }
  }, [user, membership]);

  if (authLoading) {
    return (
      <PageContainer width="wide">
        <div className="py-12 text-center text-text-subtle text-sm">Loading applications queue...</div>
      </PageContainer>
    );
  }

  if (!user) {
    return (
      <PageContainer width="wide">
        <AccessDeniedGuidance isGuest={true} returnHref="/account#community-membership" returnLabel="Membership" />
      </PageContainer>
    );
  }

  if (!membership || membership.status !== "ACTIVE" || membership.role !== "DELEGATE") {
    return (
      <PageContainer width="wide">
        <AccessDeniedGuidance
          membershipStatus={membership?.status}
          missingPermission="ACTIVE DELEGATE role"
          returnHref="/account#community-membership"
          returnLabel="Membership"
        />
      </PageContainer>
    );
  }

  const handleReview = async (id: string, action: "approve" | "reject") => {
    const isCurrent = captureScope();
    setProcessingId(id);
    setConfirmation(null);
    setRefreshWarning(null);

    try {
      const resp = await fetchApi(`/api/v1/communities/irm/membership/${id}/${action}`, {
        method: "POST",
      });

      if (!isCurrent()) return;
      const newStatus = (resp as Record<string, unknown>).status as string;
      const newRole = (resp as Record<string, unknown>).role as string;

      setConfirmation({
        text: `Application was successfully ${action}d. Resulting status: ${newStatus}, role: ${newRole}.`,
        type: "success",
      });

      // Successfully processed, try refreshing the queue
      try {
        const refreshedData = await fetchApi("/api/v1/communities/irm/membership/pending");
        if (!isCurrent()) return;
        setQueue(refreshedData as PendingMembership[]);
      } catch {
        if (!isCurrent()) return;
        setRefreshWarning("Action recorded. The queue could not refresh; retry loading the queue.");
      }

    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setConfirmation({
            text: "Application could not be reviewed in its current state (it may already have been processed).",
            type: "info",
          });
          fetchQueue();
        } else if (err.status === 401 || err.status === 403) {
          setConfirmation({ text: "Authorization changed during review. Please refresh.", type: "error" });
          refresh();
        } else {
          setConfirmation({ text: "Completion could not be confirmed. Please refresh before retrying.", type: "error" });
        }
      } else {
        setConfirmation({ text: "A network error occurred. Please refresh before retrying.", type: "error" });
      }
    } finally {
      if (isCurrent()) setProcessingId(null);
    }
  };

  return (
    <PageContainer width="wide">
      {/* Breadcrumb Navigation */}
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Membership", href: "/account#community-membership" },
          { label: "Review Applications" },
        ]}
      />

      <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
        <div className="flex flex-wrap gap-4 items-center text-sm">
          <Link
            href="/account#community-membership"
            className="ui-button ui-button--secondary"
          >
            &larr; Back to Community membership
          </Link>
          <Link
            href="/communities/irm/modules"
            className="ui-button ui-button--secondary"
          >
            Explore Modules
          </Link>
        </div>
        <Link
          href="/communities/irm/membership/staff"
          className="ui-button ui-button--secondary"
        >
          Staff Management &rarr;
        </Link>
      </div>

      <div className="bg-surface border border-border rounded-surface shadow-none p-6 sm:p-8 space-y-6">
        <div>
          <p className="ui-eyebrow">IRM / Membership</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">Review Applications</h1>
          <p className="text-sm text-text-muted mt-1 leading-relaxed">
            Review the submitted application details carefully.
            <br />
            <strong>Approval activates membership. Rejection allows the applicant to reapply.</strong>
          </p>
        </div>

        {confirmation && (
          <FeedbackMessage type={confirmation.type} message={confirmation.text} />
        )}

        {refreshWarning && (
          <FeedbackMessage
            type="warning"
            message={refreshWarning}
            onRetry={fetchQueue}
            retryLabel="Retry loading queue"
          />
        )}

        {error ? (
          <FeedbackMessage
            type="error"
            message={error.text}
            onRetry={error.safeToRetry ? fetchQueue : undefined}
            retryLabel="Retry Loading"
          />
        ) : loading && queue.length === 0 ? (
          <div className="py-8 text-center text-text-muted text-sm">Loading queue...</div>
        ) : queue.length === 0 ? (
          <ContentEmpty title="No pending applications at this time." description="New requests will appear here for review."
            action={<button type="button" onClick={fetchQueue} className="ui-button ui-button--secondary">Refresh Queue</button>} />
        ) : (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={fetchQueue}
                disabled={!!processingId || loading}
                className="ui-button ui-button--secondary"
              >
                <PendingLabel pending={!!(loading)} idle="Refresh Queue" busy="Refreshing..." />
              </button>
            </div>

            {queue.map((app) => (
              <div
                key={app.id}
                className="p-4 sm:p-5 border border-border rounded-surface flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-secondary hover:bg-surface transition-colors"
              >
                <div className="space-y-1.5 min-w-0">
                  <p className="font-semibold text-base sm:text-lg text-text break-words">
                    Account: {app.first_name || ""} {app.family_name || ""}{" "}
                    <span className="text-text-muted text-sm font-normal">(@{app.username})</span>
                  </p>
                  <div className="text-xs sm:text-sm text-text-muted space-y-1">
                    {app.applicant_type ? <>
                      <p>Application type: <span className="font-semibold text-text">{app.applicant_type}</span></p>
                      <p>Submitted application name: <span className="font-semibold text-text">{app.applicant_first_name || "Unavailable"} {app.applicant_family_name || "Unavailable"}</span></p>
                      {app.applicant_type === "STUDENT" && <p>Student identifier{app.identifier_type ? ` (${app.identifier_type})` : ""}: <span className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-text font-semibold">{app.cne || "Unavailable"}</span></p>}
                      {app.applicant_type === "LAUREATE" && app.promotion && <p>Promotion: <span className="font-semibold text-text">{app.promotion}</span></p>}
                    </> : <>
                      {app.cne && <p>CNE: <span className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-text font-semibold">{app.cne}</span></p>}
                      <p>Application details unavailable (legacy application).</p>
                    </>}
                    <p>
                      Status: <span className="font-medium text-warning bg-warning-surface px-2 py-0.5 rounded-full text-xs">{app.status}</span>
                    </p>
                    <p className="text-xs text-text-subtle">
                      Applied: {new Date(app.created_at).toLocaleString()}
                      {app.updated_at !== app.created_at && ` (Updated: ${new Date(app.updated_at).toLocaleString()})`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 shrink-0 pt-2 md:pt-0">
                  <button
                    onClick={() => handleReview(app.id, "approve")}
                    disabled={!!processingId}
                    className="ui-button ui-button--primary w-full sm:w-auto"
                  >
                    <PendingLabel pending={!!(processingId === app.id)} idle="Approve" busy="Processing..." />
                  </button>
                  <button
                    onClick={() => handleReview(app.id, "reject")}
                    disabled={!!processingId}
                    className="ui-button ui-button--destructive w-full sm:w-auto"
                  >
                    <PendingLabel pending={!!(processingId === app.id)} idle="Reject" busy="Processing..." />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
