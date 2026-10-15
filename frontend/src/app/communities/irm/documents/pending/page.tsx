"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchApi, downloadApiFile, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { validPendingFeed, safeExternalUrl, type PendingResourceItem } from "@/lib/moduleResources";
import PendingResourcePreview from "@/components/modules/PendingResourcePreview";
import ConfirmationDialog from "@/components/moderation/ConfirmationDialog";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import PageContainer from "@/components/PageContainer";
import Breadcrumbs from "@/components/Breadcrumbs";
import FeedbackMessage from "@/components/FeedbackMessage";
import { ContentLoading, ContentEmpty } from "@/components/ContentState";
import { buttonStyles } from "@/components/ui/Button";
import { documentTypeLabel } from "@/lib/documentPresentation";

type Notice = { message: string; kind: "success" | "error" | "warning"; download?: { id: string; title: string } };
const base = "/api/v1/communities/irm/resources";

export default function PendingDocumentsPage() {
  const { user, membership, membershipError, error: authError, isLoading: authLoading, isRefreshing, isLoggingOut, refresh } = useAuth();
  const scope = !authLoading && !isRefreshing && !isLoggingOut && user && membership?.status === "ACTIVE" && !membershipError && !authError
    ? `${user.id}:irm:${membership.id}` : null;
  const scopeRef = useRef(scope);
  const requestRef = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const actionRef = useRef<string | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [items, setItems] = useState<PendingResourceItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);

  useEffect(() => { scopeRef.current = scope; }, [scope]);

  const accessLost = useCallback((status = 403) => {
    requestRef.current?.abort();
    requestNumber.current++;
    setItems([]); setCursor(null); setLoadedScope(null); setPreviewId(null);
    setConfirmId(null); setNotice(null); setBlockedIds([]); setDenied(status);
    void refresh();
  }, [refresh]);
  const previewAccessLost = useCallback((status: 401 | 403) => accessLost(status), [accessLost]);

  const loadQueue = useCallback(async (next = false) => {
    if (!scope || (next && !cursor)) return false;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const requestId = ++requestNumber.current;
    if (next) setLoadingMore(true);
    else { setLoading(true); setItems([]); setCursor(null); setLoadedScope(null); setPreviewId(null); }
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "20", ...(next && cursor ? { after: cursor } : {}) });
      const data = await fetchApi<unknown>(`${base}/pending?${query}`, { signal: controller.signal, cache: "no-store" });
      if (!validPendingFeed(data)) throw new Error("Invalid pending feed");
      if (controller.signal.aborted || scopeRef.current !== scope || requestNumber.current !== requestId) return false;
      setItems(current => next ? [...current, ...data.items.filter(item => !current.some(existing => existing.id === item.id))] : data.items);
      setCursor(data.next_cursor); setLoadedScope(scope); setDenied(null); setBlockedIds([]);
      return true;
    } catch (err) {
      if (controller.signal.aborted || scopeRef.current !== scope || requestNumber.current !== requestId) return false;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) accessLost(err.status);
      else setError(next && err instanceof ApiError && err.status === 404
        ? "The pending cursor expired. Refresh the queue."
        : "Pending resources could not be loaded. Refresh the queue to check their current state.");
      return false;
    } finally {
      if (requestNumber.current === requestId) { setLoading(false); setLoadingMore(false); }
    }
  }, [scope, cursor, accessLost]);

  useEffect(() => {
    requestRef.current?.abort();
    requestNumber.current++;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems([]); setCursor(null); setLoadedScope(null); setPreviewId(null);
    setNotice(null); setConfirmId(null); setBlockedIds([]); setDenied(null);
    if (scope) void loadQueue(false);
    return () => { requestRef.current?.abort(); };
    // A cursor change must not restart the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const runAction = async (item: PendingResourceItem, action: "vote" | "approve", vote?: "YES" | "NO") => {
    if (!scope || loadedScope !== scope || actionRef.current || blockedIds.includes(item.id) ||
      (action === "vote" ? !item.can_vote : !item.can_approve)) return;
    actionRef.current = item.id;
    setBusyId(item.id); setNotice(null); setConfirmError(null);
    try {
      const result = await fetchApi<unknown>(`${base}/${encodeURIComponent(item.id)}/${action}`, {
        method: "POST", body: JSON.stringify(action === "vote" ? { vote } : {}), cache: "no-store",
      }, 200);
      if (scopeRef.current !== scope) return;
      if (action === "vote") {
        const reply = result as { vote?: unknown; full_resource_access?: unknown };
        if (reply.vote !== vote || typeof reply.full_resource_access !== "boolean") throw new Error("Unconfirmed vote response");
        setNotice({ kind: "success", message: `Vote recorded for “${item.title}”.`,
          download: item.kind === "PDF" && reply.full_resource_access ? { id: item.id, title: item.title } : undefined });
      } else {
        const reply = result as { id?: unknown; status?: unknown };
        if (reply.id !== item.id || reply.status !== "APPROVED") throw new Error("Unconfirmed approval response");
        setConfirmId(null);
        setNotice({ kind: "success", message: `“${item.title}” was approved.` });
      }
      if (!await loadQueue(false) && scopeRef.current === scope) {
        setBlockedIds(current => [...current, item.id]);
        setNotice({ kind: "warning", message: "The action was recorded, but the queue could not refresh. Refresh before another action." });
      }
    } catch (err) {
      if (scopeRef.current !== scope) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) { accessLost(err.status); return; }
      setBlockedIds(current => [...current, item.id]);
      if (err instanceof ApiError && err.status === 409) {
        setConfirmId(null);
        setNotice({ kind: "warning", message: "This resource changed or your action is no longer available. The queue is refreshing." });
        await loadQueue(false);
      } else {
        const message = "The outcome could not be confirmed. Refresh the queue before choosing another action; it may already have completed.";
        setNotice({ kind: "warning", message });
        if (action === "approve") setConfirmError(message);
      }
    } finally {
      actionRef.current = null;
      if (scopeRef.current === scope) setBusyId(null);
    }
  };

  const download = async (id: string, title: string) => {
    try { await downloadApiFile(`/api/v1/documents/${encodeURIComponent(id)}/download`, title); }
    catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) accessLost(err.status);
      else { setNotice({ kind: "error", message: "The PDF could not be downloaded. Refresh the queue to check access." });
        if (err instanceof ApiError && err.status === 404) void loadQueue(false); }
    }
  };
  const visible = scope && loadedScope === scope && !denied;
  const confirming = visible ? items.find(item => item.id === confirmId && item.can_approve) : null;

  return <PageContainer width="wide">
    <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Pending Resources" }]} />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><p className="ui-eyebrow">IRM / Study resources</p><h1 className="ui-page-heading">Pending Resources</h1>
        <p className="ui-helper mt-1">Review student submissions across modules.</p></div>
      <div className="flex flex-wrap gap-3"><Link href="/communities/irm/modules" className={buttonStyles("quiet")}>← Back to Modules</Link>
        {scope && <button type="button" onClick={() => void loadQueue(false)} disabled={loading || loadingMore || !!busyId}
          className={buttonStyles("secondary")}>Refresh queue</button>}</div>
    </div>
    {notice && visible && <div className="mb-4 space-y-2"><FeedbackMessage type={notice.kind} message={notice.message}
      onRetry={notice.kind !== "success" ? () => void loadQueue(false) : undefined} retryLabel="Refresh queue" />
      {notice.download && visible && <button type="button" onClick={() => void download(notice.download!.id, notice.download!.title)}
        className={buttonStyles("secondary")}>Download Original</button>}</div>}
    {authLoading || isRefreshing && !scope ? <ContentLoading label="Checking access…" kind="document" count={2} />
      : !user || denied === 401 ? <AccessDeniedGuidance isGuest returnHref="/communities/irm/modules" returnLabel="Modules" />
      : !scope || denied === 403 ? <AccessDeniedGuidance membershipStatus={membership?.status ?? "PENDING"} returnHref="/communities/irm/modules" returnLabel="Modules" />
      : loading && !visible ? <ContentLoading label="Loading pending resources…" kind="document" count={2} />
      : error && !visible ? <FeedbackMessage type="error" message={error} onRetry={() => void loadQueue(false)} retryLabel="Refresh queue" />
      : visible && items.length === 0 ? <ContentEmpty title="No pending resources to review." description="New student submissions will appear here." />
      : visible && <div className="space-y-5">
        {items.map(item => {
          const outbound = item.kind === "YOUTUBE" || item.kind === "LINK" ? safeExternalUrl(item) : null;
          const locked = !!busyId || blockedIds.includes(item.id) || loading || loadingMore;
          return <article key={item.id} className="ui-surface space-y-4">
            <div><p className="ui-eyebrow">{item.kind === "PDF" ? "Document" : item.kind === "IMAGE" ? "Image" : item.kind === "YOUTUBE" ? "YouTube" : "Useful link"}</p>
              <h2 className="text-lg font-bold break-words">{item.title}</h2>{item.description && <p className="mt-1 break-words text-sm text-text-subtle">{item.description}</p>}</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-text-subtle">
              <span>Module: <Link className="ui-link" href={`/communities/irm/modules/${encodeURIComponent(item.module_slug)}?from=pending`}>{item.module_name}</Link></span>
              {item.kind === "PDF" && <span>Type: {documentTypeLabel(item.document_type ?? "")}</span>}
              <span>Submitted: <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleDateString()}</time></span>
              {item.is_uploader && <span>Your upload · voting unavailable</span>}{item.my_vote && <span>You voted: {item.my_vote}</span>}
            </div>
            <div className="flex flex-wrap gap-3">
              {(item.kind === "PDF" || item.kind === "IMAGE") && <button type="button" onClick={() => setPreviewId(current => current === item.id ? null : item.id)}
                className={buttonStyles("secondary")}>{previewId === item.id ? "Hide preview" : "Load preview"}</button>}
              {outbound && <a href={outbound} target="_blank" rel="noopener noreferrer" className={buttonStyles("secondary")}>
                {item.kind === "YOUTUBE" ? "Open on YouTube" : `Open ${new URL(outbound).hostname}`}</a>}
              {item.kind === "PDF" && item.full_resource_access && <button type="button" onClick={() => void download(item.id, item.title)}
                className={buttonStyles("secondary")}>Download Original</button>}
            </div>
            {previewId === item.id && (item.kind === "PDF" || item.kind === "IMAGE") &&
              <PendingResourcePreview key={`${scope}:${item.id}`} item={item} onAccessLost={previewAccessLost} />}
            {(item.can_vote || item.can_approve) && <div className="flex flex-wrap gap-3 border-t border-border pt-4">
              {item.can_vote && <><button type="button" disabled={locked} aria-busy={busyId === item.id} onClick={() => void runAction(item, "vote", "YES")}
                className={buttonStyles("primary")}>YES — relevant</button>
                <button type="button" disabled={locked} aria-busy={busyId === item.id} onClick={() => void runAction(item, "vote", "NO")}
                  className={buttonStyles("secondary")}>NO — not relevant</button></>}
              {item.can_approve && <button type="button" disabled={locked} onClick={() => { setConfirmError(null); setConfirmId(item.id); }}
                className={buttonStyles("secondary")}>Approve resource</button>}
            </div>}
          </article>;
        })}
        {cursor && <button type="button" onClick={() => void loadQueue(true)} disabled={loadingMore || loading || !!busyId}
          className={buttonStyles("secondary")}>{loadingMore ? "Loading more…" : "Load more resources"}</button>}
        {error && <FeedbackMessage type="error" message={error} onRetry={() => void loadQueue(false)} retryLabel="Refresh queue" />}
      </div>}
    {confirming && <ConfirmationDialog title="Approve resource" heading="Approve this resource?"
      context={confirming.title} description="Publish this student resource to the community immediately. Existing votes remain recorded."
      pending={busyId === confirming.id} error={confirmError} onCancel={() => setConfirmId(null)}
      onConfirm={() => void runAction(confirming, "approve")}
      onCheck={async () => { if (await loadQueue(false)) setConfirmId(null); }} />}
  </PageContainer>;
}
