export type DiscussionMessageKind = 'TEXT' | 'STICKER' | 'CUSTOM_STICKER';

export interface ReactionSummary {
  emoji: string;
  count: number;
}

export interface DiscussionMessage {
  id: string;
  kind: DiscussionMessageKind;
  content: string | null;
  sticker_id: string | null;
  custom_sticker_id: string | null;
  author_username: string;
  /** Stable author UUID returned by Discussion history, creation and event contracts. */
  author_id: string;
  created_at: string;
  reactions: ReactionSummary[];
  caller_reaction: string | null;
}

export interface DiscussionHistoryResponse {
  items: DiscussionMessage[];
  older_cursor: string | null;
  newer_cursor: string | null;
  has_more_older: boolean;
  has_more_newer: boolean;
}

export interface DiscussionReactionSummaryResponse {
  message_id: string;
  reactions: ReactionSummary[];
  caller_reaction: string | null;
}

export interface StickerItem {
  id: string;
  name: string;
  description: string;
}

export interface StickerLibraryItem {
  id: string;
  preview_url: string;
  width: number;
  height: number;
  media_type: 'image/webp';
  byte_size: number;
  created_at: string;
}

export interface StickerLibraryResponse {
  items: StickerLibraryItem[];
  next_cursor: string | null;
}

export type DiscussionConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface PendingSubmission {
  client_message_id: string;
  kind: DiscussionMessageKind;
  content: string | null;
  sticker_id: string | null;
  custom_sticker_id: string | null;
  error?: string;
}
