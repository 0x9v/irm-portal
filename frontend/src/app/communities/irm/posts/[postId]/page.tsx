"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAsyncScope } from "@/lib/useAsyncScope";
import ModerationAction from "@/components/moderation/ModerationAction";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import CommunityPostReplies from "@/components/CommunityPostReplies";
import { CommunityPostDetail } from "@/types/posts";
import { consumePostCreated } from "@/lib/postCreationFeedback";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

function PostDetailContent() {
  const params = useParams();
  const rawId = params?.postId;
  const postId = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

  const { user, membership, isLoading: authLoading, membershipError, error: authError, refresh } = useAuth();
  const [post, setPost] = useState<CommunityPostDetail | null>(null);
  const [showCreatedSuccess, setShowCreatedSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const isEligible = !authLoading && !!user && !membershipError && !authError && membership?.status === "ACTIVE";

  const captureScope = useAsyncScope(`${user?.id}:${isEligible}:${postId}`);

  const loadPostDetail = useCallback(async () => {
      const isCurrent = captureScope();
    if (!isEligible) {
      setPost(null);
      setLoading(false);
      return;
    }

    if (!postId || !UUID_REGEX.test(postId)) {
      setPost(null);
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

    setPost(null);
    setLoading(true);
    setError(null);
    setIsNotFound(false);

    try {
      const data = await fetchApi<CommunityPostDetail>(
        `/api/v1/communities/irm/posts/${postId}`,
        { signal: controller.signal }
      );
      if (isCurrent() && !controller.signal.aborted && currentRequestId === requestIdRef.current) {
        setPost(data);
        if (consumePostCreated(data.id)) {
          setShowCreatedSuccess(true);
        }
      }
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted || currentRequestId !== requestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") return;

      setShowCreatedSuccess(false);
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) void refresh();
        if (err.status === 404) {
          setIsNotFound(true);
        } else if (err.status === 401 || err.status === 403) {
          setError("You do not have permission to view this post.");
        } else {
          setError("Post could not be loaded. Please try again.");
        }
      } else if (err instanceof Error) {
        setError("Post could not be loaded. Please try again.");
      } else {
        setError("An unexpected error occurred.");
      }
    } finally {
      if (isCurrent() && !controller.signal.aborted && currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [isEligible, postId, captureScope, refresh]);

  useEffect(() => {
    if (isEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadPostDetail();
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setPost(null);
      setShowCreatedSuccess(false);
      setLoading(false);
      setError(null);
      setIsNotFound(false);
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isEligible, loadPostDetail]);

  const isGuest = !user && !authLoading;
  const isNonActive = !authLoading && !!user && !membershipError && !authError && membership?.status !== "ACTIVE";

  const breadcrumbTitle = post ? post.title : isNotFound ? "Post Not Found" : "Post Details";

  return (
    <PageContainer width="wide">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Posts", href: "/communities/irm/posts" },
          { label: breadcrumbTitle },
        ]}
      />

      {showCreatedSuccess && (
        <div className="my-4">
          <FeedbackMessage
            type="success"
            message="Your post has been published successfully."
          />
        </div>
      )}

      {authLoading ? (
        <div className="py-12 text-center text-text-muted text-sm">Loading...</div>
      ) : isGuest ? (
        <AccessDeniedGuidance isGuest={true} returnHref="/communities/irm/posts" returnLabel="Posts" />
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
          returnHref="/communities/irm/posts"
          returnLabel="Posts"
        />
      ) : loading ? (
        <div className="py-12 text-center text-text-muted text-sm" role="status">
          Loading post...
        </div>
      ) : isNotFound ? (
        <div className="p-8 text-center bg-surface border border-border rounded-surface shadow-none space-y-4">
          <h2 className="text-xl font-bold text-text">Post Unavailable</h2>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            This post could not be found or may have been removed.
          </p>
          <div>
            <Link
              href="/communities/irm/posts"
              className="ui-button ui-button--primary"
            >
              &larr; Return to Posts
            </Link>
          </div>
        </div>
      ) : error ? (
        <div className="my-4">
          <FeedbackMessage
            type="error"
            message={error}
            onRetry={loadPostDetail}
            retryLabel="Retry Loading"
          />
        </div>
      ) : post ? (
        <div className="space-y-6">
          {/* Post Header & Content Card */}
          <article className="p-6 sm:p-8 bg-surface border border-border rounded-surface shadow-none space-y-4">
            <div>
              <p className="ui-eyebrow">IRM / Community</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight break-words">
                {post.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs sm:text-sm text-text-muted">
                <span className="font-semibold text-text">@{post.author_username}</span>
                <span aria-hidden="true">&bull;</span>
                <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
              </div>
            </div>

            {/* Module Tags */}
            {post.modules && post.modules.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Tagged modules">
                {post.modules.map((mod) => (
                  <Link
                    key={mod.id}
                    href={`/communities/irm/posts?module_id=${mod.id}`}
                    className="ui-button ui-button--quiet"
                  >
                    {mod.name}
                  </Link>
                ))}
              </div>
            )}

          <div className="flex justify-end"><ModerationAction kind="post" id={post.id} context={post.title} onCheck={loadPostDetail}
            onRemoved={() => { requestIdRef.current++; abortControllerRef.current?.abort(); setPost(null); setIsNotFound(true); setLoading(false); }} /></div>

            {/* Post Full Body (plain text with preserved newlines) */}
            <div className="pt-4 border-t border-border text-text text-sm sm:text-base whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
              {post.content}
            </div>
          </article>

          {/* Discussion & Replies Section */}
          <CommunityPostReplies key={`${post.id}-${user?.id}`} postId={post.id} />
        </div>
      ) : null}
    </PageContainer>
  );
}

export default function PostDetailPage() {
  return (
    <Suspense
      fallback={
        <PageContainer width="wide">
          <div className="py-12 text-center text-text-muted text-sm">Loading post...</div>
        </PageContainer>
      }
    >
      <PostDetailContent />
    </Suspense>
  );
}
