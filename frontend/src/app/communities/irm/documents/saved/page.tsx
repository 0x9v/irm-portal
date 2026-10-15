"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import PageContainer from "@/components/PageContainer";
import DocumentRow from "@/components/DocumentRow";
import { ContentLoading, ContentEmpty } from "@/components/ContentState";
import { PendingLabel, buttonStyles } from "@/components/ui/Button";
import { fetchApi } from "@/lib/api";
import { documentSourceLabel, documentTypeLabel } from "@/lib/documentPresentation";

type SavedItem = {
  id: string;
  module_id: string;
  module_slug: string;
  module_name: string;
  title: string;
  type: string;
  source: string;
  document_created_at: string;
  saved_at: string;
};
type Feed = { items: SavedItem[]; next_cursor: string | null };
const PAGE_SIZE = 20;

export default function SavedDocumentsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [removingIds, setRemovingIds] = useState<string[]>([]);
  const generation = useRef(0);
  const firstController = useRef<AbortController | null>(null);
  const moreController = useRef<AbortController | null>(null);
  const currentUser = useRef(user?.id);

  useEffect(() => {
    currentUser.current = user?.id;
  }, [user?.id]);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    firstController.current?.abort();
    moreController.current?.abort();
    // Clear private results before requesting the current account's saved list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems([]);
    setNextCursor(null);
    setOwnerId(null);
    setRemoveErrors({});
    setRemovingIds([]);
    setMoreError(null);
    setError(null);
    if (authLoading || !user) {
      setLoading(authLoading);
      setLoadingMore(false);
      return;
    }
    const controller = new AbortController();
    firstController.current = controller;
    setLoading(true);
    fetchApi<Feed>(`/api/v1/communities/irm/documents/saved?limit=${PAGE_SIZE}`, { signal: controller.signal })
      .then((feed) => {
        if (controller.signal.aborted || generation.current !== requestGeneration || currentUser.current !== user.id) return;
        setItems(feed.items);
        setNextCursor(feed.next_cursor);
        setOwnerId(user.id);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || generation.current !== requestGeneration || (cause instanceof Error && cause.name === "AbortError")) return;
        setError("Could not load saved documents. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted && generation.current === requestGeneration) setLoading(false);
      });
    return () => controller.abort();
  }, [authLoading, user, retry]);

  const loadMore = useCallback(async () => {
    if (!user || !nextCursor || loadingMore || ownerId !== user.id) return;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), after: nextCursor });
      const feed = await fetchApi<Feed>(`/api/v1/communities/irm/documents/saved?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || generation.current !== requestGeneration || currentUser.current !== user.id) return;
      setItems((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [...previous, ...feed.items.filter((item) => !existing.has(item.id))];
      });
      setNextCursor(feed.next_cursor);
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== requestGeneration || (cause instanceof Error && cause.name === "AbortError")) return;
      setMoreError("More saved documents could not be loaded. Please try again.");
    } finally {
      if (!controller.signal.aborted && generation.current === requestGeneration) setLoadingMore(false);
    }
  }, [user, nextCursor, loadingMore, ownerId]);

  const remove = async (item: SavedItem) => {
    if (!user || user.id !== ownerId || removingIds.includes(item.id)) return;
    const requestGeneration = generation.current;
    setRemovingIds((previous) => [...previous, item.id]);
    setRemoveErrors((previous) => ({ ...previous, [item.id]: "" }));
    try {
      await fetchApi<{ saved: boolean }>(`/api/v1/communities/irm/documents/${encodeURIComponent(item.id)}/saved`, { method: "DELETE" });
      if (generation.current !== requestGeneration || currentUser.current !== user.id) return;
      setItems((previous) => previous.filter((entry) => entry.id !== item.id));
    } catch {
      if (generation.current !== requestGeneration || currentUser.current !== user.id) return;
      setRemoveErrors((previous) => ({ ...previous, [item.id]: "Removal could not be confirmed. Check the saved list before trying again." }));
    } finally {
      if (generation.current === requestGeneration) setRemovingIds((previous) => previous.filter((id) => id !== item.id));
    }
  };

  const visibleItems = user && ownerId === user.id ? items : [];
  const retryRemove = (item: SavedItem) => void remove(item);

  return (
    <PageContainer width="wide">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Modules", href: "/communities/irm/modules" }, { label: "Saved Documents" }]} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><p className="ui-eyebrow">IRM / Your documents</p>
          <h1 className="ui-page-heading text-text">Saved Documents</h1><p className="ui-helper mt-1">Approved documents saved to your account.</p></div>
        <Link href="/communities/irm/modules" className={buttonStyles("quiet")}>Browse modules</Link>
      </div>
      {authLoading ? (
        <div className="py-12 text-center text-text-muted" role="status">Checking your account…</div>
      ) : !user ? (
        <AccessDeniedGuidance isGuest returnHref="/communities/irm/modules" returnLabel="Modules" />
      ) : loading ? (
        <ContentLoading label="Loading saved documents…" kind="document" count={2} />
      ) : error ? (
        <FeedbackMessage type="error" message={error} onRetry={() => setRetry((value) => value + 1)} retryLabel="Retry" />
      ) : visibleItems.length === 0 ? (
        <ContentEmpty title="You have no saved documents yet." description="Save approved resources from a module to find them here."
          action={<Link href="/communities/irm/modules" className={buttonStyles("secondary")}>Browse modules</Link>} />
      ) : (
        <section aria-label="Your saved documents" className="space-y-4">
          {visibleItems.map((item) => (
            <DocumentRow key={item.id} title={item.title}
              openHref={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}/documents/${encodeURIComponent(item.id)}`}
              context={<>Module: <Link className="ui-link" href={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}`}>{item.module_name}</Link></>}
              metadata={<>
                <span>Type: {documentTypeLabel(item.type)}</span>
                <span>Source: {documentSourceLabel(item.source)}</span>
                <span>Saved: <time dateTime={item.saved_at}>{new Date(item.saved_at).toLocaleDateString()}</time></span>
              </>}
              actions={<>
                <Link href={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}/documents/${encodeURIComponent(item.id)}`} className={buttonStyles("secondary", "min-h-[44px]")}>Open document</Link>
                <button type="button" disabled={removingIds.includes(item.id)} onClick={() => retryRemove(item)} className={buttonStyles("quiet", "min-h-[44px]")}><PendingLabel pending={!!(removingIds.includes(item.id))} idle="Remove from saved" busy="Removing…" /></button>
                {removeErrors[item.id] && <p role="alert" className="w-full text-sm text-error">{removeErrors[item.id]} <button type="button" disabled={removingIds.includes(item.id)} onClick={() => setRetry((value) => value + 1)} className="ui-button ui-button--quiet">Refresh saved list</button></p>}
              </>}
            />
          ))}
          {moreError && <FeedbackMessage type="error" message={moreError} onRetry={() => void loadMore()} retryLabel="Retry" />}
          {nextCursor && <div className="text-center"><button type="button" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void loadMore()} className={buttonStyles("secondary", "min-h-[44px]")}><PendingLabel pending={!!(loadingMore)} idle="Load more" busy="Loading…" /></button></div>}
        </section>
      )}
    </PageContainer>
  );
}
