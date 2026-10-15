import { expect, test, type Page, type WebSocketRoute } from './moderation-fixtures';

const userId = '00000000-0000-4000-8000-000000000001';
const assetId = '20000000-0000-4000-8000-000000000001';
const messageId = '30000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const asset = { id: assetId, preview_url: `/api/v1/auth/me/stickers/${assetId}/image`, width: 256, height: 256, media_type: 'image/webp', byte_size: 1200, created_at: '2026-10-13T10:00:00Z' };
const customMessage = (id = messageId) => ({ id, kind: 'CUSTOM_STICKER', content: null, sticker_id: null, custom_sticker_id: assetId, author_id: userId, author_username: 'student', created_at: '2026-10-13T10:00:00Z', reactions: [], caller_reaction: null });
const onePixelWebp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');

async function auth(page: Page, status = 'ACTIVE') {
  // Keep every mocked sticker test isolated from owner/application APIs.
  await page.route('**/api/**', route => route.abort());
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { id: userId, username: 'student', email: 'student@example.test' } }));
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ json: { membership: { id: 'membership-1', status, role: 'MEMBER' }, capabilities: {} } }));
  await page.route('**/api/v1/communities/irm/discussion/stickers', route => route.fulfill({ json: [{ id: 'pepe_thumbs_up', name: 'Thumbs Up', description: 'Encouraging' }] }));
  await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', route => route.fulfill({ json: { items: [customMessage()], older_cursor: 'cursor-one', has_more_older: true, newer_cursor: null, has_more_newer: false } }));
  await page.route('**/api/v1/communities/irm/discussion/messages?limit=30&before=*', route => route.fulfill({ json: { items: [{ ...customMessage('30000000-0000-4000-8000-000000000002'), author_id: otherId, author_username: 'other' }], older_cursor: null, has_more_older: false, newer_cursor: null, has_more_newer: false } }));
}

test('private stickers upload without sending, paginate, remove, and send the exact custom contract', async ({ page }) => {
  await auth(page);
  let listCalls = 0;
  let postPayload: Record<string, unknown> | null = null;
  let uploadParts = '';
  await page.route('**/api/v1/auth/me/stickers**', async route => {
    if (route.request().method() === 'POST') {
      uploadParts = `${route.request().headers()['content-type'] ?? ''}\n${route.request().postData() ?? ''}`;
      await route.fulfill({ status: 201, json: { ...asset, id: '20000000-0000-4000-8000-000000000002' } });
    } else {
      listCalls++;
      await route.fulfill({ json: { items: [asset], next_cursor: listCalls === 1 ? 'cursor-next' : null } });
    }
  });
  await page.route('**/api/v1/auth/me/stickers/*/image', route => route.fulfill({ status: 200, contentType: 'image/webp', body: onePixelWebp }));
  await page.route('**/api/v1/communities/irm/discussion/messages', async route => {
    if (route.request().method() === 'POST') {
      postPayload = route.request().postDataJSON() as Record<string, unknown>;
      const confirmed = customMessage('30000000-0000-4000-8000-000000000003');
      socket?.send(JSON.stringify({ type: 'message_created', community_slug: 'irm', message: confirmed }));
      await route.fulfill({ status: 201, json: confirmed });
    } else await route.fallback();
  });
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', route => { socket = route; });
  await page.goto('/communities/irm/discussion');
  await page.getByRole('button', { name: 'Choose a sticker' }).click();
  await page.getByRole('tab', { name: 'My stickers' }).click();
  await expect(page.getByRole('button', { name: 'Send this custom sticker' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect.poll(() => listCalls).toBe(2);
  await expect(page.locator('[data-message-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Add sticker' }).click();
  await page.getByLabel('Choose a PNG or JPEG sticker image').setInputFiles({ name: 'alpha.png', mimeType: 'image/png', buffer: Buffer.from('png-fixture') });
  await expect(page.getByText(/PNG transparency is preserved/)).toBeVisible();
  await page.getByRole('button', { name: 'Upload sticker' }).click();
  await expect.poll(() => uploadParts).toContain('multipart/form-data; boundary=');
  expect(uploadParts).toContain('name="file"; filename="alpha.png"');
  expect(uploadParts).not.toContain('name="author_id"');
  await expect(page.getByRole('button', { name: 'Send this custom sticker' })).toBeVisible();
  expect(postPayload).toBeNull();

  await page.getByRole('button', { name: 'Send this custom sticker' }).click();
  await expect.poll(() => postPayload).not.toBeNull();
  expect(postPayload).toMatchObject({ kind: 'CUSTOM_STICKER', custom_sticker_id: assetId });
  expect(Object.keys(postPayload ?? {}).sort()).toEqual(['client_message_id', 'custom_sticker_id', 'kind']);
  await expect(page.locator('[data-message-id="30000000-0000-4000-8000-000000000003"]')).toHaveAttribute('data-message-owner', 'current');
  await expect(page.locator('[data-message-id]')).toHaveCount(2);
  expect(socket).toBeTruthy();
});

test('quota feedback recommends library removal without automatically sending', async ({ page }) => {
  await auth(page);
  let uploads = 0;
  await page.route('**/api/v1/auth/me/stickers**', route => {
    if (route.request().method() === 'POST') {
      uploads++;
      return route.fulfill({ status: 409, json: { detail: { code: 'sticker_quota_exceeded' } } });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});
  await page.goto('/communities/irm/discussion');
  await page.getByRole('button', { name: 'Choose a sticker' }).click();
  await page.getByRole('tab', { name: 'My stickers' }).click();
  await page.getByRole('button', { name: 'Add sticker' }).click();
  await page.getByLabel('Choose a PNG or JPEG sticker image').setInputFiles({ name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpeg-fixture') });
  await page.getByRole('button', { name: 'Upload sticker' }).click();
  await expect(page.getByRole('alert')).toContainText('library is full');
  await expect(page.getByRole('alert')).toContainText('Remove a sticker');
  expect(uploads).toBe(1);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('tab', { name: 'My stickers' })).toBeVisible();
});

test('custom sticker retry is single-flight, reports busy state, and reuses the same client ID and asset UUID', async ({ page }) => {
  await auth(page);
  await page.route('**/api/v1/auth/me/stickers**', route => route.fulfill({ json: { items: [asset], next_cursor: null } }));
  const sends: Record<string, unknown>[] = [];
  let releaseRetry!: () => void;
  let retryEntered!: () => void;
  const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
  const retryStarted = new Promise<void>(resolve => { retryEntered = resolve; });
  await page.route('**/api/v1/communities/irm/discussion/messages', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    sends.push(route.request().postDataJSON() as Record<string, unknown>);
    if (sends.length === 1) return route.fulfill({ status: 500, json: { detail: 'temporary failure' } });
    if (sends.length === 2) {
      retryEntered();
      await retryGate;
    }
    return route.fulfill({ status: 200, json: customMessage('30000000-0000-4000-8000-000000000003') });
  });
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});
  await page.goto('/communities/irm/discussion');
  await page.getByRole('button', { name: 'Choose a sticker' }).click();
  await page.getByRole('tab', { name: 'My stickers' }).click();
  await page.getByRole('button', { name: 'Send this custom sticker' }).click();
  const retryButton = page.getByRole('button', { name: 'Retry' });
  await retryButton.click();
  await retryStarted;
  await expect(retryButton).toBeDisabled();
  await expect(retryButton).toContainText('Retrying');
  expect(sends).toHaveLength(2);
  releaseRetry();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(sends[1]).toMatchObject({ kind: 'CUSTOM_STICKER', custom_sticker_id: assetId });
});

test('sticker picker supports keyboard tabs and nonmodal focus dismissal', async ({ page }) => {
  await auth(page);
  await page.route('**/api/v1/auth/me/stickers**', route => route.fulfill({ json: { items: [asset], next_cursor: null } }));
  await page.route('**/api/v1/auth/me/stickers/*/image', route => route.fulfill({ status: 200, contentType: 'image/webp', body: onePixelWebp }));
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/communities/irm/discussion');

  const trigger = page.getByRole('button', { name: 'Choose a sticker' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Sticker picker' });
  const builtIn = page.getByRole('tab', { name: 'Built-in' });
  const mine = page.getByRole('tab', { name: 'My stickers' });
  await expect(dialog).toBeVisible();
  const dialogBounds = await dialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(320);
  await expect(dialog).not.toHaveAttribute('aria-modal', 'true');
  await expect(builtIn).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(mine).toBeFocused();
  await expect(mine).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Choose a PNG or JPEG sticker image')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add sticker' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Send this custom sticker' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send this custom sticker' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Remove sticker from library' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(mine).toBeFocused();
  await page.getByRole('button', { name: 'Close sticker picker' }).click();
  await expect(trigger).toBeFocused();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(mine).toBeFocused();
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.click();
  await expect(dialog).toBeHidden();
  await expect(input).toBeFocused();
});

test('uncertain upload asks for a library refresh and does not replay upload', async ({ page }) => {
  await auth(page);
  let uploads = 0;
  let lists = 0;
  await page.route('**/api/v1/auth/me/stickers**', route => {
    if (route.request().method() === 'POST') { uploads++; return route.abort(); }
    lists++;
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});
  await page.goto('/communities/irm/discussion');
  await page.getByRole('button', { name: 'Choose a sticker' }).click();
  await page.getByRole('tab', { name: 'My stickers' }).click();
  await page.getByRole('button', { name: 'Add sticker' }).click();
  await page.getByLabel('Choose a PNG or JPEG sticker image').setInputFiles({ name: 'maybe.png', mimeType: 'image/png', buffer: Buffer.from('png-fixture') });
  await page.getByRole('button', { name: 'Upload sticker' }).click();
  await expect(page.getByRole('alert')).toContainText('outcome could not be confirmed');
  await page.getByRole('button', { name: 'Refresh library' }).click();
  await expect.poll(() => lists).toBe(2);
  expect(uploads).toBe(1);
});

test('removing a library item leaves its visible conversation sticker using message-scoped media', async ({ page }) => {
  await auth(page, 'ACTIVE');
  let removed = 0;
  await page.route('**/api/v1/auth/me/stickers**', route => {
    if (route.request().method() === 'DELETE') { removed++; return route.fulfill({ status: 204, body: '' }); }
    return route.fulfill({ json: { items: [asset], next_cursor: null } });
  });
  let conversationMedia = 0;
  await page.route(`**/api/v1/communities/irm/discussion/messages/${messageId}/sticker`, route => { conversationMedia++; return route.fulfill({ status: 200, contentType: 'image/webp', body: onePixelWebp }); });
  await page.route('**/api/v1/auth/me/stickers/*/image', route => route.fulfill({ status: 200, contentType: 'image/webp', body: onePixelWebp }));
  await page.goto('/communities/irm/discussion');
  await expect(page.getByText('Manage your private sticker library')).toBeVisible();
  await page.getByRole('button', { name: 'Choose a sticker' }).click();
  await page.getByRole('tab', { name: 'My stickers' }).click();
  await page.getByRole('button', { name: 'Remove sticker from library' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove sticker?' });
  await expect(dialog).toContainText('Messages already sent will keep it.');
  await dialog.getByRole('button', { name: 'Remove sticker' }).click();
  await expect.poll(() => removed).toBe(1);
  expect(conversationMedia).toBe(1);
  await expect(page.locator(`[data-message-id="${messageId}"]`)).toHaveAttribute('data-message-owner', 'current');
});

test('non-member can open and manage the private sticker library without Discussion access', async ({ page }) => {
  await auth(page, 'BANNED');
  await page.route('**/api/v1/auth/me/stickers**', route => route.fulfill({ json: { items: [asset], next_cursor: null } }));
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});
  await page.goto('/communities/irm/discussion');
  await expect(page.getByText('Manage your private sticker library')).toBeVisible();
  await page.getByRole('button', { name: 'Choose a sticker' }).click();
  await page.getByRole('tab', { name: 'My stickers' }).click();
  await expect(page.getByRole('button', { name: 'Remove sticker from library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send this custom sticker' })).toBeDisabled();
});
