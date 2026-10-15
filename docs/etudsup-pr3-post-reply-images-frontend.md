# ETUDSUP PR3 — Post-reply image frontend

## Contract verified

PR2 exposes `POST /api/v1/communities/{community_slug}/posts/{post_id}/replies` as legacy JSON text-only plus atomic multipart creation. Multipart accepts `client_request_id`, optional `content`, and optional `image`; a new reply returns 201 and a matching replay returns 200. Both return the reply fields plus nullable `image_url`. A conflicting ID returns 409 and an unresolved backend outcome returns 503. The private media route is `/api/v1/communities/{community_slug}/posts/{post_id}/replies/{reply_id}/image`. These shapes were checked in the PR2 report, route, schema, and reply model.

The old frontend composer accepted text only and posted JSON. It now supports text-only, text plus one image, and image-only replies. Announcement replies remain unchanged and text-only; their regression case asserts there is no image picker.

## Interaction and media behavior

- The community reply composer accepts JPEG/PNG up to 5,242,880 bytes, shows 5 MiB guidance, and previews a clearly marked unsaved local image. The selected image can be replaced or removed. The preview keeps its aspect ratio and wraps on narrow screens.
- Submission uses `FormData` with only `client_request_id`, nonempty trimmed `content`, and the optional `image`. The browser supplies the multipart boundary and Origin; the request includes credentials. A UUIDv4 is generated once for the logical submission. A synchronous ref lock blocks duplicate submit events.
- Only 201/200 with a validated reply matching the post, text, date, ID, and expected private image route confirms success. The response merges by reply ID, so an existing paginated row is not duplicated. Draft and file clear only after that confirmation.
- Network failures, 5xx/503, unexpected success statuses, and malformed success bodies retain the exact text, `File`, and request UUID. The composer locks that payload and offers an explicit **Retry same reply** using the same identity and file. A 409 is shown as a conflict without automatic resend or a new UUID; **Start a new reply** explicitly releases the retained conflict while preserving the visible draft/file for editing.
- Validation and authorization errors use sanitized messages. A 401/403 clears protected reply/composer state and refreshes authority; 404 clears the protected parent state. Existing pagination, removal confirmation and moderation retry handling remain in place.
- Reply images load through credentialed `fetch` with `cache: no-store`; the client checks configured API origin and the exact community/post/reply image path, requires `image/jpeg`, and caps the blob at 2 MiB. It displays a local blob URL without Next’s optimizer. Reads abort and blob URLs revoke on image replacement, row removal, access loss, account change, or unmount. Images remain uncropped and responsive with a 40rem height cap and accessible author-based labels. Load failure and unavailable states are announced.

## Changed files

- `frontend/src/components/CommunityPostReplies.tsx`
- `frontend/src/components/CommunityPostReplyImage.tsx`
- `frontend/src/lib/postReplyImages.ts`
- `frontend/src/types/posts.ts`
- `frontend/e2e/community-posts.spec.ts`
- `frontend/e2e/announcement-replies.spec.ts`
- `frontend/tests/community-post-replies.test.mjs`
- `docs/etudsup-pr3-post-reply-images-frontend.md`

No backend, migration, module-resource, shared account, dependency, or Announcement implementation files changed.

## Verification

- Passed: `npm run lint`
- Passed: `npx tsc --noEmit --incremental false`
- Passed: `node tests/community-post-replies.test.mjs` (4 checks: UUIDv4, 5 MiB cap, confirmation shape, private-route/origin validation)
- Passed: one normal `npm run build`
- The build's existing `prebuild` hook copied `pdfjs-dist`'s worker to the untracked `frontend/public/pdf.worker.min.mjs`; it remains in the worktree as a build artifact.
- Passed: Playwright focused spec discovery (`--list`) for community and Announcement reply specs.
- Browser execution was blocked before test launch: the frontend production server could not bind port 3000 (`listen EPERM: operation not permitted 0.0.0.0:3000`). No backend or owner service was started. Visual acceptance is pending; no browser result is claimed.

Focused browser cases were added for text, text-plus-image and image-only submission, replacement/removal, a held request and duplicate submit events, 503 retry with the same UUID/file, 409 conflict handling, media failure, removal/blob cleanup, logout cleanup, and direct account change. They are listed by Playwright but remain unexecuted due to the local server bind blocker.

## PR4 handoff

Run the focused community/Announcement browser cases when a local browser server can bind. Review the post detail and composer at **320px**, **390px**, and **1440px** in light and dark themes. Confirm the image remains within the reply card without horizontal scrolling, and verify private image loading, retry identity, reply removal, and logout/account-switch cleanup. Confirm Announcement reply requests remain text-only. Then report visual acceptance and any browser-case failures; do not run the full release suite for this handoff.
