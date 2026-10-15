import React, { memo, ReactNode } from 'react';
import { DiscussionMessage } from '@/types/discussion';
import { REACTION_MAP } from '@/lib/discussion';
import { StickerAsset } from './StickerAsset';
import { AuthenticatedStickerImage } from './AuthenticatedStickerImage';
import { ReactionPicker } from './ReactionPicker';
import styles from './Discussion.module.css';

const emojiGlyph = /[\u00A9\u00AE\u2122\u20E3\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u;

/** Enlarge a short run of emoji graphemes, never emoji inside ordinary prose. */
export function isEmojiOnlyMessage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed), part => part.segment);
  return graphemes.length <= 8 && graphemes.every(part => /^\s+$/u.test(part) || emojiGlyph.test(part));
}

interface DiscussionMessageItemProps {
  message: DiscussionMessage;
  onReactionToggle: (messageId: string, emoji: string) => void;
  isReacting?: boolean;
  isOwn?: boolean;
  ownerState?: 'current' | 'other' | 'unclassified';
  showAuthor?: boolean;
  groupedFromPrevious?: boolean;
  groupEnd?: boolean;
  dateLabel?: string | null;
  moderation?: ReactNode;
  accountId?: string;
}

export const DiscussionMessageItem = memo(function DiscussionMessageItem({
  message,
  onReactionToggle,
  isReacting = false,
  isOwn = false,
  ownerState = isOwn ? 'current' : 'other',
  showAuthor = true,
  groupedFromPrevious = false,
  groupEnd = true,
  dateLabel = null,
  moderation,
  accountId = '',
}: DiscussionMessageItemProps) {
  const isSticker = message.kind === 'STICKER' || message.kind === 'CUSTOM_STICKER';
  const formattedTime = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const fullDate = new Date(message.created_at).toLocaleString();

  return (
    <article
      data-message-id={message.id}
      data-message-owner={ownerState}
      data-message-grouped={groupedFromPrevious ? 'true' : 'false'}
      aria-label={isOwn ? 'Your message' : `Message from ${message.author_username}`}
      className={`${styles.message} ${isOwn ? styles.messageOwn : ''} ${groupedFromPrevious ? styles.messageGrouped : ''} ${groupEnd ? styles.messageGroupEnd : ''} ${isSticker ? styles.messageSticker : ''}`}
    >
      {dateLabel && <div className={styles.dateSeparator}><span><time dateTime={message.created_at}>{dateLabel}</time></span></div>}
      <div className={styles.messageGroup}>
        <div className={styles.bubble}>
          {!isOwn && showAuthor && <span className={styles.author}>@{message.author_username}</span>}
          <div className={`${styles.body} ${isSticker ? styles.stickerBody : ''} ${message.kind === 'TEXT' && message.content && isEmojiOnlyMessage(message.content) ? styles.emojiOnly : ''}`}>
            {message.kind === 'TEXT' && message.content && (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}
            {message.kind === 'STICKER' && message.sticker_id && (
              <div className="my-1">
                <StickerAsset stickerId={message.sticker_id} size={160} className={styles.sticker} />
              </div>
            )}
            {message.kind === 'CUSTOM_STICKER' && message.custom_sticker_id && (
              <div className="my-1">
                <AuthenticatedStickerImage
                  path={`/api/v1/communities/irm/discussion/messages/${encodeURIComponent(message.id)}/sticker`}
                  accessKey={`${accountId}:irm:${message.id}`}
                  label="Custom sticker"
                  size={160}
                />
              </div>
            )}
          </div>
        </div>
        <div className={styles.messageFooter}>
          <div className={styles.reactions}>
            {message.reactions
              .filter((rx) => rx.count > 0)
              .map((rx) => {
                const config = REACTION_MAP[rx.emoji];
                const isSelected = message.caller_reaction === rx.emoji;
                const emojiChar = config ? config.emoji : rx.emoji;
                const label = config ? config.label : rx.emoji;

                return (
                  <button
                    key={rx.emoji}
                    type="button"
                    disabled={isReacting} aria-busy={isReacting}
                    onClick={() => onReactionToggle(message.id, rx.emoji)}
                    aria-label={`${label}, count ${rx.count} ${isSelected ? '(selected by you, click to remove)' : '(click to add)'}`}
                    aria-pressed={isSelected}
                    className={`ui-button ui-button--secondary ${styles.reaction}`}
                  >
                    <span className={styles.reactionEmoji} aria-hidden="true">{emojiChar}</span>
                    <span>{rx.count}</span>
                  </button>
                );
              })}
            <ReactionPicker
              onSelect={(emoji) => onReactionToggle(message.id, emoji)}
              alignRight={isOwn}
              callerReaction={message.caller_reaction}
              disabled={isReacting}
              className={styles.reactionTrigger}
            />
          </div>
          <div className={styles.meta}>
            <time dateTime={message.created_at} title={fullDate}>{formattedTime}</time>
            {moderation}
          </div>
        </div>
      </div>
    </article>
  );
});
