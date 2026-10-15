"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchApi, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import { CommunityPostDetail } from "@/types/posts";
import { markPostCreated } from "@/lib/postCreationFeedback";

interface ModuleOption {
  id: string;
  name: string;
  slug: string;
}

function countCodePoints(str: string): number {
  return Array.from(str).length;
}

export default function NewPostPage() {
  const router = useRouter();
  const { user, membership, isLoading: authLoading, membershipError, refresh } = useAuth();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);

  // Modules loading state
  const [availableModules, setAvailableModules] = useState<ModuleOption[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [modulesError, setModulesError] = useState<string | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isAmbiguousError, setIsAmbiguousError] = useState(false);

  const isMountedRef = useRef(true);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    currentUserIdRef.current = user?.id || null;
    return () => {
      isMountedRef.current = false;
    };
  }, [user?.id]);

  const isEligible = !authLoading && !!user && !membershipError && membership?.status === "ACTIVE";

  // When access is lost or user logs out, clear private drafts
  useEffect(() => {
    if (!isEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle("");
      setContent("");
      setSelectedModuleIds([]);
      setSubmitError(null);
      setIsAmbiguousError(false);
      setSubmitting(false);
    }
  }, [isEligible]);

  const loadModules = useCallback(async () => {
    if (!isEligible) return;

    setModulesLoading(true);
    setModulesError(null);
    try {
      const data = await fetchApi<ModuleOption[]>("/api/v1/communities/irm/modules");
      setAvailableModules(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setModulesError("Modules for tagging could not be loaded.");
      } else if (err instanceof Error) {
        setModulesError("Modules for tagging could not be loaded.");
      } else {
        setModulesError("Could not load modules for tagging.");
      }
    } finally {
      setModulesLoading(false);
    }
  }, [isEligible]);

  useEffect(() => {
    if (isEligible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadModules();
    }
  }, [isEligible, loadModules]);

  const handleToggleModule = (modId: string) => {
    if (submitting) return;

    setSelectedModuleIds((prev) => {
      if (prev.includes(modId)) {
        return prev.filter((id) => id !== modId);
      }
      if (prev.length >= 3) {
        // Enforce maximum 3 tags on client
        return prev;
      }
      return [...prev, modId];
    });
  };

  const trimmedTitle = title.trim();
  const titleCount = countCodePoints(trimmedTitle);
  const isTitleOverLimit = titleCount > 150;
  const isTitleEmpty = titleCount === 0;

  const trimmedContent = content.trim();
  const contentCount = countCodePoints(trimmedContent);
  const isContentOverLimit = contentCount > 10000;
  const isContentEmpty = contentCount === 0;

  const isFormInvalid =
    isTitleEmpty || isTitleOverLimit || isContentEmpty || isContentOverLimit || selectedModuleIds.length > 3;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isFormInvalid || submitting || !isEligible) return;

    setSubmitting(true);
    setSubmitError(null);
    setIsAmbiguousError(false);

    const submittedUserId = user?.id;
    try {
      const newPost = await fetchApi<CommunityPostDetail>("/api/v1/communities/irm/posts", {
        method: "POST",
        body: JSON.stringify({
          title: trimmedTitle,
          content: trimmedContent,
          module_ids: selectedModuleIds,
        }),
      });

      if (!isMountedRef.current || currentUserIdRef.current !== submittedUserId) return;

      // On successful creation, record ephemeral feedback and navigate to the post detail
      markPostCreated(newPost.id);
      router.push(`/communities/irm/posts/${newPost.id}`);
    } catch (err) {
      if (!isMountedRef.current || currentUserIdRef.current !== submittedUserId) return;

      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setSubmitError(
            err.status === 401
              ? "Your session has expired. Please log in again."
              : "You do not have permission to create posts in this community."
          );
          refresh();
        } else if (err.status === 422) {
          setSubmitError("Check the post title, body and module selection, then try again.");
        } else if (err.status >= 500) {
          setIsAmbiguousError(true);
          setSubmitError(
            "The server encountered an error. Your post may or may not have been saved. Please check the Posts feed before trying again."
          );
        } else {
          setIsAmbiguousError(true);
          setSubmitError("We could not confirm whether your post was created. Check the Posts feed before trying again.");
        }
      } else if (err instanceof Error) {
        setIsAmbiguousError(true);
        setSubmitError(
          "Unable to reach the server. Your post may or may not have been saved. Please check the Posts feed before trying again."
        );
      } else {
        setIsAmbiguousError(true);
        setSubmitError("We could not confirm whether your post was created. Check the Posts feed before trying again.");
      }
    } finally {
      if (isMountedRef.current && currentUserIdRef.current === submittedUserId) {
        setSubmitting(false);
      }
    }
  };

  const isGuest = !user && !authLoading;
  const isNonActive = !authLoading && !!user && !membershipError && membership?.status !== "ACTIVE";

  return (
    <PageContainer width="default">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Posts", href: "/communities/irm/posts" },
          { label: "New Post" },
        ]}
      />

      <div className="mb-6">
        <p className="ui-eyebrow">IRM / Community</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">
          Create a Post
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Share a question, explanation, or text resource with active IRM members.
        </p>
      </div>

      {authLoading ? (
        <div className="py-12 text-center text-text-muted text-sm">Loading...</div>
      ) : isGuest ? (
        <AccessDeniedGuidance isGuest={true} returnHref="/communities/irm/posts" returnLabel="Posts" />
      ) : membershipError ? (
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
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6 bg-surface p-6 sm:p-8 border border-border rounded-surface shadow-none">
          {submitError && (
            <div>
              <FeedbackMessage
                type="error"
                message={submitError}
                onRetry={
                  isAmbiguousError
                    ? () => router.push("/communities/irm/posts")
                    : undefined
                }
                retryLabel={isAmbiguousError ? "Check Posts Feed" : undefined}
              />
            </div>
          )}

          {/* Post Title */}
          <div>
            <div className="flex flex-wrap gap-2 justify-between items-center mb-1">
              <label htmlFor="post-title" className="block text-sm font-semibold text-text">
                Title <span className="text-error">*</span>
              </label>
              <span
                className={`text-xs ${isTitleOverLimit ? "text-error font-semibold" : "text-text-muted"}`}
                id="post-title-count"
              >
                {titleCount} / 150 characters
              </span>
            </div>
            <input
              id="post-title"
              type="text"
              required
              disabled={submitting}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. How does Dijkstra handle negative edges?"
              className="w-full px-3.5 py-2.5 text-sm text-text bg-surface border border-border rounded-control shadow-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:bg-disabled-surface disabled:text-disabled-text"
              aria-describedby="post-title-count"
            />
          </div>

          {/* Module Tags Selection */}
          <div>
            <div className="flex flex-wrap gap-2 justify-between items-center mb-1">
              <label className="block text-sm font-semibold text-text">
                Module Tags <span className="text-xs font-normal text-text-muted">(Optional, up to 3)</span>
              </label>
              <span className="text-xs text-text-muted">
                {selectedModuleIds.length} / 3 selected
              </span>
            </div>
            <p className="text-xs text-text-muted mb-2">
              Tagging relevant modules helps classmates find your post in subject filters.
            </p>

            {modulesError && (
              <div className="mb-2">
                <p className="text-xs text-warning bg-warning/10 p-2 rounded border border-warning/20">
                  {modulesError} You can still submit an untagged post.
                </p>
              </div>
            )}

            {modulesLoading ? (
              <p className="text-xs text-text-subtle italic">Loading modules...</p>
            ) : availableModules.length === 0 ? (
              <p className="text-xs text-text-subtle italic">No modules available to tag.</p>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Module options">
                {availableModules.map((m) => {
                  const isChecked = selectedModuleIds.includes(m.id);
                  const isMaxReached = selectedModuleIds.length >= 3 && !isChecked;

                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={submitting || isMaxReached}
                      onClick={() => handleToggleModule(m.id)}
                      aria-pressed={isChecked}
                      className="ui-button ui-button--secondary"
                    >
                      {isChecked ? "✓ " : "+ "}
                      {m.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Post Body */}
          <div>
            <div className="flex flex-wrap gap-2 justify-between items-center mb-1">
              <label htmlFor="post-content" className="block text-sm font-semibold text-text">
                Body <span className="text-error">*</span>
              </label>
              <span
                className={`text-xs ${isContentOverLimit ? "text-error font-semibold" : "text-text-muted"}`}
                id="post-content-count"
              >
                {contentCount} / 10,000 characters
              </span>
            </div>
            <textarea
              id="post-content"
              rows={8}
              required
              disabled={submitting}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Explain your question, concept, or resource in plain text. Internal newlines are preserved."
              className="w-full px-3.5 py-2.5 text-sm text-text bg-surface border border-border rounded-control shadow-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent disabled:bg-disabled-surface disabled:text-disabled-text resize-y min-h-[160px]"
              aria-describedby="post-content-count"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-border">
            <Link
              href="/communities/irm/posts"
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-text hover:text-text bg-surface hover:bg-surface-secondary border border-border rounded-control transition-colors inline-flex items-center"
            >
              Cancel
            </Link>

            <button
              type="submit"
              disabled={submitting || isFormInvalid}
              className="ui-button ui-button--primary"
            >
              {submitting ? "Publishing Post..." : "Publish Post"}
            </button>
          </div>
        </form>
      )}
    </PageContainer>
  );
}
