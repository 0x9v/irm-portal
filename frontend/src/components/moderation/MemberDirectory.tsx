"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { readMembershipDirectory } from "@/lib/membershipDirectory";
import { isConfirmedDelegate } from "@/lib/moderation";
import { memberActions } from "@/lib/memberManagement";
import { accountInitials } from "@/components/account/accountInitials";
import { useAsyncScope } from "@/lib/useAsyncScope";
import type { DirectoryFilter, MembershipDirectoryItem, MembershipDirectoryResponse } from "@/types/membershipDirectory";
import AccessDeniedGuidance from "@/components/AccessDeniedGuidance";
import FeedbackMessage from "@/components/FeedbackMessage";
import PageContainer from "@/components/PageContainer";
import Button, { PendingLabel } from "@/components/ui/Button";
import ModerationAction from "./ModerationAction";
import styles from "./MemberDirectory.module.css";

export type DirectoryReader = (slug: string, filter: DirectoryFilter, after: string | null, signal: AbortSignal) => Promise<MembershipDirectoryResponse>;
interface Props { readPage?: DirectoryReader; communitySlug?: string }
const filters: { value: DirectoryFilter; label: string }[] = [
  { value: "ALL", label: "All" }, { value: "ACTIVE", label: "Active" },
  { value: "PENDING", label: "Pending" }, { value: "REJECTED", label: "Rejected" },
  { value: "REMOVED", label: "Removed" }, { value: "BANNED", label: "Banned" },
];

export default function MemberDirectory({ readPage = readMembershipDirectory, communitySlug = "irm" }: Props) {
  const auth = useAuth();
  if (!isConfirmedDelegate(auth, communitySlug)) return <PageContainer width="wide">
    <p className="ui-eyebrow">IRM / Management</p>
    <h1 className="text-2xl font-bold text-text">Members</h1>
    {auth.isLoading || auth.isRefreshing ? <p role="status" className="mt-4 text-text-muted">Checking Delegate access…</p>
      : auth.error || auth.membershipError ? <FeedbackMessage type="error" message="Directory access could not be verified. Please try again." onRetry={auth.refresh} retryLabel="Verify access" />
      : <AccessDeniedGuidance isGuest={!auth.user} membershipStatus={auth.membership?.status} missingPermission="an ACTIVE Delegate in IRM" returnHref="/account#community-membership" returnLabel="Membership" />}
  </PageContainer>;
  return <AuthorizedDirectory key={`${auth.user!.id}:${auth.membership!.id}:${communitySlug}`} readPage={readPage} communitySlug={communitySlug} />;
}

function AuthorizedDirectory({ readPage = readMembershipDirectory, communitySlug = "irm" }: Props) {
  const [filter, setFilter] = useState<DirectoryFilter>("ACTIVE");
  return <PageContainer width="wide" className={styles.page}>
    <header className={styles.heading}>
      <p className="ui-eyebrow">IRM / Management</p>
      <h1>Members</h1>
      <p>Browse IRM memberships by status. Member actions keep accounts and contributions in place.</p>
      <Link href="/communities/irm/membership/staff" className="ui-button ui-button--secondary">Manage staff roles and permissions →</Link>
    </header>
    <div className={styles.filters}>
      <label htmlFor="membership-directory-status">Membership status</label>
      <select id="membership-directory-status" value={filter} onChange={event => setFilter(event.target.value as DirectoryFilter)} className="min-h-[44px] rounded-control border border-control-border bg-surface px-3 text-text focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2">
        {filters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
    {/* A new filter owns new reads, rows, cursor and dialogs from its first render. */}
    <FilteredDirectory key={filter} readPage={readPage} communitySlug={communitySlug} filter={filter} />
  </PageContainer>;
}

function FilteredDirectory({ readPage, communitySlug, filter }: { readPage: DirectoryReader; communitySlug: string; filter: DirectoryFilter }) {
  const auth = useAuth();
  const { refresh } = auth;
  const captureScope = useAsyncScope(`${auth.user?.id}:${auth.membership?.id}:${communitySlug}:${filter}`);
  const [items, setItems] = useState<MembershipDirectoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "info" | "error"; text: string } | null>(null);
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);
  const read = useRef<{ id: number; controller: AbortController | null; busy: boolean }>({ id: 0, controller: null, busy: false });
  const directoryRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => () => { read.current.id++; read.current.controller?.abort(); }, []);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const closeOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("dialog")) return;
      directoryRef.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach(details => {
        if (!details.contains(target)) details.open = false;
      });
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("focusin", closeOutside); };
  }, []);

  const loseAccess = useCallback(() => {
    read.current.id++;
    read.current.controller?.abort();
    read.current.busy = false;
    setItems([]); setCursor(null); setError(null); setMoreError(null); setFeedback(null);
    setLoading(false); setLoadingMore(false); setDenied(true);
  }, []);

  const load = useCallback(async (after: string | null = null) => {
    if (after && read.current.busy) return;
    const scopeCurrent = captureScope();
    read.current.controller?.abort();
    const controller = new AbortController();
    const id = ++read.current.id;
    read.current.controller = controller;
    read.current.busy = true;
    const isCurrent = () => scopeCurrent() && id === read.current.id && !controller.signal.aborted;
    if (after) { setLoadingMore(true); setMoreError(null); }
    else {
      setItems([]); setCursor(null); setLoading(true); setLoadingMore(false);
      setError(null); setMoreError(null); setRevision(value => value + 1);
    }
    try {
      const page = await readPage(communitySlug, filter, after, controller.signal);
      if (!isCurrent()) return;
      setItems(previous => Array.from(new Map((after ? [...previous, ...page.items] : page.items).map(item => [item.id, item])).values()));
      setCursor(page.next_cursor);
    } catch (failure) {
      if (!isCurrent()) return;
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        loseAccess(); void refresh(); return;
      }
      const message = failure instanceof ApiError && failure.status === 400
        ? "The page cursor is no longer valid. Refresh the directory to check the current memberships."
        : failure instanceof ApiError && failure.status === 404
        ? "This community directory is unavailable. Refresh to check whether the target is available again."
        : "Could not load memberships. Check your connection and try again.";
      if (after) setMoreError(message); else setError(message);
    } finally {
      if (isCurrent()) { read.current.busy = false; setLoading(false); setLoadingMore(false); }
    }
  }, [captureScope, readPage, communitySlug, filter, loseAccess, refresh]);

  useEffect(() => {
    // Initial read belongs to this mounted account/filter; cleanup invalidates it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (denied) return <FeedbackMessage type="error" message="Delegate access is unavailable. Membership records have been cleared." onRetry={auth.refresh} retryLabel="Verify access" />;
  return <section ref={directoryRef} aria-label="Membership directory" className={styles.directory}>
    <div className={styles.directoryToolbar}><Button variant="secondary" type="button" onClick={() => { setFeedback(null); void load(); }}>Refresh directory</Button></div>
    {feedback && <FeedbackMessage type={feedback.type} message={feedback.text} />}
    {loading && <p role="status" className="text-sm text-text-muted">Loading memberships…</p>}
    {error && <FeedbackMessage type="error" message={error} onRetry={() => void load()} retryLabel="Retry directory" />}
    {!loading && !error && items.length === 0 && <p className={styles.empty}>{filter === "ALL" ? "No memberships found." : filter === "BANNED" ? "No banned memberships found." : "No memberships found for this status."}</p>}
    <ul className={styles.list}>
      {items.map(member => <li key={member.id} className={styles.memberRow}>
        <div className={styles.memberIdentity}>
          <span className={styles.initials} aria-hidden="true">{accountInitials(member.username)}</span>
          <div className={styles.memberText}>
            <p className={styles.username}>@{member.username}</p>
            <p className={styles.meta}><span>Status: {member.status}</span><span>Role: {member.role}</span></p>
          </div>
        </div>
        <div className={styles.rowActions}>
          {memberActions(member).length > 0 && <details className={styles.actionDisclosure} onKeyDown={event => {
            if (event.key === "Escape") { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
          }}>
            <summary className="ui-button ui-button--quiet" aria-label={`Actions for @${member.username}`}>Actions <span aria-hidden="true">⌄</span></summary>
            <div className={`${styles.actionPanel} ui-motion-disclosure`} aria-label={`Actions for @${member.username}`}>
              {memberActions(member).map(kind => <ModerationAction key={kind} kind={kind} id={member.id} communitySlug={communitySlug} context={`@${member.username}`} scopeKey={`${filter}:${revision}`}
            onDenied={loseAccess}
            onConflict={() => { setFeedback({ type: "error", text: "The current membership state prevents this action. Checking the directory again." }); void load(); }}
            onCheck={() => load()}
            onRemoved={unavailable => {
              setFeedback({ type: unavailable ? "info" : "success", text: unavailable ? "This membership is unavailable. Checking the directory again."
                : kind === "unban" ? "Member unbanned from IRM. They may apply again; membership and management permissions are not restored."
                  : kind === "ban" ? "Member banned from IRM. Community access and reapplication are blocked."
                    : "Membership ended. They may apply again." });
              void load();
            }} />)}
            </div>
          </details>}
          {member.role === "DELEGATE" && <span className={styles.protected}>Protected Delegate</span>}
        </div>
      </li>)}
    </ul>
    {moreError && <FeedbackMessage type="error" message={moreError} onRetry={() => void load(cursor)} retryLabel="Retry Load More" />}
    {cursor && <Button variant="secondary" type="button" disabled={loading || loadingMore} onClick={() => void load(cursor)}><PendingLabel pending={!!(loadingMore)} idle="Load More" busy="Loading more…" /></Button>}
    {loadingMore && <p role="status" className="text-sm text-text-muted">Loading more memberships…</p>}
  </section>;
}
