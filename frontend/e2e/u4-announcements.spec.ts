import { expect, test, type Page } from '@playwright/test';

const firstId = 'a0000000-0000-4000-8000-000000000001';
const secondId = 'a0000000-0000-4000-8000-000000000002';
const replyId = 'a0000000-0000-4000-8000-000000000003';
const first = { id: firstId, title: 'Latest real notice', content: 'First line.\nSecond line with <script>plain text</script>.', author_username: 'actual_author', created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T10:00:00Z' };
const second = { ...first, id: secondId, title: 'Earlier notice', content: 'A quieter update.', created_at: '2026-10-10T10:00:00Z' };
const reply = { id: replyId, announcement_id: firstId, author_username: 'real_replier', content: 'Reply body', created_at: '2026-10-11T11:00:00Z' };

async function mockSession(page: Page, role: 'MEMBER' | 'DELEGATE' = 'MEMBER') {
  // The suite never sends an unmatched API request to an owner backend.
  await page.route('**/api/**', route => route.abort());
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 200, json: { id: 'actor', username: 'reader', email: 'private@example.invalid' } }));
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ status: 200, json: {
    membership: { id: 'membership', status: 'ACTIVE', role },
    capabilities: { create_announcements: role === 'DELEGATE' },
  } }));
  await page.route('**/api/v1/communities/irm/modules', route => route.fulfill({ status: 200, json: [] }));
}

test('API-first feature is unique, safe and links to readable detail', async ({ page }) => {
  await mockSession(page);
  await page.route('**/api/v1/communities/irm/announcements', route => route.fulfill({ status: 200, json: [first, second] }));
  await page.route(`**/api/v1/communities/irm/announcements/${firstId}`, route => route.fulfill({ status: 200, json: first }));
  await page.route(`**/api/v1/communities/irm/announcements/${firstId}/replies?limit=20`, route => route.fulfill({ status: 200, json: { items: [], next_cursor: null } }));
  await page.goto('/communities/irm/announcements');
  const cards = page.locator('main article').filter({ has: page.locator('a[aria-label^="Announcement:"]') });
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Latest');
  await expect(cards.first()).toContainText('actual_author');
  await expect(cards.first()).toContainText('Oct 11, 2026');
  await expect(cards.first()).not.toContainText('IRM administration');
  await expect(page.locator('main script')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Announcement: Latest real notice' }).click();
  await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible();
  await expect(page.getByText(first.content, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to Announcements/ })).toHaveAttribute('href', '/communities/irm/announcements');
});

test('request error is distinct from empty, and retry restores the list', async ({ page }) => {
  await mockSession(page);
  let calls = 0;
  await page.route('**/api/v1/communities/irm/announcements', route => {
    calls++;
    return route.fulfill(calls === 1 ? { status: 500, json: { detail: 'Temporary failure' } } : { status: 200, json: [] });
  });
  await page.goto('/communities/irm/announcements');
  await expect(page.getByRole('button', { name: 'Retry Loading' })).toBeVisible();
  await expect(page.getByText('No announcements published yet.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry Loading' }).click();
  await expect(page.getByText('No announcements published yet.')).toBeVisible();
});

test('delegate removal stays in parent header and reply pagination preserves content', async ({ page }) => {
  await mockSession(page, 'DELEGATE');
  await page.route('**/api/v1/communities/irm/announcements', route => route.fulfill({ status: 200, json: [first] }));
  await page.route(`**/api/v1/communities/irm/announcements/${firstId}`, route => route.fulfill({ status: 200, json: first }));
  await page.route(`**/api/v1/communities/irm/announcements/${firstId}/replies**`, route => {
    const later = route.request().url().includes('after=');
    return route.fulfill({ status: 200, json: { items: later ? [{ ...reply, id: secondId, content: 'Next reply' }] : [reply], next_cursor: later ? null : replyId } });
  });
  let removedReply = false;
  await page.route(`**/api/v1/communities/irm/announcements/${firstId}/replies/${replyId}`, route => {
    if (route.request().method() !== 'DELETE') return route.abort();
    removedReply = true;
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/communities/irm/announcements');
  const card = page.locator('main article').filter({ has: page.getByRole('link', { name: 'Announcement: Latest real notice' }) });
  const actions = card.getByRole('button', { name: /Actions for Latest real notice/ });
  await expect(actions).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove announcement' })).toHaveCount(0);
  await actions.click();
  await card.getByRole('button', { name: 'Remove announcement' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(actions).toBeFocused();
  await page.getByRole('link', { name: 'Announcement: Latest real notice' }).click();
  await expect(page.getByText('Reply body')).toBeVisible();
  await page.getByRole('button', { name: 'Load more replies' }).click();
  await expect(page.getByText('Next reply')).toBeVisible();
  await page.getByRole('button', { name: /Actions for Reply by @real_replier/ }).click();
  await page.getByRole('button', { name: 'Remove reply' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove reply' }).click();
  await expect(page.getByText('Reply body')).toHaveCount(0);
  expect(removedReply).toBe(true);
});

test('320px layouts remain bounded and action targets stay usable in both themes', async ({ page }) => {
  await mockSession(page, 'DELEGATE');
  await page.route('**/api/v1/communities/irm/announcements', route => route.fulfill({ status: 200, json: [{ ...first, title: 'Long '.repeat(35) }] }));
  await page.setViewportSize({ width: 320, height: 640 });
  for (const preference of ['light', 'dark']) {
    await page.addInitScript(value => localStorage.setItem('irm-theme', value), preference);
    await page.goto('/communities/irm/announcements');
    const trigger = page.getByRole('button', { name: /Actions for Long/ });
    await expect(trigger).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('capture list and detail at mobile and desktop sizes in both appearances', async ({ page }, testInfo) => {
  await mockSession(page);
  await page.route('**/api/v1/communities/irm/announcements', route => route.fulfill({ status: 200, json: [first, second] }));
  await page.route(`**/api/v1/communities/irm/announcements/${firstId}`, route => route.fulfill({ status: 200, json: first }));
  await page.route(`**/api/v1/communities/irm/announcements/${firstId}/replies?limit=20`, route => route.fulfill({ status: 200, json: { items: [reply], next_cursor: null } }));
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const preference of ['light', 'dark']) {
      await page.addInitScript(value => localStorage.setItem('irm-theme', value), preference);
      await page.goto('/communities/irm/announcements');
      await expect(page.getByRole('link', { name: 'Announcement: Latest real notice' })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`list-${width}-${preference}.png`), fullPage: true });
      await page.getByRole('link', { name: 'Announcement: Latest real notice' }).click();
      await expect(page.getByText('Reply body')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`detail-${width}-${preference}.png`), fullPage: true });
    }
  }
});
