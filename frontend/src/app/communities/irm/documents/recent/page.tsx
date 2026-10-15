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

type RecentItem = {
  id: string;
  module_id: string;
  module_slug: string;
  module_name: string;
  title: string;
  type: string;
  source: string;
  last_page: number;
  last_opened_at: string;
};
type RecentFeed = { items: RecentItem[]; next_cursor: string | null };
const PAGE_SIZE = 20;

export default function RecentlyOpenedDocumentsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [items, setItems] = useState<RecentItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems([]);
    setNextCursor(null);
    setOwnerId(null);
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
    fetchApi<RecentFeed>(`/api/v1/communities/irm/documents/recent?limit=${PAGE_SIZE}`, { signal: controller.signal })
      .then((feed) => {
        if (controller.signal.aborted || generation.current !== requestGeneration || currentUser.current !== user.id) return;
        setItems(feed.items);
        setNextCursor(feed.next_cursor);
        setOwnerId(user.id);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || generation.current !== requestGeneration || (cause instanceof Error && cause.name === "AbortError")) return;
        setError("Could not load recently opened documents. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted && generation.current === requestGeneration) setLoading(false);
      });
    return () => controller.abort();
  }, [authLoading, user, retry]);

  const loadMore = useCallback(async () => {
    if (!user || !nextCursor || loadingMore || ownerId !== user.id) return;
    const requestGeneration = generation.current;
    moreController.current?.abort();
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreError(null);
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), after: nextCursor });
    try {
      const feed = await fetchApi<RecentFeed>(`/api/v1/communities/irm/documents/recent?${query}`, { signal: controller.signal });
      if (controller.signal.aborted || generation.current !== requestGeneration || currentUser.current !== user.id) return;
      setItems((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [...previous, ...feed.items.filter((item) => !existing.has(item.id))];
      });
      setNextCursor(feed.next_cursor);
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== requestGeneration || (cause instanceof Error && cause.name === "AbortError")) return;
      setMoreError("More recently opened documents could not be loaded. Please try again.");
    } finally {
      if (!controller.signal.aborted && generation.current === requestGeneration) setLoadingMore(false);
    }
  }, [user, nextCursor, loadingMore, ownerId]);

  const visibleItems = user && ownerId === user.id ? items : [];

  return (
    <PageContainer width="wide">
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Modules", href: "/communities/irm/modules" },
        { label: "Recently Opened" },
      ]} />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="ui-eyebrow">IRM / Your documents</p>
          <h1 className="ui-page-heading text-text">Recently Opened</h1>
          <p className="ui-helper mt-1">Your recently opened approved documents and reading positions.</p>
        </div>
        <Link href="/communities/irm/modules" className={buttonStyles("quiet")}>Browse modules</Link>
      </div>

      {authLoading ? (
        <div className="py-12 text-center text-text-muted" role="status">Checking your account…</div>
      ) : !user ? (
        <AccessDeniedGuidance isGuest returnHref="/communities/irm/modules" returnLabel="Modules" />
      ) : loading ? (
        <ContentLoading label="Loading recently opened documents…" kind="document" count={2} />
      ) : error ? (
        <FeedbackMessage type="error" message={error} onRetry={() => setRetry((value) => value + 1)} retryLabel="Retry" />
      ) : visibleItems.length === 0 ? (
        <ContentEmpty title="You have not opened any approved documents yet." description="Approved documents you open will appear here with your reading position."
          action={<Link href="/communities/irm/modules" className={buttonStyles("secondary")}>Browse modules</Link>} />
      ) : (
        <section aria-label="Recently opened documents" className="space-y-4">
          {visibleItems.map((item) => (
            <DocumentRow key={item.id} title={item.title}
              openHref={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}/documents/${encodeURIComponent(item.id)}`}
              context={<>Module: <Link className="ui-link" href={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}`}>{item.module_name}</Link></>}
              metadata={<>
                <span>Type: {documentTypeLabel(item.type)}</span>
                <span>Source: {documentSourceLabel(item.source)}</span>
                <span>Last opened: <time dateTime={item.last_opened_at}>{new Date(item.last_opened_at).toLocaleString()}</time></span>
                <span>Last page: {item.last_page}</span>
              </>}
              actions={<Link href={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}/documents/${encodeURIComponent(item.id)}`} className={buttonStyles("secondary", "min-h-[44px]")}>Continue reading</Link>}
            />
          ))}
          {moreError && <FeedbackMessage type="error" message={moreError} onRetry={() => void loadMore()} retryLabel="Retry" />}
          {nextCursor && <div className="text-center"><button type="button" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void loadMore()} className={buttonStyles("secondary", "min-h-[44px]")}><PendingLabel pending={!!(loadingMore)} idle="Load more" busy="Loading…" /></button></div>}
        </section>
      )}
    </PageContainer>
  );
}
