"use client";

import { PendingLabel } from "@/components/ui/Button";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchApi, ApiError, API_URL } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ModerationAction from "@/components/moderation/ModerationAction";
import { useAsyncScope } from "@/lib/useAsyncScope";
import { RemovalLedger } from "@/lib/moderation";
import FeedbackMessage from "@/components/FeedbackMessage";
import { CommunityPostReply, CommunityPostReplyListResponse } from "@/types/posts";
import CommunityPostReplyImage from "@/components/CommunityPostReplyImage";
import { createPostReplyRequestId, isValidPostReplyResponse, MAX_POST_REPLY_IMAGE_BYTES } from "@/lib/postReplyImages";

interface CommunityPostRepliesProps {
  postId: string;
  communitySlug?: string;
}

function countCodePoints(str: string): number {
  return Array.from(str).length;
}

interface ReplyAttempt {
  requestId: string;
  content: string;
  image: File | null;
  status: "uncertain" | "conflict";
}

function formatReplyDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function CommunityPostReplies({
  postId,
  communitySlug = "irm",
}: CommunityPostRepliesProps) {
  const { user, membership, membershipError, error: authError, refresh } = useAuth();

  // Canonical replies from server
  const [items, setItems] = useState<CommunityPostReply[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination loading/error states
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [isCursorInvalid, setIsCursorInvalid] = useState(false);

  // New replies posted by current session before canonical pages reach them
  const [newlyPostedReplies, setNewlyPostedReplies] = useState<CommunityPostReply[]>([]);
  const [isAccessDenied, setIsAccessDenied] = useState(false);

  // Composer state
  const [draft, setDraft] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uncertainAttempt, setUncertainAttempt] = useState<ReplyAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const operationLockRef = useRef(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const readRequestIdRef = useRef<number>(0);
  const currentPostRef = useRef<string>(postId);
  const hasRefreshedAuthRef = useRef<boolean>(false);
  const isMountedRef = useRef(true);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const clearSelectedImage = useCallback(() => {
    setSelectedImage(null);
    setPreviewUrl(null);
  }, []);

  const handleMediaAccessLoss = useCallback(() => {
    setIsAccessDenied(true);
    setItems([]);
    setNewlyPostedReplies([]);
    setNextCursor(null);
    setDraft("");
    clearSelectedImage();
    setUncertainAttempt(null);
    setSubmitError("Your access to this discussion could not be verified.");
    if (!hasRefreshedAuthRef.current) {
      hasRefreshedAuthRef.current = true;
      refresh();
    }
  }, [clearSelectedImage, refresh]);

  useEffect(() => {
    isMountedRef.current = true;
    currentUserIdRef.current = user?.id || null;
    return () => {
      isMountedRef.current = false;
    };
  }, [user?.id]);

  useEffect(() => {
    currentPostRef.current = postId;
  }, [postId]);

  const [removed] = useState(() => new RemovalLedger());
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const removeReply = (id: string, unavailable: boolean) => {
    removed.remove(id);
    setItems(prev => prev.filter(reply => reply.id !== id));
    setNewlyPostedReplies(prev => prev.filter(reply => reply.id !== id));
    setRemovalNotice(unavailable ? "The reply is unavailable and has been removed from this view." : "Reply removed from community view.");
  };

  const isEligible = !!user && !membershipError && !authError && membership?.status === "ACTIVE";

  const captureScope = useAsyncScope(`${user?.id}:${communitySlug}:${postId}:${isEligible}`);
  const protectedScopeKey = `${user?.id ?? "guest"}:${communitySlug}:${postId}:${isEligible}`;
  const previousProtectedScopeRef = useRef(protectedScopeKey);

  // A different active account can replace the current account without an
  // intermediate ineligible render. Drop account-scoped reply material then;
  // useAsyncScope separately makes old request completions inert.
  useEffect(() => {
    if (previousProtectedScopeRef.current === protectedScopeKey) return;
    previousProtectedScopeRef.current = protectedScopeKey;
    abortControllerRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    setItems([]);
    setNewlyPostedReplies([]);
    setNextCursor(null);
    setDraft("");
    clearSelectedImage();
    setUncertainAttempt(null);
    setSubmitError(null);
    setSubmitSuccess(null);
    setIsAccessDenied(false);
    setError(null);
    setLoadMoreError(null);
  }, [protectedScopeKey, clearSelectedImage]);

  // Initial load or full refresh
  const loadInitialReplies = useCallback(
    async (isManualRefresh = false) => {
      const isCurrent = captureScope();
      if (!isEligible || !postId) {
        setDraft(""); setSubmitError(null); setSubmitSuccess(null);
        setItems([]);
        setNewlyPostedReplies([]);
        setNextCursor(null);
        setLoading(false);
        setLoadMoreLoading(false);
        setLoadMoreError(null);
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const currentRequestId = ++readRequestIdRef.current;

      if (!isManualRefresh) {
        setLoading(true);
      }
      setError(null);
      setLoadMoreError(null);
      setLoadMoreLoading(false);
      setIsCursorInvalid(false);

      try {
        const res = await fetchApi<CommunityPostReplyListResponse>(
          `/api/v1/communities/${communitySlug}/posts/${postId}/replies?limit=20`,
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
            setDraft("");
            clearSelectedImage();
            setUncertainAttempt(null);
            setError("You do not have permission to view replies in this community.");
            if (!hasRefreshedAuthRef.current) {
              hasRefreshedAuthRef.current = true;
              refresh();
            }
          } else if (err.status === 404) {
          setItems([]);
          setNewlyPostedReplies([]);
          setNextCursor(null);
          setDraft("");
          clearSelectedImage();
          setUncertainAttempt(null);
          setIsAccessDenied(true);
            setError("The post could not be found.");
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
    [communitySlug, isEligible, postId, refresh, removed, captureScope, clearSelectedImage]
  );

  // Load more pagination
  const handleLoadMore = async () => {
    const isCurrent = captureScope();
    if (!nextCursor || loadMoreLoading || !isEligible || !postId) return;

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
      const res = await fetchApi<CommunityPostReplyListResponse>(
        `/api/v1/communities/${communitySlug}/posts/${postId}/replies?limit=20&after=${encodeURIComponent(
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
      // Remove any newlyPostedReplies that are now included in canonical items
      if (!isCurrent()) return;
      if (res.items.length > 0) {
        const returnedIds = new Set(res.items.map((r) => r.id));
        setNewlyPostedReplies((prev) => prev.filter((r) => !returnedIds.has(r.id)));
      }
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") return;

      if (err instanceof ApiError) {
        if (err.status === 400) {
          setIsCursorInvalid(true);
          setLoadMoreError(
            "The reply discussion has updated since this page was loaded. Please reload the discussion."
          );
          return;
        }
        if (err.status === 401 || err.status === 403) {
          setIsAccessDenied(true);
          setItems([]);
          setNewlyPostedReplies([]);
          setNextCursor(null);
          setDraft("");
          clearSelectedImage();
          setUncertainAttempt(null);
          setError("You do not have permission to view replies in this community.");
          if (!hasRefreshedAuthRef.current) {
            hasRefreshedAuthRef.current = true;
            refresh();
          }
          return;
        }
        if (err.status === 404) {
          setItems([]);
          setNewlyPostedReplies([]);
          setNextCursor(null);
          setDraft("");
          clearSelectedImage();
          setUncertainAttempt(null);
          setIsAccessDenied(true);
          setLoadMoreError("The post could not be found.");
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
      if (!isEligible || !postId) return;

      const controller = new AbortController();
      const currentRequestId = ++readRequestIdRef.current;

      try {
        const url = lastItemId
          ? `/api/v1/communities/${communitySlug}/posts/${postId}/replies?limit=20&after=${encodeURIComponent(
              lastItemId
            )}`
          : `/api/v1/communities/${communitySlug}/posts/${postId}/replies?limit=20`;

        const res = await fetchApi<CommunityPostReplyListResponse>(url, {
          signal: controller.signal,
        });

        if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;
        if (!isCurrent() || currentPostRef.current !== postId) return;

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
    [postId, communitySlug, isEligible, removed, captureScope]
  );

  const submitAttempt = async (attempt: Omit<ReplyAttempt, "status">) => {
    if (operationLockRef.current || !isEligible || isAccessDenied) return;
    operationLockRef.current = true;
    const isCurrent = captureScope();
    const submittedUserId = user?.id;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    const currentAttempt: ReplyAttempt = { ...attempt, status: "uncertain" };
    const form = new FormData();
    form.append("client_request_id", attempt.requestId);
    if (attempt.content) form.append("content", attempt.content);
    if (attempt.image) form.append("image", attempt.image, attempt.image.name);

    try {
      const response = await fetch(
        `${API_URL.replace(/\/+$/, "")}/api/v1/communities/${encodeURIComponent(communitySlug)}/posts/${encodeURIComponent(postId)}/replies`,
        { method: "POST", body: form, credentials: "include", headers: { Accept: "application/json" } }
      );
      if (!isCurrent() || !isMountedRef.current || currentUserIdRef.current !== submittedUserId || currentPostRef.current !== postId) return;

      if (response.status === 409) {
        setUncertainAttempt({ ...currentAttempt, status: "conflict" });
        setSubmitError("This reply request conflicts with an earlier submission. It was not resent with a new request ID.");
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setIsAccessDenied(true);
        setItems([]);
        setNewlyPostedReplies([]);
        setNextCursor(null);
        setDraft("");
        clearSelectedImage();
        setUncertainAttempt(null);
        setSubmitError(response.status === 401 ? "Your session has expired. Please log in again." : "You do not have permission to reply to posts in this community.");
        if (!hasRefreshedAuthRef.current) {
          hasRefreshedAuthRef.current = true;
          refresh();
        }
        return;
      }
      if (response.status >= 500 || response.status === 503) {
        setUncertainAttempt(currentAttempt);
        setSubmitError("The server could not confirm this reply. Retry the retained reply to safely check the same request.");
        return;
      }
      if (!response.ok) {
        if (response.status === 404) {
          setItems([]);
          setNewlyPostedReplies([]);
          setNextCursor(null);
          setDraft("");
          clearSelectedImage();
          setUncertainAttempt(null);
          setIsAccessDenied(true);
          setSubmitError("The post could not be found or may have been removed.");
          return;
        }
        setSubmitError(
          response.status === 413 || response.status === 415 || response.status === 422
            ? "The reply could not be accepted. Check the text and JPEG/PNG image limit, then try again."
            : "Your reply could not be posted. Please review it and try again.");
        return;
      }
      if (response.status !== 200 && response.status !== 201) {
        setUncertainAttempt(currentAttempt);
        setSubmitError("The reply response could not be confirmed. Retry the retained reply to safely check the same request.");
        return;
      }

      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      if (!isValidPostReplyResponse(body, communitySlug, postId, attempt.content, !!attempt.image)) {
        setUncertainAttempt(currentAttempt);
        setSubmitError("The reply response could not be validated. Retry the retained reply to safely check the same request.");
        return;
      }

      setDraft("");
      clearSelectedImage();
      setUncertainAttempt(null);
      setSubmitSuccess(response.status === 200 ? "Your reply was confirmed." : "Your reply was posted.");
      setNewlyPostedReplies((prev) =>
        prev.some((reply) => reply.id === body.id) ? prev : removed.filter([...prev, body])
      );
      if (nextCursor === null) {
        const lastItemId = items.length > 0 ? items[items.length - 1].id : undefined;
        reconcileNewReplies(lastItemId);
      }
    } catch {
      if (!isCurrent() || !isMountedRef.current || currentUserIdRef.current !== submittedUserId || currentPostRef.current !== postId) return;
      setUncertainAttempt(currentAttempt);
      setSubmitError("The connection ended before the reply was confirmed. Retry the retained reply with the same request.");
    } finally {
      if (isCurrent() && isMountedRef.current && currentUserIdRef.current === submittedUserId && currentPostRef.current === postId) {
        operationLockRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    const count = countCodePoints(trimmed);
    if ((!trimmed && !selectedImage) || count > 2000 || submitting || uncertainAttempt || !isEligible || isAccessDenied) return;
    void submitAttempt({ requestId: createPostReplyRequestId(), content: trimmed, image: selectedImage });
  };

  const handleRetryAttempt = () => {
    if (!uncertainAttempt || uncertainAttempt.status !== "uncertain") return;
    void submitAttempt({ requestId: uncertainAttempt.requestId, content: uncertainAttempt.content, image: uncertainAttempt.image });
  };

  useEffect(() => {
    if (isEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadInitialReplies();
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
      setItems([]);
      setNewlyPostedReplies([]);
      setNextCursor(null);
      setLoading(false);
      setLoadMoreLoading(false);
      setLoadMoreError(null);
      setDraft("");
      clearSelectedImage();
      setUncertainAttempt(null);
      setSubmitSuccess(null);
      setSubmitError(null);
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
    };
  }, [isEligible, loadInitialReplies, clearSelectedImage]);

  useEffect(() => {
    const requestCounter = readRequestIdRef;
    return () => { removed.clear(); requestCounter.current++; };
  }, [user?.id, communitySlug, postId, isEligible, removed]);

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
  const isEmpty = codePointCount === 0 && !selectedImage;
  const composerLocked = submitting || !!uncertainAttempt;

  return (
    <section className="mt-8 pt-8 border-t border-border" aria-labelledby="discussion-heading">
      {isAccessDenied && submitError && (
        <div className="mb-4">
          <FeedbackMessage type="error" message={submitError} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 id="discussion-heading" className="text-xl sm:text-2xl font-bold text-text tracking-tight">
            Discussion
          </h2>
          <p className="text-xs sm:text-sm text-text-muted mt-1">
            Community discussion visible to ACTIVE IRM members.
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
              No replies yet. Be the first to join the discussion.
            </p>
          ) : (
            <ul role="list" className="space-y-3">
              {items.map((reply) => (
                <li key={reply.id}>
                  <article className="p-4 bg-surface-secondary border border-border rounded-control space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                      <span className="font-semibold text-text break-words break-all">
                        @{reply.author_username}
                      </span>
                      <time dateTime={reply.created_at}>
                        {formatReplyDate(reply.created_at)}
                      </time>
                    </div>
                    <div className="text-sm text-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {reply.content}
                    </div>
                    <CommunityPostReplyImage imageUrl={reply.image_url} communitySlug={communitySlug} postId={postId}
                      replyId={reply.id} accountId={user?.id ?? ""} authorUsername={reply.author_username}
                      onAccessLost={handleMediaAccessLoss} />
                    <div className="flex justify-end"><ModerationAction kind="post reply" id={reply.id} parentId={postId} communitySlug={communitySlug}
                      context={`Reply by @${reply.author_username}`} onRemoved={unavailable => removeReply(reply.id, unavailable)} onCheck={() => loadInitialReplies(true)} /></div>
                  </article>
                </li>
              ))}

              {/* Newly posted replies (if earlier pages remain unloaded) */}
              {unmergedPostedReplies.map((reply) => (
                <li key={reply.id}>
                  <article className="p-4 bg-surface-secondary border border-border rounded-control space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-text break-words break-all">
                          @{reply.author_username}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-medium">
                          Your new reply
                        </span>
                      </div>
                      <time dateTime={reply.created_at}>
                        {formatReplyDate(reply.created_at)}
                      </time>
                    </div>
                    <div className="text-sm text-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {reply.content}
                    </div>
                    <CommunityPostReplyImage imageUrl={reply.image_url} communitySlug={communitySlug} postId={postId}
                      replyId={reply.id} accountId={user?.id ?? ""} authorUsername={reply.author_username}
                      onAccessLost={handleMediaAccessLoss} />
                    <div className="flex justify-end"><ModerationAction kind="post reply" id={reply.id} parentId={postId} communitySlug={communitySlug}
                      context={`Reply by @${reply.author_username}`} onRemoved={unavailable => removeReply(reply.id, unavailable)} onCheck={() => loadInitialReplies(true)} /></div>
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
            <label htmlFor="post-reply-content" className="block text-sm font-semibold text-text mb-1">
              Leave a reply
            </label>
            <p id="post-reply-help-text" className="text-xs text-text-muted">
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
                onRetry={uncertainAttempt?.status === "uncertain" ? handleRetryAttempt : undefined}
                retryLabel={uncertainAttempt?.status === "uncertain" ? "Retry same reply" : undefined}
              />
              {uncertainAttempt?.status === "conflict" && (
                <button type="button" className="ui-button ui-button--secondary mt-2"
                  onClick={() => { setUncertainAttempt(null); setSubmitError(null); }}>
                  Start a new reply
                </button>
              )}
            </div>
          )}

          <div className="relative">
            <textarea
              id="post-reply-content"
              rows={4}
              value={draft}
              disabled={composerLocked}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write your reply in plain text..."
              className="w-full px-3.5 py-2.5 text-sm text-text bg-surface border border-border rounded-control shadow-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:bg-disabled-surface disabled:text-disabled-text resize-y min-h-[100px]"
              aria-describedby="post-reply-char-count post-reply-help-text"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="post-reply-image" className="block text-sm font-semibold text-text mb-1">
                Attach one image (optional)
              </label>
              <p id="post-reply-image-help" className="text-xs text-text-muted mb-2">
                JPEG or PNG, up to 5 MiB. Images are uploaded when you post your reply.
              </p>
              <input
                id="post-reply-image"
                type="file"
                accept="image/jpeg,image/png"
                disabled={composerLocked}
                aria-describedby="post-reply-image-help post-reply-image-feedback"
                className="block max-w-full text-sm text-text file:mr-3 file:rounded-control file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium file:text-text"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  if (!file) return;
                  if (file.type !== "image/jpeg" && file.type !== "image/png") {
                    setSubmitError("Choose a JPEG or PNG image.");
                    return;
                  }
                  if (file.size === 0 || file.size > MAX_POST_REPLY_IMAGE_BYTES) {
                    setSubmitError("Choose a nonempty image no larger than 5 MiB.");
                    return;
                  }
                  setSelectedImage(file);
                  setPreviewUrl(URL.createObjectURL(file));
                  setSubmitError(null);
                }}
              />
              <p id="post-reply-image-feedback" className="sr-only" aria-live="polite">
                {selectedImage ? `${selectedImage.name}, image selected.` : "No image selected."}
              </p>
            </div>
            {selectedImage && previewUrl && (
              <div className="w-full min-w-0 sm:w-auto sm:max-w-[18rem] rounded-control border border-border bg-surface p-3">
                <p className="text-xs font-medium text-text mb-2">
                  {uncertainAttempt ? "Retained image for reply retry" : "Unsaved local image preview"}
                </p>
                {/* Local preview only; this image is not uploaded until submission. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt={`Unsaved preview of ${selectedImage.name}`} className="block max-h-56 max-w-full rounded-control object-contain" />
                <p className="mt-2 break-all text-xs text-text-muted">{selectedImage.name} · {(selectedImage.size / 1_048_576).toFixed(2)} MiB</p>
                <button type="button" disabled={composerLocked} className="ui-button ui-button--quiet mt-2"
                  onClick={() => { clearSelectedImage(); setSubmitError(null); }}>
                  Remove image
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
            <div
              id="post-reply-char-count"
              className={`text-xs ${isOverLimit ? "text-error font-semibold" : "text-text-muted"}`}
            >
              {codePointCount} / 2,000 characters
              {isOverLimit && ` (${codePointCount - 2000} over limit)`}
            </div>

            <button
              type="submit"
              disabled={submitting || !!uncertainAttempt || isEmpty || isOverLimit || loading}
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
