import { ApiError, fetchApi } from "./api";
import type { AuthContextValue } from "../context/AuthContext";

export function isConfirmedDelegate(auth: Pick<AuthContextValue, "user" | "membership" | "isLoading" | "isRefreshing" | "isLoggingOut" | "error" | "membershipError">, communitySlug = "irm") {
  // AuthContext currently verifies only IRM. Never reuse that authority for another community.
  return communitySlug === "irm" && !!auth.user && !auth.isLoading && !auth.isRefreshing &&
    !auth.isLoggingOut && !auth.error && !auth.membershipError &&
    auth.membership?.status === "ACTIVE" && auth.membership.role === "DELEGATE";
}

export type ModerationKind = "announcement" | "announcement reply" | "post" | "post reply" | "message" | "member" | "ban" | "unban";
export function moderationRequest(kind: ModerationKind, slug: string, id: string, parentId?: string) {
  const base = `/api/v1/communities/${encodeURIComponent(slug)}`;
  const target = encodeURIComponent(id);
  switch (kind) {
    case "announcement": return { path: `${base}/announcements/${target}`, method: "DELETE" };
    case "post": return { path: `${base}/posts/${target}`, method: "DELETE" };
    case "announcement reply":
    case "post reply":
      if (!parentId) throw new Error("Reply parent is required");
      return { path: `${base}/${kind === "post reply" ? "posts" : "announcements"}/${encodeURIComponent(parentId)}/replies/${target}`, method: "DELETE" };
    case "message": return { path: `${base}/discussion/messages/${target}`, method: "DELETE" };
    case "member": return { path: `${base}/memberships/${target}`, method: "DELETE" };
    case "ban": return { path: `${base}/memberships/${target}/ban`, method: "PUT" };
    case "unban": return { path: `${base}/memberships/${target}/ban`, method: "DELETE" };
  }
}
export function moderationCopy(kind: ModerationKind) {
  if (kind === "member") return { label: "Remove member", description: "This ends their IRM community membership. Their account and existing contributions remain. They may apply again." };
  if (kind === "ban") return { label: "Ban member", description: "This blocks IRM community access and reapplication. Their account and existing contributions remain. This is a community ban." };
  if (kind === "unban") return { label: "Unban member", description: "This allows them to apply to IRM again. Their membership becomes REMOVED; it is not reactivated or approved. It does not restore their previous membership or management permissions." };
  const noun = kind.includes("reply") ? "reply" : kind;
  return { label: `Remove ${noun}`, description: `This removes the ${noun} from community view.${kind === "post" || kind === "announcement" ? " Its replies will also be hidden." : ""} There is no user-facing Undo.` };
}
export type ModerationResult = "success" | "unavailable" | "denied" | "conflict" | "uncertain" | "stale";
export async function performModeration(request: { path: string; method: string }, isCurrent: () => boolean): Promise<ModerationResult> {
  if (!isCurrent()) return "stale";
  try {
    await fetchApi<void>(request.path, { method: request.method });
    return isCurrent() ? "success" : "stale";
  } catch (error) {
    if (!isCurrent()) return "stale";
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) return "denied";
      if (error.status === 404) return "unavailable";
      if (error.status === 409) return "conflict";
    }
    return "uncertain";
  }
}

// Removal IDs belong to one mounted account/community session. At the limit,
// stop ingestion rather than evict a tombstone and resurrect stale content.
export class RemovalLedger {
  private ids = new Set<string>();
  saturated = false;
  constructor(private readonly limit = 2048) {}
  remove(id: string) {
    if (this.ids.has(id)) return;
    if (this.ids.size >= this.limit) { this.saturated = true; return; }
    this.ids.add(id);
  }
  allows(id: string) { return !this.saturated && !this.ids.has(id); }
  filter<T extends { id: string }>(items: T[]) { return items.filter(item => this.allows(item.id)); }
  clear() { this.ids.clear(); this.saturated = false; }
}
