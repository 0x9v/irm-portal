"use client";

import { PendingLabel } from "@/components/ui/Button";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useAsyncScope } from "@/lib/useAsyncScope";
import ModerationAction from "@/components/moderation/ModerationAction";
import { RemovalLedger } from "@/lib/moderation";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import { ContentEmpty } from "@/components/ContentState";
import CommunityPostCard from "@/components/CommunityPostCard";
import { CommunityPostFeedItem, CommunityPostFeedResponse } from "@/types/posts";

interface ModuleOption {
  id: string;
  name: string;
  slug: string;
}

function PostsFeedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeModuleId = searchParams.get("module_id") || "";

  const { user, membership, isLoading: authLoading, membershipError, error: authError, refresh } = useAuth();

  const [posts, setPosts] = useState<CommunityPostFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination states
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Module filter options state
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [modulesError, setModulesError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const readRequestIdRef = useRef<number>(0);

  const [removed] = useState(() => new RemovalLedger());
  const [removalNotice, setRemovalNotice] = useState<string | null>(null);
  const reconcileRemoval = (id: string, unavailable: boolean) => {
    removed.remove(id);
    setPosts(prev => prev.filter(item => item.id !== id));
    setRemovalNotice(unavailable ? "The post is unavailable and has been removed from this view." : "post removed from community view.");
  };

  const isEligible = !authLoading && !!user && !membershipError && !authError && membership?.status === "ACTIVE";

  const captureScope = useAsyncScope(`${user?.id}:${isEligible}:${activeModuleId}`);

  // Load available modules for filter
  const loadModules = useCallback(async () => {
    const isCurrent = captureScope();
    if (!isEligible) return;

    setModulesLoading(true);
    setModulesError(null);
    try {
      const data = await fetchApi<ModuleOption[]>("/api/v1/communities/irm/modules");
      if (!isCurrent()) return;
      setModules(data);
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) void refresh();
        setModulesError("Module filters could not be loaded.");
      } else {
        setModulesError("Module filters could not be loaded.");
      }
    } finally {
      if (isCurrent()) setModulesLoading(false);
    }
  }, [isEligible, captureScope, refresh]);

  // Load initial posts or refreshed feed
  const loadPosts = useCallback(
    async (isManualRefresh = false) => {
      const isCurrent = captureScope();
      if (!isEligible) {
        setPosts([]);
        setNextCursor(null);
        setLoading(false);
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
        setPosts([]);
        setNextCursor(null);
      }
      setError(null);
      setLoadMoreError(null);
      setLoadMoreLoading(false);

      const url = activeModuleId
        ? `/api/v1/communities/irm/posts?limit=20&module_id=${encodeURIComponent(activeModuleId)}`
        : `/api/v1/communities/irm/posts?limit=20`;

      try {
        const data = await fetchApi<CommunityPostFeedResponse>(url, {
          signal: controller.signal,
        });

        if (isCurrent() && !controller.signal.aborted && currentRequestId === readRequestIdRef.current) {
          setPosts(removed.filter(data.items));
          setNextCursor(data.next_cursor);
        }
      } catch (err) {
        if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;

        if (err instanceof ApiError) {
          if (err.status === 401 || err.status === 403) void refresh();
          if (err.status === 401) {
            setError("Unauthorized. Please log in.");
          } else if (err.status === 403) {
            setError("Forbidden. You must be an active member to view community posts.");
          } else if (err.status === 404) {
            setError("Selected module or community was not found.");
          } else if (err.status === 422) {
            setError("Invalid module filter ID.");
          } else {
            setError("Posts could not be loaded. Please try again.");
          }
        } else {
          setError("Posts could not be loaded. Please try again.");
        }
      } finally {
        if (isCurrent() && !controller.signal.aborted && currentRequestId === readRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [activeModuleId, isEligible, removed, captureScope, refresh]
  );

  // Load more posts (cursor pagination)
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

    const baseUrl = activeModuleId
      ? `/api/v1/communities/irm/posts?limit=20&module_id=${encodeURIComponent(
          activeModuleId
        )}&after=${encodeURIComponent(nextCursor)}`
      : `/api/v1/communities/irm/posts?limit=20&after=${encodeURIComponent(nextCursor)}`;

    try {
      const data = await fetchApi<CommunityPostFeedResponse>(baseUrl, {
        signal: controller.signal,
      });

      if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;

      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newItems = removed.filter(data.items).filter((p) => !existingIds.has(p.id));
        return [...prev, ...newItems];
      });
      setNextCursor(data.next_cursor);
    } catch (err) {
      if (!isCurrent() || controller.signal.aborted || currentRequestId !== readRequestIdRef.current) return;
      if (err instanceof Error && err.name === "AbortError") return;

      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) void refresh();
        setLoadMoreError("More posts could not be loaded. Please try again.");
      } else {
        setLoadMoreError("More posts could not be loaded. Please try again.");
      }
    } finally {
      if (isCurrent() && !controller.signal.aborted && currentRequestId === readRequestIdRef.current) {
        setLoadMoreLoading(false);
      }
    }
  };

  // Change filter handler
  const handleFilterChange = (moduleId: string) => {
    if (moduleId === activeModuleId) return;

    if (moduleId) {
      router.push(`/communities/irm/posts?module_id=${encodeURIComponent(moduleId)}`);
    } else {
      router.push("/communities/irm/posts");
    }
  };

  useEffect(() => {
    if (isEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadModules();
      loadPosts();
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
      setPosts([]);
      setModules([]); setModulesError(null);
      setNextCursor(null);
      setLoading(false);
      setLoadMoreLoading(false);
      setLoadMoreError(null);
      setError(null);
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (loadMoreAbortRef.current) {
        loadMoreAbortRef.current.abort();
      }
    };
  }, [isEligible, loadModules, loadPosts]);

  useEffect(() => {
    const requestCounter = readRequestIdRef;
    return () => { removed.clear(); requestCounter.current++; };
  }, [user?.id, isEligible, removed]);

  const isGuest = !user && !authLoading;
  const isNonActive = !authLoading && !!user && !membershipError && !authError && membership?.status !== "ACTIVE";

  const activeModuleObj = modules.find((m) => m.id === activeModuleId);

  return (
    <PageContainer width="wide">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Posts" },
        ]}
      />

      {removalNotice && <FeedbackMessage type="info" message={removalNotice} />}
      {/* Page Header */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <p className="ui-eyebrow">IRM / Community</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">
            Community Posts
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Questions, discussions, and text resources for IRM members.
          </p>
        </div>

        {isEligible && (
          <div className="flex items-center gap-3">
            <Link
              href="/communities/irm/posts/new"
              className="ui-button ui-button--primary"
            >
              New Post
            </Link>
          </div>
        )}
      </div>

      {/* Access Control & Loading Screens */}
      {authLoading ? (
        <div className="py-12 text-center text-text-muted text-sm" role="status">
          Loading posts...
        </div>
      ) : isGuest ? (
        <AccessDeniedGuidance isGuest={true} returnHref="/" returnLabel="Home" />
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
          returnHref="/"
          returnLabel="Home"
        />
      ) : (
        <div className="space-y-6">
          {/* Module Filtering Controls */}
          <div className="p-4 bg-surface border border-border rounded-surface shadow-none space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="module-filter-select" className="text-xs font-semibold text-text uppercase tracking-wider">
                Filter by Module:
              </label>

              <button
                type="button"
                onClick={() => loadPosts(true)}
                disabled={loading || loadMoreLoading}
                className="ui-button ui-button--secondary"
              >
                Refresh Feed
              </button>
            </div>

            {modulesError && (
              <FeedbackMessage
                type="error"
                message={`${modulesError} You can still browse unfiltered posts.`}
                onRetry={loadModules}
                retryLabel="Retry Modules"
              />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleFilterChange("")}
                className="ui-button ui-button--secondary" aria-pressed={!activeModuleId}
              >
                All Modules
              </button>

              {modules.map((m) => {
                const isSelected = m.id === activeModuleId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleFilterChange(m.id)}
                    className="ui-button ui-button--secondary" aria-pressed={isSelected}
                  >
                    {m.name}
                  </button>
                );
              })}

              {modulesLoading && (
                <span className="text-xs text-text-subtle italic">Loading modules...</span>
              )}
            </div>
          </div>

          {/* Feed Content */}
          {loading ? (
            <div className="py-12 text-center text-text-muted text-sm" role="status">
              Loading posts feed...
            </div>
          ) : error && posts.length === 0 ? (
            <div className="my-4">
              <FeedbackMessage
                type="error"
                message={error}
                onRetry={() => loadPosts()}
                retryLabel="Retry Loading Posts"
              />
            </div>
          ) : posts.length === 0 ? (
            activeModuleId ? <ContentEmpty title={`No posts found for ${activeModuleObj ? activeModuleObj.name : "the selected module"}.`}
              description="Try all modules or start a post for this topic."
              action={<button type="button" onClick={() => handleFilterChange("")} className="ui-button ui-button--quiet">Show All Modules</button>} />
              : <ContentEmpty title="No posts yet." description="Be the first to start a conversation in IRM."
                action={<Link href="/communities/irm/posts/new" className="ui-button ui-button--secondary">Create First Post</Link>} />
          ) : (
            <div className="space-y-4">
              {error && <FeedbackMessage type="error" message={error} onRetry={() => loadPosts(true)} retryLabel="Refresh feed" />}
              <div className="space-y-3">
                {posts.map((post) => (
                  <div key={post.id}>
                  <CommunityPostCard
                    key={post.id}
                    post={post}
                    onSelectModule={handleFilterChange}
                  />
                  <div className="flex justify-end"><ModerationAction kind="post" id={post.id} scopeKey={activeModuleId} context={post.title} onRemoved={unavailable => reconcileRemoval(post.id, unavailable)} onCheck={() => loadPosts(true)} /></div>
                  </div>
                ))}
              </div>

              {/* Load More Button */}
              {nextCursor && (
                <div className="pt-4 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadMoreLoading}
                    className="ui-button ui-button--secondary"
                  >
                    <PendingLabel pending={!!(loadMoreLoading)} idle="Load more posts" busy="Loading more posts..." />
                  </button>
                </div>
              )}

              {/* Load More Error */}
              {loadMoreError && (
                <div className="pt-2">
                  <FeedbackMessage
                    type="error"
                    message={loadMoreError}
                    onRetry={handleLoadMore}
                    retryLabel="Retry Loading"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}

export default function PostsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer width="wide">
          <div className="py-12 text-center text-text-muted text-sm">Loading posts...</div>
        </PageContainer>
      }
    >
      <PostsFeedContent />
    </Suspense>
  );
}
