# ETUDSUP PR4 — Post-reply image focused acceptance

## Status

PR2/PR3 implementation is present. PR4.1 corrects the six failures from the owner’s focused browser run and preserves its four passes. **Browser acceptance and responsive visual review remain pending** because the owner’s `127.0.0.1:3170` server is not reachable from this environment. The owner PostgreSQL suite passed 3/3; it was not rerun. No screenshot was produced or inspected here.

## Changed files

- `frontend/src/components/CommunityPostReplies.tsx` — show access-loss feedback outside the composer when that composer is hidden; stop mirroring visible errors into a second polite live region.
- `frontend/e2e/community-posts.spec.ts` — use the pending submit name and assert disabled state; scope error checks to the visible alert and guard against duplicate live announcements; use the actual Delegate moderation label/confirmation; hold a private-media 403 and assert content, draft, file, and blob URLs clear after auth refresh.
- `docs/etudsup-pr4-post-reply-images-acceptance.md` — this report.

No backend implementation, migration, shared acceptance file, dependency, or service was changed. The focused Playwright config added during PR4 remains unchanged. Concurrent MR3 files were preserved.

## Owner browser failures and corrections

The owner run against `http://127.0.0.1:3170` reported **4 passed, 6 failed**. The supplied `error-context.md` snapshots were inspected before making changes:

- **17 — selector only.** During a held request, the accessible button name changes to `Posting Reply...` and the button is disabled. The test searched only for `Post Reply`. It now locates the same submit control by either name and asserts the pending name/disabled state, while retaining the one-request and identical UUID/text/file retry checks.
- **18 and 23 — strict-selector ambiguity plus a demonstrated announcement duplication.** The error-context shows the visible `role=alert` and the same text in `#post-reply-image-feedback[aria-live=polite]`. The hidden live region duplicated the alert message. It now announces image selection state only; errors are announced once by the existing visible alert. Tests scope to that alert and assert one matching live announcement.
- **20 and 21 — stale selector only.** The actual row action is `Remove reply`; it opens the existing confirmation dialog, whose confirm button is also named `Remove reply`. Both fixtures already supplied an ACTIVE Delegate; the tests now exercise that actual button and confirmation path and keep the blob cleanup/account-switch assertions.
- **22 — implementation feedback placement defect, with protected-state cleanup already working.** Its error snapshot contains no reply text and no composer, so the callback had cleared protected state. It also set the access-loss message, but the message lived inside the composer hidden by `isAccessDenied`. The alert now renders outside that composer. The regression holds the 403 until it has a loaded private image and a pending draft/file, then checks reply text, composer, draft preview, both blob URLs, and auth refresh.

The four owner-passing cases were #19, #24, and the two Announcement cases (#6 and #11). Announcement behavior remains text-only.

## Executed checks

- Frontend `npm run lint`: passed after PR4.1 changes.
- Frontend `npx tsc --noEmit --incremental false`: passed after PR4.1 changes.
- Frontend `node tests/community-post-replies.test.mjs`: **4 passed**.
- `npm run build`: passed after the UI feedback change. Its prebuild recopied the existing untracked `frontend/public/pdf.worker.min.mjs` artifact.
- Playwright selector discovery: **10 cases in 2 files** (community cases 17–24 and Announcement cases 6 and 11). Discovery did not launch a browser and is not execution.
- Browser execution was not possible here: a read-only check found no listener at `127.0.0.1:3170`, and the supplied owner URL could not be reached. No browser startup was attempted.

Earlier PR4 focused backend results were: normal application import passed; **58** reply-image API/guard, community post, and Announcement tests passed; **12** processor/storage/service tests passed; **20** community post/removal regressions passed. Those suites used the established heartbeat. PR4.1 did not rerun them.

## PostgreSQL result

Owner PostgreSQL evidence is preserved at:

- `/tmp/irm-profile-evidence-vrak_6fg/profile-result.json` — suite `post-reply-images-postgresql`, **3 passed**, 0 failures/errors/skips, `pytest_exit_status: 0`, cleanup verified owned schema dropped and temporary storage removed.
- `/tmp/etudsup-pr4-58335b83a9854f18a416559f7426a0b4.jsonl` — four fresh schema leases for that run ID; the harness verified and dropped owned schemas.

The earlier PR4 connection failure is superseded by this owner pass. No PostgreSQL rerun is needed for these selector/UI corrections.

## Browser and visual review pending

The config starts no API or frontend server, and the two specs abort unmatched `/api/` requests so mocks cannot fall through to an owner API. After the successful build, the owner’s production server must serve this new build before rerunning; no service was stopped or restarted here.

Owner command once a PR3-capable frontend URL is available:

```fish
cd /home/yasso/irm-platform/frontend
set -lx ETUDSUP_PR4_FRONTEND_URL http://127.0.0.1:3170
npx playwright test --config playwright.post-reply-images.config.ts
```

Run this against the rebuilt production server. The config selects only 10 cases: text-only/text+image/image-only creation, selection/replacement/cancel/removal, single-flight and same-UUID/text/file retry, conflict behavior, private-media failure/route/decode checks, removal/account/access-loss cleanup, blob URL replacement cleanup, and unchanged Announcement composer/request behavior.

Finite manual owner checklist:

1. Run the focused Playwright command and resolve only failures in these 10 selected cases; do not start or restart owner services for this run.
2. Inspect the community post composer and reply images at **320px**, **390px**, and **1440px**, in light and dark themes. Check card containment, no horizontal overflow, long-text wrapping, uncropped aspect ratio, keyboard labels/focus, 44px controls, and loading/error placement relative to actions and mobile navigation.
3. Confirm no unexpected `/api/` request was attempted and Announcement POST remains JSON `{content}` with no image picker.
4. Retain the supplied PostgreSQL pass evidence; no rerun is needed for PR4.1.

No browser screenshot paths are reported because no browser session ran.

## Acceptance conclusion

- **Implementation status:** PR2 backend and PR3 frontend remain present; PR4.1 fixes the demonstrated feedback visibility/live-region issue and test selectors. Frontend build passes.
- **Acceptance status:** PostgreSQL checks are owner-passed. **Pending** rerun of the 10 focused browser cases against the rebuilt production server and responsive light/dark visual review. The feature is not marked fully accepted.
