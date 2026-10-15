"use client";

import { Suspense, FormEvent, useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchApi, ApiError } from "@/lib/api";
import ModuleBrowserFrame, { type ModuleResponse } from "@/components/modules/ModuleBrowserFrame";
import styles from "@/components/modules/ModuleBrowser.module.css";
import { useAuth } from "@/context/AuthContext";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import SavedDocumentButton from "@/components/SavedDocumentButton";
import DocumentRow from "@/components/DocumentRow";
import ResourceImage from "@/components/modules/ResourceImage";
import LegacyImageLink from "@/components/modules/LegacyImageLink";
import { ContentLoading, ContentEmpty } from "@/components/ContentState";
import { buttonStyles } from "@/components/ui/Button";
import {
  DOCUMENT_SOURCES,
  DOCUMENT_TYPES,
  documentSourceLabel,
  documentTypeLabel,
  type DocumentReturnContext,
} from "@/lib/documentPresentation";
import {
  RESOURCE_KINDS, readResourceUrl, resourceModuleHref, resourceQuery, validFeed,
  safeExternalUrl, type ResourceItem, type ResourceFilters,
} from "@/lib/moduleResources";

export type DocumentResponse = {
  id: string;
  title: string;
  module_id: string;
  uploader_id: string;
  type: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function ModuleDetailContent() {
  const params = useParams();
  const moduleSlug = params.moduleSlug as string;
  const { user, membership, membershipError, error: authError, isLoading: authLoading, isRefreshing, isLoggingOut } = useAuth();
  const search = useSearchParams().toString();

  const [mod, setMod] = useState<ModuleResponse | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [feedScope, setFeedScope] = useState("");
  const [moduleLoading, setModuleLoading] = useState(true);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [queryDraft, setQueryDraft] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedKind, setSelectedKind] = useState<ResourceFilters["kind"]>("");
  const [selectedSource, setSelectedSource] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [returnContext, setReturnContext] = useState<DocumentReturnContext>("module");
  const [retryVersion, setRetryVersion] = useState(0);
  const documentRequestId = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const moreLock = useRef(false);

  useEffect(() => {
    const { filters, from: context } = readResourceUrl(search);
    // Ignore arbitrary return URLs and invalid filter values, and keep only the
    // small, supported module state in the address bar.
    const canonical = resourceModuleHref(moduleSlug, filters, context);
    const current = `${window.location.pathname}${search ? `?${search}` : ""}`;
    if (canonical !== current) window.history.replaceState(null, "", canonical);
    // URL -> form synchronization: initialize page state from validated address-bar filters.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueryDraft(filters.q);
    setTitleQuery(filters.q);
    setSelectedType(filters.type);
    setSelectedKind(filters.kind);
    setSelectedSource(filters.source);
    setReturnContext(context);
    setUrlReady(true);
  }, [moduleSlug, search]);

  const moduleController = useRef<AbortController | null>(null);
  const loadModule = useCallback(async () => {
    if (!moduleSlug || !user || authLoading) return;
    moduleController.current?.abort();
    const controller = new AbortController();
    moduleController.current = controller;
    setMod(null);
    setModuleLoading(true);
    setModuleError(null);
    try {
      const modData = await fetchApi<ModuleResponse>(`/api/v1/communities/irm/modules/${encodeURIComponent(moduleSlug)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setMod(modData);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setModuleError("Unauthorized. Please log in to view this module.");
        } else if (err.status === 404) {
          setModuleError("Module not found.");
        } else {
          setModuleError("Module details could not be loaded. Please try again.");
        }
      } else if (err instanceof Error) {
        setModuleError("Module details could not be loaded. Please try again.");
      } else {
        setModuleError("An unexpected error occurred.");
      }
    } finally {
      if (!controller.signal.aborted) setModuleLoading(false);
    }
  }, [moduleSlug, user, authLoading]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadModule();
    return () => moduleController.current?.abort();
  }, [loadModule]);

  useEffect(() => {
    if (!moduleSlug || !mod || mod.slug !== moduleSlug || !urlReady || !user || authLoading) return;
    const controller = new AbortController();
    const requestId = ++documentRequestId.current;
    moreController.current?.abort();
    moreLock.current = false;
    const filters: ResourceFilters = { q: titleQuery, kind: selectedKind, source: selectedSource as ResourceFilters["source"], type: selectedType };
    const scope = `${user.id}:irm:${moduleSlug}:${mod.id}:${resourceQuery(filters)}:${selectedType}`;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDocumentsLoading(true);
    setDocumentsError(null);
    setMoreError(null);
    setResources([]);
    setNextCursor(null);
    setFeedScope("");
    const base = `/api/v1/communities/irm/modules/${encodeURIComponent(moduleSlug)}`;
    const request = selectedType
      ? fetchApi<DocumentResponse[]>(`${base}/documents?${new URLSearchParams({
          ...(titleQuery ? { q: titleQuery } : {}), type: selectedType,
          ...(selectedSource ? { source: selectedSource } : {}),
        })}`, { signal: controller.signal }).then(data => {
          if (!Array.isArray(data)) throw new Error("Invalid document list");
          return { items: data.filter(doc => doc.status === "APPROVED").map(doc => ({
            id: doc.id, module_id: doc.module_id, kind: "PDF" as const, title: doc.title,
            description: null, source: doc.source as "STUDENT" | "OFFICIAL", status: "APPROVED" as const,
            created_at: doc.created_at, updated_at: doc.updated_at, document_type: doc.type,
          })), next_cursor: null };
        })
      : fetchApi<unknown>(`${base}/resources?${resourceQuery(filters)}`, { signal: controller.signal }).then(data => {
          if (!validFeed(data, mod.id)) throw new Error("Invalid resource feed");
          return data;
        });
    request.then((data) => {
      if (!controller.signal.aborted && requestId === documentRequestId.current) {
        setResources(data.items);
        setNextCursor(data.next_cursor);
        setFeedScope(scope);
      }
    }).catch((err: unknown) => {
      if (controller.signal.aborted || requestId !== documentRequestId.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      setDocumentsError("Failed to load resources. Please try again.");
    }).finally(() => {
      if (!controller.signal.aborted && requestId === documentRequestId.current) setDocumentsLoading(false);
    });

    return () => { controller.abort(); moreController.current?.abort(); };
  }, [moduleSlug, mod, titleQuery, selectedType, selectedKind, selectedSource, retryVersion, urlReady, user, authLoading]);

  const filters: ResourceFilters = { q: titleQuery, kind: selectedKind, source: selectedSource as ResourceFilters["source"], type: selectedType };
  const currentFeedScope = mod && user ? `${user.id}:irm:${moduleSlug}:${mod.id}:${resourceQuery(filters)}:${selectedType}` : "";

  const loadMore = async () => {
    if (!mod || !user || !nextCursor || selectedType || moreLock.current || feedScope !== currentFeedScope) return;
    moreLock.current = true;
    const controller = new AbortController();
    moreController.current = controller;
    const requestId = documentRequestId.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const data = await fetchApi<unknown>(`/api/v1/communities/irm/modules/${encodeURIComponent(moduleSlug)}/resources?${resourceQuery(filters, nextCursor)}`, { signal: controller.signal });
      if (!validFeed(data, mod.id)) throw new Error("Invalid resource feed");
      if (controller.signal.aborted || requestId !== documentRequestId.current) return;
      setResources(current => {
        const known = new Set(current.map(item => item.id));
        return [...current, ...data.items.filter(item => !known.has(item.id))];
      });
      setNextCursor(data.next_cursor);
    } catch {
      if (!controller.signal.aborted && requestId === documentRequestId.current) setMoreError("More resources could not be loaded. Try again.");
    } finally {
      if (!controller.signal.aborted && requestId === documentRequestId.current) setLoadingMore(false);
      if (moreController.current === controller) moreLock.current = false;
    }
  };

  const writeFilterUrl = (filters: ResourceFilters) => {
    const href = resourceModuleHref(moduleSlug, filters, returnContext);
    window.history.pushState(null, "", href);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = readResourceUrl(new URLSearchParams({ q: queryDraft }).toString()).filters.q;
    setQueryDraft(q);
    setTitleQuery(q);
    writeFilterUrl({ q, type: selectedType, kind: selectedKind, source: selectedSource as ResourceFilters["source"] });
  };

  const clearFilters = () => {
    setQueryDraft("");
    setTitleQuery("");
    setSelectedType("");
    setSelectedKind("");
    setSelectedSource("");
    writeFilterUrl({ q: "", type: "", kind: "", source: "" });
  };

  const setTypeFilter = (type: string) => {
    setSelectedType(type);
    if (type) setSelectedKind("PDF");
    writeFilterUrl({ q: titleQuery, type, kind: type ? "PDF" : selectedKind, source: selectedSource as ResourceFilters["source"] });
  };

  const setKindFilter = (kind: ResourceFilters["kind"]) => {
    setSelectedKind(kind);
    setSelectedType("");
    writeFilterUrl({ q: titleQuery, type: "", kind, source: selectedSource as ResourceFilters["source"] });
  };

  const setSourceFilter = (source: string) => {
    setSelectedSource(source);
    writeFilterUrl({ q: titleQuery, type: selectedType, kind: selectedKind, source: source as ResourceFilters["source"] });
  };

  const filtersActive = Boolean(titleQuery || selectedType || selectedSource || selectedKind);

  const isActiveMember = !!user && !authLoading && !isRefreshing && !isLoggingOut && !membershipError && !authError && membership?.status === "ACTIVE";

  return (
    <PageContainer width="wide">
      {/* Breadcrumb Navigation */}
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          ...(returnContext === "pending"
            ? [{ label: "Pending Documents", href: "/communities/irm/documents/pending" }]
            : returnContext === "mine"
              ? [{ label: "My Submissions", href: "/communities/irm/documents/mine" }]
              : [{ label: "Modules", href: "/communities/irm/modules" }]),
          { label: mod ? mod.name : "Module" },
        ]}
      />

      <div className="mb-6 flex flex-wrap justify-between items-center gap-4">
        <Link
          href={returnContext === "pending" ? "/communities/irm/documents/pending" : returnContext === "mine" ? "/communities/irm/documents/mine" : "/communities/irm/modules"}
          className={buttonStyles("quiet")}
        >
          &larr; {returnContext === "pending" ? "Back to Pending Documents" : returnContext === "mine" ? "Back to My Submissions" : "Back to Modules"}
        </Link>

      </div>

      <div className="mb-6">
        <p className="ui-eyebrow">IRM / Study resources</p>
        <h1 className="ui-page-heading text-text tracking-tight">IRM Modules</h1>
        <p className="ui-helper mt-2">Browse study resources organized by course module.</p>
      </div>
      {authLoading ? <p role="status" className="ui-helper">Loading module details...</p>
        : !user ? <AccessDeniedGuidance isGuest returnHref="/communities/irm/modules" returnLabel="Modules" /> : (
      <ModuleBrowserFrame selectedSlug={moduleSlug}>
      {moduleLoading || (mod && mod.slug !== moduleSlug) ? (
        <div className="py-12 text-center text-text-muted text-sm" role="status">
          Loading module details...
        </div>
      ) : moduleError && moduleError !== "Module not found." ? (
        <div className="my-4">
          <FeedbackMessage
            type="error"
            message={moduleError}
            onRetry={loadModule}
            retryLabel="Retry Loading"
          />
        </div>
      ) : moduleError === "Module not found." || !mod ? (
        <AccessDeniedGuidance
          isNotFound={true}
          notFoundMessage="Module not found. It may have been removed or renamed."
          returnHref="/communities/irm/modules"
          returnLabel="Modules"
        />
      ) : (
        <div>
          <div className={styles.selectionHeading}>
            <div><p className="ui-eyebrow">Selected module</p>
              <h2>{mod.name}</h2>
              <p className="ui-helper mt-2">Approved study resources</p>
            </div>
        {isActiveMember && mod ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Link href="/communities/irm/documents/mine" className={buttonStyles("quiet")}>My Submissions</Link>
            <Link
              href={`/communities/irm/modules/${encodeURIComponent(mod.slug)}/upload`}
              className={buttonStyles("secondary")}
            >
              Submit Resource
            </Link>
          </div>
        ) : mod ? (
          <Link
            href="/account#community-membership"
            className="text-xs text-text-muted hover:text-accent bg-surface-secondary border border-border px-3 py-2 rounded-control min-h-[44px] inline-flex items-center"
          >
            Active membership required to upload
          </Link>
        ) : null}
          </div>
          <div>
            <div>
              <form onSubmit={submitSearch} className={styles.filters}>
                <div className="min-w-0">
                  <label htmlFor="document-search" className="block text-sm font-medium text-text mb-1">Search resources</label>
                  <input
                    id="document-search"
                    type="search"
                    maxLength={100}
                    placeholder="Search titles"
                    value={queryDraft}
                    onChange={(event) => setQueryDraft(event.target.value)}
                    className="w-full min-h-[44px] rounded-control border border-control-border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </div>
                <div>
                  <label htmlFor="resource-kind" className="block text-sm font-medium text-text mb-1">Resource kind</label>
                  <select id="resource-kind" value={selectedKind} onChange={(event) => setKindFilter(event.target.value as ResourceFilters["kind"])} className="w-full min-h-[44px] rounded-control border border-control-border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    <option value="">All kinds</option>
                    {RESOURCE_KINDS.map(kind => <option key={kind} value={kind}>{kind === "PDF" ? "Document" : kind === "YOUTUBE" ? "YouTube" : kind === "LINK" ? "Useful link" : "Image"}</option>)}
                  </select>
                </div>
                {selectedKind === "PDF" && <div>
                  <label htmlFor="document-type" className="block text-sm font-medium text-text mb-1">Type</label>
                  <select id="document-type" value={selectedType} onChange={(event) => setTypeFilter(event.target.value)} className="w-full min-h-[44px] rounded-control border border-control-border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    <option value="">All types</option>
                    {DOCUMENT_TYPES.map((value) => <option key={value} value={value}>{documentTypeLabel(value)}</option>)}
                  </select>
                </div>}
                <div>
                  <label htmlFor="document-source" className="block text-sm font-medium text-text mb-1">Source</label>
                  <select id="document-source" value={selectedSource} onChange={(event) => setSourceFilter(event.target.value)} className="w-full min-h-[44px] rounded-control border border-control-border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                    <option value="">All sources</option>
                    {DOCUMENT_SOURCES.map((value) => <option key={value} value={value}>{documentSourceLabel(value)}</option>)}
                  </select>
                </div>
                <div className={styles.filterActions}>
                <button type="submit" className={buttonStyles("primary", "min-h-[44px]")}>Search</button>
                <button type="button" onClick={clearFilters} className={buttonStyles("quiet", "min-h-[44px]")}>Clear filters</button>
                </div>
              </form>
            </div>

            {documentsError ? (
              <div className="my-4">
                <FeedbackMessage type="error" message={documentsError} onRetry={() => setRetryVersion((version) => version + 1)} retryLabel="Retry" />
              </div>
            ) : documentsLoading || feedScope !== currentFeedScope ? (
              <ContentLoading label="Loading resources…" kind="document" count={2} />
            ) : resources.length === 0 && filtersActive ? (
              <ContentEmpty title="No resources match these filters." description="Try another title, kind, type or source."
                action={<button type="button" onClick={clearFilters} className={buttonStyles("quiet", "min-h-[44px]")}>Clear filters</button>} />
            ) : resources.length === 0 ? (
              <ContentEmpty title="No resources found for this module yet." description="Approved resources will appear here when they are available." />
            ) : (
              <div className={styles.rows}>
                {resources.map((item) => {
                  const readerHref = `/communities/irm/modules/${encodeURIComponent(mod.slug)}/documents/${encodeURIComponent(item.id)}?${new URLSearchParams({ from: returnContext, ...(titleQuery ? { q: titleQuery } : {}), ...(selectedKind ? { kind: selectedKind } : {}), ...(selectedType ? { type: selectedType } : {}), ...(selectedSource ? { source: selectedSource } : {}) }).toString()}`;
                  const outbound = safeExternalUrl(item);
                  const hostname = outbound ? new URL(outbound).hostname : "";
                  return <DocumentRow key={item.id} title={item.title} openHref={item.kind === "PDF" ? readerHref : undefined}
                    context={<>
                      <span className="text-xs text-text-subtle">{item.kind === "PDF" ? "Document" : item.kind === "IMAGE" ? "Image" : item.kind === "YOUTUBE" ? "YouTube" : "Useful link"}</span>
                      {item.description && <p className="mt-1 break-words">{item.description}</p>}
                      {item.kind === "IMAGE" && <ResourceImage key={`${user.id}:${item.id}:${item.preview_url}`} item={item} />}
                    </>}
                    metadata={<>
                      {item.kind === "PDF" && <span>Type: {documentTypeLabel(item.document_type ?? "")}</span>}
                      <span>Source: {documentSourceLabel(item.source)}</span>
                      <span>Added: <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString()}</time></span>
                    </>}
                    actions={<>
                      {item.kind === "PDF" && <><Link href={readerHref} className={buttonStyles("secondary", "min-h-[44px]")}>Read Document</Link>
                        <SavedDocumentButton documentId={item.id} /></>}
                      {item.kind === "IMAGE" && <LegacyImageLink key={`${user.id}:${item.id}`} moduleSlug={mod.slug} id={item.id} href={readerHref} />}
                      {item.kind === "YOUTUBE" && outbound && <a href={outbound} target="_blank" rel="noopener noreferrer" className={buttonStyles("secondary", "min-h-[44px]")}>Open on YouTube</a>}
                      {item.kind === "LINK" && outbound && <a href={outbound} target="_blank" rel="noopener noreferrer" className={buttonStyles("secondary", "min-h-[44px]")}>Open {hostname}</a>}
                      {(item.kind === "YOUTUBE" || item.kind === "LINK") && !outbound && <span className="text-sm text-text-subtle">Link unavailable</span>}
                    </>}
                  />;
                })}
                {nextCursor && !selectedType && <button type="button" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}
                  className={buttonStyles("secondary", "min-h-[44px] self-start")}>{loadingMore ? "Loading more…" : "Load more resources"}</button>}
                {moreError && <FeedbackMessage type="error" message={moreError} onRetry={loadMore} retryLabel="Retry loading more" />}
              </div>
            )}
          </div>
        </div>
      )}
      </ModuleBrowserFrame>)}
    </PageContainer>
  );
}

export default function ModuleDetailPage() {
  return <Suspense fallback={<PageContainer width="wide"><p role="status">Loading module details...</p></PageContainer>}>
    <ModuleDetailContent />
  </Suspense>;
}
