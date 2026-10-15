import { API_URL } from './api';
import { DiscussionMessage, StickerItem } from '@/types/discussion';

export interface ReactionConfig {
  id: string;
  emoji: string;
  label: string;
}

export const REACTION_CONFIGS: ReactionConfig[] = [
  { id: 'thumbs_up', emoji: '👍', label: 'Thumbs Up' },
  { id: 'heart', emoji: '❤️', label: 'Heart' },
  { id: 'laugh', emoji: '😄', label: 'Laugh' },
  { id: 'surprised', emoji: '😮', label: 'Surprised' },
  { id: 'sad', emoji: '😢', label: 'Sad' },
  { id: 'thanks', emoji: '🙏', label: 'Thanks' },
];

export const REACTION_MAP: Record<string, ReactionConfig> = Object.fromEntries(
  REACTION_CONFIGS.map((r) => [r.id, r])
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalizes an untrusted REST or WebSocket message without guessing identity.
 * Invalid/missing author UUIDs use an empty sentinel so ownership stays false.
 */
export function normalizeDiscussionMessage(value: unknown): DiscussionMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id || (raw.kind !== 'TEXT' && raw.kind !== 'STICKER' && raw.kind !== 'CUSTOM_STICKER')) return null;

  return {
    id: raw.id,
    kind: raw.kind,
    content: typeof raw.content === 'string' ? raw.content : null,
    sticker_id: typeof raw.sticker_id === 'string' ? raw.sticker_id : null,
    custom_sticker_id: typeof raw.custom_sticker_id === 'string' && UUID_PATTERN.test(raw.custom_sticker_id) ? raw.custom_sticker_id : null,
    author_username: typeof raw.author_username === 'string' ? raw.author_username : '',
    author_id: typeof raw.author_id === 'string' && UUID_PATTERN.test(raw.author_id) ? raw.author_id : '',
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    reactions: Array.isArray(raw.reactions) ? raw.reactions as DiscussionMessage['reactions'] : [],
    caller_reaction: typeof raw.caller_reaction === 'string' ? raw.caller_reaction : null,
  };
}

export function normalizeDiscussionMessages(value: unknown): DiscussionMessage[] {
  return Array.isArray(value)
    ? value.map(normalizeDiscussionMessage).filter((message): message is DiscussionMessage => message !== null)
    : [];
}

export const STATIC_STICKERS: StickerItem[] = [
  {
    id: 'pepe_thumbs_up',
    name: 'Thumbs Up',
    description: 'Classic encouraging thumbs up',
  },
  {
    id: 'cat_heart_eyes',
    name: 'Heart Eyes',
    description: 'Loving heart eyes cat',
  },
  {
    id: 'blob_party',
    name: 'Party',
    description: 'Celebration party blob',
  },
  {
    id: 'doge_classic',
    name: 'Much Wow',
    description: 'Classic doge appreciation',
  },
  {
    id: 'programmer_coffee',
    name: 'Coffee',
    description: 'Hot coffee for coding',
  },
  {
    id: 'rubber_duck_coding',
    name: 'Rubber Duck',
    description: 'Rubber duck debugging',
  },
];

/**
 * Derives the WebSocket connection URL from the configured API_URL.
 * Replaces http/https with ws/wss and retains any custom path prefix.
 */
export function getDiscussionWebSocketUrl(communitySlug: string = 'irm'): string {
  // In browser, handle relative or absolute URLs
  const base = typeof window !== 'undefined' && API_URL.startsWith('/')
    ? `${window.location.origin}${API_URL}`
    : API_URL;

  const url = new URL(
    `${base.replace(/\/+$/, '')}/api/v1/communities/${encodeURIComponent(communitySlug)}/discussion/ws`
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Deterministically sorts discussion messages chronologically.
 * Primary: created_at ascending (oldest first).
 * Secondary: id ascending (tie-breaker for concurrent equal timestamps).
 */
export function compareDiscussionMessages(a: DiscussionMessage, b: DiscussionMessage): number {
  const timeA = new Date(a.created_at).getTime();
  const timeB = new Date(b.created_at).getTime();
  if (timeA !== timeB) {
    return timeA - timeB;
  }
  const idA = a.id.toLowerCase();
  const idB = b.id.toLowerCase();
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}
