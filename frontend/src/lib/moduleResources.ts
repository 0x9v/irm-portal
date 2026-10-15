import { API_URL } from "@/lib/api";
import { isDocumentSource, isDocumentType, isDocumentReturnContext, type DocumentReturnContext } from "@/lib/documentPresentation";

export const RESOURCE_KINDS = ["PDF", "IMAGE", "YOUTUBE", "LINK"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type ResourceFilters = { q: string; kind: ResourceKind | ""; source: "STUDENT" | "OFFICIAL" | ""; type: string };

export type ResourceItem = {
  id: string; module_id: string; kind: ResourceKind; title: string; description: string | null;
  source: "STUDENT" | "OFFICIAL"; status: "APPROVED" | "PENDING" | "REJECTED";
  created_at: string; updated_at: string;
  document_type?: string; preview_url?: string; video_id?: string; url?: string;
};
export type ResourceFeed = { items: ResourceItem[]; next_cursor: string | null };
export type PendingResourceItem = ResourceItem & {
  module_slug: string; module_name: string; is_uploader: boolean;
  my_vote: "YES" | "NO" | null; can_vote: boolean; can_approve: boolean;
  full_resource_access: boolean;
  preview: { url: string; media_type?: "image/png" | "image/webp" };
};
export type PendingResourceFeed = { items: PendingResourceItem[]; next_cursor: string | null };

export function isResourceKind(value: string | null): value is ResourceKind {
  return RESOURCE_KINDS.some(kind => kind === value);
}

export function readResourceUrl(search: string): { filters: ResourceFilters; from: DocumentReturnContext } {
  const params = new URLSearchParams(search);
  const q = (params.get("q") ?? "").trim();
  const rawType = params.get("type");
  const rawKind = params.get("kind");
  const rawSource = params.get("source");
  const rawFrom = params.get("from");
  const type = isDocumentType(rawType) ? rawType : "";
  const kind = isResourceKind(rawKind) ? rawKind : "";
  return {
    filters: { q: q.length <= 100 ? q : "", kind: type ? "PDF" : kind, type,
      source: isDocumentSource(rawSource) ? rawSource : "" },
    from: isDocumentReturnContext(rawFrom) ? rawFrom : "module",
  };
}

export function resourceModuleHref(slug: string, filters: ResourceFilters, from: DocumentReturnContext): string {
  const params = new URLSearchParams();
  if (filters.q.trim() && filters.q.trim().length <= 100) params.set("q", filters.q.trim());
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.type && filters.kind === "PDF") params.set("type", filters.type);
  if (filters.source) params.set("source", filters.source);
  if (from !== "module") params.set("from", from);
  return `/communities/irm/modules/${encodeURIComponent(slug)}${params.size ? `?${params}` : ""}`;
}

export function resourceQuery(filters: ResourceFilters, after?: string): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.source) params.set("source", filters.source);
  params.set("limit", "20");
  if (after) params.set("after", after);
  return params.toString();
}

export function validFeed(value: unknown, moduleId: string): value is ResourceFeed {
  if (!value || typeof value !== "object") return false;
  const feed = value as Partial<ResourceFeed>;
  if (!Array.isArray(feed.items) || !(feed.next_cursor === null || typeof feed.next_cursor === "string")) return false;
  return feed.items.every(item => item && typeof item.id === "string" && item.id && item.module_id === moduleId &&
    isResourceKind(item.kind) && item.status === "APPROVED" && typeof item.title === "string" &&
    (item.source === "STUDENT" || item.source === "OFFICIAL") && typeof item.created_at === "string" &&
    (item.kind === "PDF" ? typeof item.document_type === "string" : item.kind === "IMAGE" ? typeof item.preview_url === "string" : typeof item.url === "string"));
}

export function pendingResourcePreviewUrl(community: string, item: PendingResourceItem): string | null {
  if (item.kind !== "PDF" && item.kind !== "IMAGE") return null;
  if (item.kind === "PDF" && item.preview.media_type !== "image/png") return null;
  if (item.kind === "IMAGE" && item.preview.media_type !== "image/png" && item.preview.media_type !== "image/webp") return null;
  return resourcePreviewUrl(community, { id: item.id, preview_url: item.preview.url });
}

export function validPendingFeed(value: unknown, community = "irm"): value is PendingResourceFeed {
  if (!value || typeof value !== "object") return false;
  const feed = value as Partial<PendingResourceFeed>;
  if (!Array.isArray(feed.items) || !(feed.next_cursor === null || typeof feed.next_cursor === "string")) return false;
  return feed.items.every(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id ||
      typeof item.module_id !== "string" || !item.module_id || !isResourceKind(item.kind) ||
      item.source !== "STUDENT" || item.status !== "PENDING" || typeof item.title !== "string" || !item.title ||
      typeof item.module_slug !== "string" || !item.module_slug || typeof item.module_name !== "string" ||
      typeof item.created_at !== "string" || typeof item.is_uploader !== "boolean" ||
      typeof item.can_vote !== "boolean" || typeof item.can_approve !== "boolean" ||
      typeof item.full_resource_access !== "boolean" ||
      !(item.my_vote === null || item.my_vote === "YES" || item.my_vote === "NO") ||
      !item.preview || typeof item.preview.url !== "string") return false;
    if ((item.is_uploader || item.my_vote !== null) && item.can_vote) return false;
    if (item.kind === "PDF") return typeof item.document_type === "string" && item.preview.media_type === "image/png" &&
      item.full_resource_access === (item.my_vote === "YES") && !!pendingResourcePreviewUrl(community, item);
    if (item.kind === "IMAGE") return item.full_resource_access && !!pendingResourcePreviewUrl(community, item);
    if (!item.full_resource_access) return false;
    return item.preview.url === item.url && !!safeExternalUrl(item);
  });
}

export function resourcePreviewUrl(community: string, item: Pick<ResourceItem, "id" | "preview_url">): string | null {
  if (!item.preview_url) return null;
  try {
    const base = new URL(API_URL);
    const url = new URL(item.preview_url, base);
    const expected = `/api/v1/communities/${encodeURIComponent(community)}/resources/${encodeURIComponent(item.id)}/preview`;
    if (url.origin !== base.origin || url.pathname !== expected || url.search || url.hash) return null;
    return url.href;
  } catch { return null; }
}

export function safeExternalUrl(item: Pick<ResourceItem, "kind" | "url" | "video_id">): string | null {
  if (typeof item.url !== "string") return null;
  try {
    const url = new URL(item.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") return null;
    if (item.kind === "YOUTUBE") return item.video_id && /^[A-Za-z0-9_-]{11}$/.test(item.video_id) &&
      url.href === `https://www.youtube.com/watch?v=${item.video_id}` ? url.href : null;
    if (item.kind === "LINK") return url.href;
  } catch { /* Invalid server value stays unavailable. */ }
  return null;
}
