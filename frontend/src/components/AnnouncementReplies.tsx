"use client";

import { PendingLabel } from "@/components/ui/Button";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import AnnouncementModerationAction from "@/components/AnnouncementModerationAction";
import { useAsyncScope } from "@/lib/useAsyncScope";
import { RemovalLedger } from "@/lib/moderation";
import FeedbackMessage from "@/components/FeedbackMessage";
import styles from "./Announcements.module.css";

export interface AnnouncementReply {
  id: string;
  announcement_id: string;
  author_username: string;
  content: string;
  created_at: string;
}

export interface AnnouncementReplyListResponse {
  items: AnnouncementReply[];
  next_cursor: string | null;
}

interface AnnouncementRepliesProps {
  communitySlug: string;
  announcementId: string;
}

export function countCodePoints(str: string): number {
  return Array.from(str).length;
}

function formatReplyDate(dateString: string): string {
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

export default function AnnouncementReplies({
  communitySlug,
  announcementId,
}: AnnouncementRepliesProps) {
  const { user, membership, membershipError, error: authError, refresh } = useAuth();

  const [items, setItems] = useState<AnnouncementReply[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isCursorInvalid, setIsCursorInvalid] = useState(false);

  // New replies posted by current session before canonical pages reach them
  const [newlyPostedReplies, setNewlyPostedReplies] = useState<AnnouncementReply[]>([]);
  const [isAccessDenied, setIsAccessDenied] = useState(false);

  // Composer state
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [isAmbiguousNetworkError, setIsAmbiguousNetworkError] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const readRequestIdRef = useRef<number>(0);
  const currentAnnouncementRef = useRef<string>(announcementId);
  const hasRefreshedAuthRef = useRef<boolean>(false);

  useEffect(() => {
    currentAnnouncementRef.current = announcementId;
  }, [announcementId]);

  const [removed] = useState(() => new RemovalLedger());
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const removeReply = (id: string, unavailable: boolean) => {
    removed.remove(id);
    setItems(prev => prev.filter(reply => reply.id !== id));
    setNewlyPostedReplies(prev => prev.filter(reply => reply.id !== id));
    setRemovalNotice(unavailable ? "The reply is unavailable and has been removed from this view." : "Reply removed from community view.");
  };

  const isEligible = !!user && !membershipError && !authError && membership?.status === "ACTIVE";

  const captureScope = useAsyncScope(`${user?.id}:${communitySlug}:${announcementId}:${isEligible}`);

  // Initial load or full refresh
  const loadInitialReplies = useCallback(
    async (isManualRefresh = false) => {
      const isCurrent = captureScope();
      if (!isEligible || !announcementId) {
        setDraft(""); setSubmitError(null); setSubmitSuccess(null);
        setItems([]);
        setNewlyPostedReplies([]);
        setNextCursor(null);
        setLoading(false);
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const currentRequestId = ++readRequestIdRef.current;

      if (!isManualRefresh) {
        setLoading(true);
      }
      setError(null);
      setLoadMoreError(null);
      setIsCursorInvalid(false);

      try {
        const res = await fetchApi<AnnouncementReplyListResponse>(
          `/api/v1/communities/${communitySlug}/announcements/${announcementId}/replies?limit=20`,
          { signal: controller.signal }
        );

        if (isCurrent() && !controller.signal.aborted && currentRequestId === readRequestIdRef.current) {
          setItems(removed.filter(res.items));
          setNextCursor(res.next_cursor);
        }
      } catch (err) {
        if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;

        if (err instanceof ApiError) {
          if (err.status === 401 || err.status === 403) {
            setIsAccessDenied(true);
            setItems([]);
            setNewlyPostedReplies([]);
            setNextCursor(null);
            setError("You do not have permission to view replies in this community.");
            if (!hasRefreshedAuthRef.current) {
              hasRefreshedAuthRef.current = true;
              refresh();
            }
          } else if (err.status === 404) {
            setError("The announcement could not be found.");
          } else {
            setError("Replies could not be loaded. Please try again.");
          }
        } else if (err instanceof Error) {
          setError("Replies could not be loaded. Please try again.");
        } else {
          setError("An unexpected error occurred while loading replies.");
        }
      } finally {
        if (isCurrent() && !controller.signal.aborted && currentRequestId === readRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [announcementId, communitySlug, isEligible, refresh, removed, captureScope]
  );

  // Load more pages
  const handleLoadMore = async () => {
    const isCurrent = captureScope();
    if (!nextCursor || loadMoreLoading || !isEligible) return;

    if (loadMoreAbortRef.current) {
      loadMoreAbortRef.current.abort();
    }
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    const currentRequestId = ++readRequestIdRef.current;

    setLoadMoreLoading(true);
    setLoadMoreError(null);
    setIsCursorInvalid(false);

    try {
      const res = await fetchApi<AnnouncementReplyListResponse>(
        `/api/v1/communities/${communitySlug}/announcements/${announcementId}/replies?limit=20&after=${encodeURIComponent(
          nextCursor
        )}`,
        { signal: controller.signal }
      );

      if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;

      setItems((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const uniqueNew = removed.filter(res.items).filter((r) => !existingIds.has(r.id));
        return [...prev, ...uniqueNew];
      });
      setNextCursor(res.next_cursor);
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") return;

      if (err instanceof ApiError && err.status === 400) {
        setIsCursorInvalid(true);
        setLoadMoreError(
          "Discussion has been updated. Please reload the discussion to view subsequent replies."
        );
      } else if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setIsAccessDenied(true);
          setItems([]);
          setNewlyPostedReplies([]);
          setNextCursor(null);
          setError("You do not have permission to view replies in this community.");
          if (!hasRefreshedAuthRef.current) {
            hasRefreshedAuthRef.current = true;
            refresh();
          }
          return;
        }
        setLoadMoreError("More replies could not be loaded. Please try again.");
      } else if (err instanceof Error) {
        setLoadMoreError("More replies could not be loaded. Please try again.");
      } else {
        setLoadMoreError("Failed to load more replies.");
      }
    } finally {
      if (isCurrent() && !controller.signal.aborted && currentRequestId === readRequestIdRef.current) {
        setLoadMoreLoading(false);
      }
    }
  };

  // Bounded catch-up read after last canonical item to reconcile intervening replies
  const reconcileNewReplies = useCallback(
    async (lastItemId?: string) => {
      const isCurrent = captureScope();
      if (!isEligible || !announcementId) return;

      const controller = new AbortController();
      const currentRequestId = ++readRequestIdRef.current;

      try {
        const url = lastItemId
          ? `/api/v1/communities/${communitySlug}/announcements/${announcementId}/replies?limit=20&after=${encodeURIComponent(
              lastItemId
            )}`
          : `/api/v1/communities/${communitySlug}/announcements/${announcementId}/replies?limit=20`;

        const res = await fetchApi<AnnouncementReplyListResponse>(url, {
          signal: controller.signal,
        });

        if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;
        if (!isCurrent() || currentAnnouncementRef.current !== announcementId) return;

        setItems((prev) => {
          const existingIds = new Set(prev.map((r) => r.id));
          const uniqueNew = removed.filter(res.items).filter((r) => !existingIds.has(r.id));
          return [...prev, ...uniqueNew];
        });
        setNewlyPostedReplies((prev) =>
          prev.filter((nr) => !res.items.some((r) => r.id === nr.id))
        );
        setNextCursor(res.next_cursor);
      } catch {
        // Catch-up read failure is non-fatal: newly posted replies remain safely displayed
        // in newlyPostedReplies, and success feedback is preserved.
      }
    },
    [announcementId, communitySlug, isEligible, removed, captureScope]
  );

  // Submit reply
  const handleSubmit = async (e: React.FormEvent) => {
    const isCurrent = captureScope();
    e.preventDefault();

    const trimmed = draft.trim();
    const count = countCodePoints(trimmed);

    if (count === 0 || count > 2000 || submitting || !isEligible || isAccessDenied) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    setIsAmbiguousNetworkError(false);

    try {
      const newReply = await fetchApi<AnnouncementReply>(
        `/api/v1/communities/${communitySlug}/announcements/${announcementId}/replies`,
        {
          method: "POST",
          body: JSON.stringify({ content: trimmed }),
        }
      );

      // Verify that announcement didn't switch during network roundtrip
      if (!isCurrent() || currentAnnouncementRef.current !== announcementId) return;

      setDraft("");
      setSubmitSuccess("Your reply was posted.");

      // Always keep new POST results in newlyPostedReplies first
      setNewlyPostedReplies((prev) =>
        prev.some((r) => r.id === newReply.id) ? prev : removed.filter([...prev, newReply])
      );

      // If all earlier pages were loaded (nextCursor === null), run bounded catch-up read
      // to reconcile with any intervening replies posted by others
      if (nextCursor === null) {
        const lastItemId = items.length > 0 ? items[items.length - 1].id : undefined;
        reconcileNewReplies(lastItemId);
      }
    } catch (err) {
      if (!isCurrent() || currentAnnouncementRef.current !== announcementId) return;

      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setIsAccessDenied(true);
          setItems([]);
          setNewlyPostedReplies([]);
          setNextCursor(null);
          setSubmitError(
            err.status === 401
              ? "Your session has expired. Please log in again."
              : "You do not have permission to reply to announcements in this community."
          );
          if (!hasRefreshedAuthRef.current) {
            hasRefreshedAuthRef.current = true;
            refresh();
          }
        } else if (err.status === 404) {
          setSubmitError("The announcement could not be found or may have been removed.");
        } else if (err.status === 422) {
          setSubmitError("Check your reply and try again.");
        } else if (err.status >= 500) {
          setIsAmbiguousNetworkError(true);
          setSubmitError(
            nextCursor !== null
              ? "The server encountered an error. Your reply may or may not have been saved. Please check the discussion before trying again. Note that earlier pages are shown first and new replies appear at the end."
              : "The server encountered an error. Your reply may or may not have been saved. Please check the discussion before trying again."
          );
        } else {
          setSubmitError("Your reply could not be posted. Please try again.");
        }
      } else if (err instanceof Error) {
        setIsAmbiguousNetworkError(true);
        setSubmitError(
          nextCursor !== null
            ? "Unable to reach the server. Your reply may or may not have been posted. Please check the discussion before trying again. Note that earlier pages are shown first and new replies appear at the end."
            : "Unable to reach the server. Your reply may or may not have been posted. Please check the discussion before trying again."
        );
      } else {
        setIsAmbiguousNetworkError(true);
        setSubmitError("We could not confirm whether your reply was posted. Check the discussion before trying again.");
      }
    } finally {
      if (isCurrent() && currentAnnouncementRef.current === announcementId) {
        setSubmitting(false);
      }
    }
  };

  const handleCheckDiscussion = () => {
    setSubmitError(null);
    setIsAmbiguousNetworkError(false);
    if (nextCursor === null && items.length > 0) {
      reconcileNewReplies(items[items.length - 1].id);
    } else {
      loadInitialReplies(true);
    }
  };

  // Load replies on mount or when loadInitialReplies changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInitialReplies();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
    };
  }, [loadInitialReplies]);

  // If user loses active status or logs out, abort active requests
  useEffect(() => {
    if (!isEligible) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
    }
  }, [isEligible]);

  useEffect(() => {
    const requestCounter = readRequestIdRef;
    return () => { removed.clear(); requestCounter.current++; };
  }, [user?.id, communitySlug, announcementId, isEligible, removed]);

  if (!isEligible) {
    return null;
  }

  // Deduplicate newly posted replies against loaded canonical items
  const unmergedPostedReplies = newlyPostedReplies.filter(
    (nr) => !items.some((r) => r.id === nr.id)
  );

  const trimmedDraft = draft.trim();
  const codePointCount = countCodePoints(trimmedDraft);
  const isOverLimit = codePointCount > 2000;
  const isEmpty = codePointCount === 0;

  return (
    <section className={styles.repliesSection} aria-labelledby="discussion-heading">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 id="discussion-heading" className="text-xl sm:text-2xl font-bold text-text tracking-tight">
            Discussion
          </h2>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            Replies from active IRM members.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadInitialReplies(true)}
          disabled={loading || loadMoreLoading || submitting}
          className="ui-button ui-button--secondary"
          aria-label="Refresh discussion"
        >
          Refresh discussion
        </button>
      </div>

      {removalNotice && <FeedbackMessage type="info" message={removalNotice} />}
      {loading ? (
        <div className="py-8 text-center text-text-muted text-sm" role="status">
          Loading discussion...
        </div>
      ) : error ? (
        <div className="my-4">
          <FeedbackMessage
            type="error"
            message={error}
            onRetry={() => loadInitialReplies()}
            retryLabel="Retry loading replies"
          />
        </div>
      ) : (
        <div className="space-y-4">
          {items.length === 0 && unmergedPostedReplies.length === 0 ? (
            <p className="py-8 text-center text-text-muted text-sm italic">
              No replies yet. Be the first to start the discussion.
            </p>
          ) : (
            <ul role="list" className="space-y-3">
              {items.map((reply) => (
                <li key={reply.id}>
                  <article className={styles.replyCard}>
                    <div className={styles.replyHeader}>
                      <span className="font-semibold text-text break-words break-all">
                        @{reply.author_username}
                      </span>
                      <div className={styles.replyMeta}><time dateTime={reply.created_at}>
                        {formatReplyDate(reply.created_at)}
                      </time>
                      <AnnouncementModerationAction kind="announcement reply" id={reply.id} parentId={announcementId}
                        context={`Reply by @${reply.author_username}`} onRemoved={unavailable => removeReply(reply.id, unavailable)} onCheck={() => loadInitialReplies(true)} /></div>
                    </div>
                    <div className="text-sm text-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {reply.content}
                    </div>
                  </article>
                </li>
              ))}

              {/* Newly posted replies (if earlier pages remain unloaded) */}
              {unmergedPostedReplies.map((reply) => (
                <li key={reply.id}>
                  <article className={styles.replyCard}>
                    <div className={styles.replyHeader}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-text break-words break-all">
                          @{reply.author_username}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-medium">
                          Your new reply
                        </span>
                      </div>
                      <div className={styles.replyMeta}><time dateTime={reply.created_at}>
                        {formatReplyDate(reply.created_at)}
                      </time>
                      <AnnouncementModerationAction kind="announcement reply" id={reply.id} parentId={announcementId}
                        context={`Reply by @${reply.author_username}`} onRemoved={unavailable => removeReply(reply.id, unavailable)} onCheck={() => loadInitialReplies(true)} /></div>
                    </div>
                    <div className="text-sm text-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {reply.content}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}

          {/* Load more button */}
          {nextCursor && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadMoreLoading || submitting}
                className="ui-button ui-button--secondary"
              >
                <PendingLabel pending={!!(loadMoreLoading)} idle="Load more replies" busy="Loading more replies..." />
              </button>
            </div>
          )}

          {/* Load more error */}
          {loadMoreError && (
            <div className="pt-2">
              <FeedbackMessage
                type="error"
                message={loadMoreError}
                onRetry={isCursorInvalid ? () => loadInitialReplies(true) : handleLoadMore}
                retryLabel={isCursorInvalid ? "Reload Replies" : "Retry Loading"}
              />
            </div>
          )}
        </div>
      )}

      {/* Composer Section */}
      {!isAccessDenied && (
        <form onSubmit={handleSubmit} className="mt-8 pt-6 border-t border-border">
          <div className="mb-2">
            <label htmlFor="reply-content" className="block text-sm font-semibold text-text mb-1">
              Leave a reply
            </label>
            <p id="reply-help-text" className="text-xs text-text-muted">
              Replies appear immediately and are visible to all ACTIVE IRM members.
            </p>
          </div>

          {submitSuccess && (
            <div className="mb-3">
              <FeedbackMessage
                type="success"
                message={submitSuccess}
              />
            </div>
          )}

          {submitError && (
            <div className="mb-3">
              <FeedbackMessage
                type="error"
                message={submitError}
                onRetry={isAmbiguousNetworkError ? handleCheckDiscussion : undefined}
                retryLabel={isAmbiguousNetworkError ? "Check Discussion" : undefined}
              />
            </div>
          )}

          <div className="relative">
            <textarea
              id="reply-content"
              rows={4}
              value={draft}
              disabled={submitting}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write your reply in plain text..."
              className="w-full px-3.5 py-2.5 text-sm text-text bg-surface border border-border rounded-control shadow-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:bg-disabled-surface disabled:text-disabled-text resize-y min-h-[100px]"
              aria-describedby="reply-char-count reply-help-text"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
            <div
              id="reply-char-count"
              className={`text-xs ${isOverLimit ? "text-error font-semibold" : "text-text-muted"}`}
            >
              {codePointCount} / 2,000 characters
              {isOverLimit && ` (${codePointCount - 2000} over limit)`}
            </div>

            <button
              type="submit"
              disabled={submitting || isEmpty || isOverLimit || loading}
              className="ui-button ui-button--primary"
            >
              {submitting ? "Posting Reply..." : "Post Reply"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
