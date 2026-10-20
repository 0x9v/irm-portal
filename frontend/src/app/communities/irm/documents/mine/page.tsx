"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, API_URL, fetchApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import PageContainer from "@/components/PageContainer";
import DocumentRow from "@/components/DocumentRow";
import { ContentLoading, ContentEmpty } from "@/components/ContentState";
import { PendingLabel, buttonStyles } from "@/components/ui/Button";
import { documentSourceLabel, documentStatusLabel, documentTypeLabel } from "@/lib/documentPresentation";
import { resourceCategory, safeExternalUrl, validMyResourceFeed, type MyResourceItem } from "@/lib/moduleResources";
import ConfirmationDialog from "@/components/moderation/ConfirmationDialog";

type SubmissionStatus = "PENDING" | "APPROVED" | "REJECTED";
type Submission = MyResourceItem;

const PAGE_SIZE = 20;
const STATUS_OPTIONS: { value: "" | SubmissionStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Awaiting review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Not approved" },
];

function statusCopy(status: SubmissionStatus) {
  switch (status) {
    case "PENDING": return { label: documentStatusLabel(status), description: "This student submission remains pending while community votes are collected." };
    case "APPROVED": return { label: documentStatusLabel(status), description: "This resource is approved and available from its module." };
    case "REJECTED": return { label: documentStatusLabel(status), description: "This resource is not available in the module." };
  }
}

export default function MyDocumentSubmissionsPage() {
  const { user, membership, isLoading: authLoading, membershipError, refresh } = useAuth();
  const [statusFilter, setStatusFilter] = useState<"" | SubmissionStatus>("");
  const [items, setItems] = useState<Submission[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [resultOwnerId, setResultOwnerId] = useState<string | null>(null);
  const [resultStatus, setResultStatus] = useState<"" | SubmissionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "warning"; message: string } | null>(null);
  const actionRef = useRef<string | null>(null);
  const generation = useRef(0);
  const firstPageController = useRef<AbortController | null>(null);
  const nextPageController = useRef<AbortController | null>(null);
  const userId = user?.id;

  useEffect(() => {
    const requestGeneration = ++generation.current;
    firstPageController.current?.abort();
    nextPageController.current?.abort();
    firstPageController.current = null;
    nextPageController.current = null;
    // Clear a pending confirmation when the account, membership, or filter scope changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmId(null);

    if (authLoading || !userId || membership?.status !== "ACTIVE" || membershipError) {
      // Clear private rows when the session or community authorization changes.
      setItems([]);
      setNextCursor(null);
      setResultOwnerId(null);
      setResultStatus(null);
      setLoading(!authLoading && !!userId && membership?.status === "ACTIVE" && !membershipError);
      setLoadingMore(false);
      setError(null);
      setLoadMoreError(null);
      return;
    }

    const controller = new AbortController();
    firstPageController.current = controller;
    setItems([]);
    setNextCursor(null);
    setResultOwnerId(null);
    setResultStatus(null);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setLoadMoreError(null);

    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (statusFilter) params.set("status", statusFilter);
    fetchApi<unknown>(`/api/v1/communities/irm/resources/mine?${params.toString()}`, { signal: controller.signal })
      .then((feed) => {
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        if (!validMyResourceFeed(feed)) throw new Error("Invalid resource submissions");
        setItems(feed.items);
        setNextCursor(feed.next_cursor);
        setResultOwnerId(userId);
        setResultStatus(statusFilter);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || generation.current !== requestGeneration || (cause instanceof Error && cause.name === "AbortError")) return;
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
          setItems([]);
          setNextCursor(null);
          if (cause.status === 401) void refresh();
        }
        setError("Failed to load submissions. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted && generation.current === requestGeneration) setLoading(false);
      });

    const activeGeneration = generation;
    return () => { activeGeneration.current++; controller.abort(); };
  }, [authLoading, userId, membership?.id, membership?.status, membershipError, statusFilter, retryVersion, refresh]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || !user || membership?.status !== "ACTIVE" || loadingMore) return;
    nextPageController.current?.abort();
    const controller = new AbortController();
    nextPageController.current = controller;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), after: nextCursor });
    if (statusFilter) params.set("status", statusFilter);
    try {
      const feed = await fetchApi<unknown>(`/api/v1/communities/irm/resources/mine?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted || generation.current !== requestGeneration || user.id !== resultOwnerId || statusFilter !== resultStatus) return;
      if (!validMyResourceFeed(feed)) throw new Error("Invalid resource submissions");
      setItems((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [...previous, ...feed.items.filter((item) => !existing.has(item.id))];
      });
      setNextCursor(feed.next_cursor);
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== requestGeneration || (cause instanceof Error && cause.name === "AbortError")) return;
      setLoadMoreError("Failed to load more submissions. Please try again.");
    } finally {
      if (!controller.signal.aborted && generation.current === requestGeneration) setLoadingMore(false);
    }
  }, [nextCursor, user, membership?.status, loadingMore, statusFilter, resultOwnerId, resultStatus]);

  const hasCurrentResults = Boolean(user && resultOwnerId === user.id && resultStatus === statusFilter);
  const confirming = hasCurrentResults ? items.find(item => item.id === confirmId && item.can_delete) : null;

  const deleteSubmission = async (item: Submission) => {
    if (!hasCurrentResults || !item.can_delete || actionRef.current || !userId || membership?.status !== "ACTIVE") return;
    const owner = userId;
    const requestGeneration = generation.current;
    actionRef.current = item.id;
    setBusyId(item.id); setConfirmError(null); setNotice(null);
    try {
      await fetchApi<void>(`/api/v1/communities/irm/resources/${encodeURIComponent(item.id)}`,
        { method: "DELETE", cache: "no-store" }, 204, "none");
      if (generation.current !== requestGeneration || userId !== owner) return;
      setConfirmId(null);
      setItems(current => current.filter(row => row.id !== item.id));
      setNotice({ kind: "success", message: `“${item.title}” was removed from community access.` });
      setRetryVersion(value => value + 1);
    } catch (cause) {
      if (generation.current !== requestGeneration || userId !== owner) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setConfirmId(null); setItems([]); setNextCursor(null); void refresh();
      } else if (cause instanceof ApiError && cause.status === 409) {
        setConfirmId(null);
        setNotice({ kind: "warning", message: "Approved resources cannot be deleted. Refreshing your submissions." });
        setRetryVersion(value => value + 1);
      } else {
        const message = "The outcome could not be confirmed. Refresh your submissions to check its current state before another action.";
        setConfirmError(message); setNotice({ kind: "warning", message });
      }
    } finally {
      actionRef.current = null;
      if (generation.current === requestGeneration) setBusyId(null);
    }
  };

  return (
    <PageContainer width="wide">
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Modules", href: "/communities/irm/modules" },
        { label: "My Submissions" },
      ]} />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="ui-eyebrow">IRM / Your resources</p>
          <h1 className="ui-page-heading text-text">My Submissions</h1>
          <p className="ui-helper mt-1">Your resource submissions across IRM modules.</p>
        </div>
        <Link href="/communities/irm/modules" className={buttonStyles("quiet")}>Browse modules</Link>
      </div>

      {authLoading ? (
        <div className="py-12 text-center text-text-muted" role="status">Checking your account…</div>
      ) : !user ? (
        <AccessDeniedGuidance isGuest returnHref="/communities/irm/modules" returnLabel="Modules" />
      ) : membershipError ? (
        <FeedbackMessage type="error" message="Your IRM membership could not be verified. Retry to check access." onRetry={() => void refresh()} retryLabel="Retry" />
      ) : membership?.status !== "ACTIVE" ? (
        <AccessDeniedGuidance membershipStatus={membership?.status} returnHref="/communities/irm/modules" returnLabel="Modules" />
      ) : (
        <section aria-labelledby="submissions-heading" className="space-y-4">
          {notice && <FeedbackMessage type={notice.kind} message={notice.message}
            onRetry={notice.kind === "warning" ? () => setRetryVersion(value => value + 1) : undefined} retryLabel="Refresh submissions" />}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="submissions-heading" className="ui-section-heading text-text">Your resources</h2>
            <div className="w-full sm:w-auto">
              <label htmlFor="submission-status" className="block text-sm font-medium text-text mb-1">Status</label>
              <select
                id="submission-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "" | SubmissionStatus)}
                className="w-full sm:min-w-48 min-h-[44px] rounded-control border border-control-border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {STATUS_OPTIONS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>

          {loading || (!hasCurrentResults && !error) ? (
            <ContentLoading label="Loading your submissions…" kind="document" count={2} />
          ) : error ? (
            <FeedbackMessage type="error" message={error} onRetry={() => setRetryVersion((value) => value + 1)} retryLabel="Retry" />
          ) : items.length === 0 ? (
            statusFilter ? <ContentEmpty title="No submissions match this filter." description="Choose another review status to see your uploads."
              action={<button type="button" onClick={() => setStatusFilter("")} className={buttonStyles("quiet")}>Clear status filter</button>} />
              : <ContentEmpty title="You have not submitted any resources." description="Your IRM resources will appear here."
                action={<Link href="/communities/irm/modules" className={buttonStyles("secondary")}>Browse modules</Link>} />
          ) : (
            <>
              <div className="space-y-4">
                {items.map((item) => {
                  const copy = statusCopy(item.status);
                  return (
                    <DocumentRow key={item.id} title={item.title}
                      openHref={item.status === "APPROVED" && item.kind === "PDF" ? `/communities/irm/modules/${encodeURIComponent(item.module_slug)}/documents/${encodeURIComponent(item.id)}?from=mine` : undefined}
                      context={<>Module: <Link className="ui-link min-h-[44px] inline-flex items-center" href={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}?from=mine`}>{item.module_name}</Link></>}
                      status={<span className="inline-flex min-h-[32px] items-center rounded-tag border border-border bg-surface-secondary px-3 py-1 text-sm font-semibold text-text">{copy.label}</span>}
                      metadata={<>
                        <span>Catégorie: {resourceCategory(item) ? documentTypeLabel(resourceCategory(item)!) : "Non classé"}</span>
                        <span>Format: {item.kind}</span>
                        <span>Source: {documentSourceLabel(item.source)}</span>
                        <span>Submitted: <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString()}</time></span>
                        <span>{copy.description}</span>
                      </>}
                      actions={<>
                        {item.status === "APPROVED" && item.kind === "PDF" &&
                          <Link href={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}/documents/${encodeURIComponent(item.id)}?from=mine`} className={buttonStyles("secondary", "min-h-[44px]")}>Read document</Link>}
                        {item.status === "PENDING" && item.kind === "PDF" &&
                          <a href={`${API_URL}/api/v1/documents/${encodeURIComponent(item.id)}/preview`} target="_blank" rel="noreferrer" className={buttonStyles("secondary", "min-h-[44px]")}>Open first-page preview</a>}
                        {(item.kind === "YOUTUBE" || item.kind === "LINK") && safeExternalUrl(item) &&
                          <a href={safeExternalUrl(item)!} target="_blank" rel="noopener noreferrer" className={buttonStyles("secondary", "min-h-[44px]")}>Open resource</a>}
                        {item.can_delete && <button type="button" className={buttonStyles("destructive", "min-h-[44px]")}
                          disabled={!!busyId} onClick={() => { setConfirmError(null); setConfirmId(item.id); }}>Delete resource</button>}
                      </>}
                    />
                  );
                })}
              </div>

              {loadMoreError && <FeedbackMessage type="error" message={loadMoreError} onRetry={() => void loadMore()} retryLabel="Retry this page" />}
              {nextCursor && <button type="button" onClick={() => void loadMore()} disabled={loadingMore} aria-busy={loadingMore} className={buttonStyles("secondary", "w-full min-h-[44px]")}><PendingLabel pending={!!(loadingMore)} idle="Load more" busy="Loading more…" /></button>}
            </>
          )}
        </section>
      )}
      {confirming && <ConfirmationDialog title="Delete resource" heading="Delete this resource?"
        context={confirming.title} description="It will be removed from community access. Its stored record and file remain preserved."
        pending={busyId === confirming.id} error={confirmError} onCancel={() => setConfirmId(null)}
        onConfirm={() => void deleteSubmission(confirming)} onCheck={() => { setConfirmId(null); setRetryVersion(value => value + 1); }} />}
    </PageContainer>
  );
}
