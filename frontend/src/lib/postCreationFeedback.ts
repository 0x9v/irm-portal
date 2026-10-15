/**
 * Ephemeral in-memory store for confirmed post creation feedback in the current client session.
 * 
 * Requirements:
 * - Success feedback is shown only following confirmed creation in this session.
 * - No private content in URL parameters.
 * - No localStorage or sessionStorage persistence.
 * - Consumed on first valid post detail view so refresh or direct URL entry does not display it.
 */

const confirmedCreatedPostIds = new Set<string>();

export function markPostCreated(postId: string): void {
  if (postId) {
    confirmedCreatedPostIds.add(postId);
  }
}

export function consumePostCreated(postId: string): boolean {
  if (postId && confirmedCreatedPostIds.has(postId)) {
    confirmedCreatedPostIds.delete(postId);
    return true;
  }
  return false;
}

export function clearPostCreatedFeedback(): void {
  confirmedCreatedPostIds.clear();
}
