import { API_URL } from "@/lib/api";
import type { CommunityPostReply } from "@/types/posts";

export const MAX_POST_REPLY_IMAGE_BYTES = 5_242_880;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPostReplyRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function isValidPostReplyResponse(
  value: unknown,
  communitySlug: string,
  postId: string,
  content: string,
  expectsImage: boolean,
  apiBase = API_URL,
  pageOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin
): value is CommunityPostReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<CommunityPostReply>;
  if (typeof reply.id !== "string" || !UUID_PATTERN.test(reply.id)) return false;

  let validImageUrl = reply.image_url === null || reply.image_url === undefined;
  if (typeof reply.image_url === "string") {
    try {
      const base = new URL(apiBase, pageOrigin);
      const target = new URL(reply.image_url, base);
      validImageUrl = target.origin === base.origin &&
        target.pathname === `/api/v1/communities/${encodeURIComponent(communitySlug)}/posts/${encodeURIComponent(postId)}/replies/${encodeURIComponent(reply.id)}/image` &&
        !target.search && !target.hash && !target.username && !target.password;
    } catch { validImageUrl = false; }
  }

  return reply.post_id === postId && typeof reply.author_username === "string" &&
    reply.content === content && typeof reply.created_at === "string" &&
    Number.isFinite(Date.parse(reply.created_at)) && validImageUrl &&
    (!expectsImage || typeof reply.image_url === "string");
}
