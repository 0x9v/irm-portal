import { test, expect, type Page } from '@playwright/test';

const base = '**/api/v1/communities/irm/resources';
const id = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const route = (n: number) => `/api/v1/communities/irm/resources/${id(n)}/preview`;
const common = { module_id: 'd0000000-0000-4000-8000-000000000001', module_slug: 'intro-physics', module_name: 'Physics',
  description: null, source: 'STUDENT', status: 'PENDING', created_at: '2026-10-14T12:00:00Z', updated_at: '2026-10-14T12:00:00Z',
  is_uploader: false, my_vote: null, can_vote: true, can_approve: false, can_delete: false, full_resource_access: false };
const pdf = { ...common, id: id(1), kind: 'PDF', title: 'PDF notes', category: 'COURSE', document_type: 'COURSE', preview: { url: route(1), media_type: 'image/png' } };
const legacy = { ...common, id: id(2), kind: 'IMAGE', title: 'Legacy image', category: 'OTHER', preview_url: route(2), preview: { url: route(2), media_type: 'image/png' }, full_resource_access: true };
const image = { ...common, id: id(3), kind: 'IMAGE', title: 'Canonical image', category: 'TD', preview_url: route(3), preview: { url: route(3), media_type: 'image/webp' }, full_resource_access: true };
const youtube = { ...common, id: id(4), kind: 'YOUTUBE', title: 'Video', category: null, video_id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  preview: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, full_resource_access: true };
const link = { ...common, id: id(5), kind: 'LINK', title: 'Guide', category: 'TP', url: 'https://example.org/guide',
  preview: { url: 'https://example.org/guide' }, full_resource_access: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

async function setup(page: Page, rows: unknown[] = [pdf]) {
  await page.route('**/api/**', route => route.abort());
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { id: 'member-1', username: 'member', email: 'member@example.test', first_name: 'A', family_name: 'Member' } }));
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ json: { membership: { id: 'membership-1', status: 'ACTIVE', role: 'MEMBER' },
    capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false } } }));
  await page.route(`${base}/pending**`, route => route.fulfill({ json: { items: rows, next_cursor: null } }));
  await page.goto('/communities/irm/documents/pending');
  await expect(page.getByRole('heading', { name: 'Pending Resources' })).toBeVisible();
}

test('four kinds, PNG/WebP protected previews and safe outbound destinations', async ({ page }) => {
  await setup(page, [pdf, legacy, image, youtube, link]);
  for (const row of [pdf, legacy, image, youtube, link]) await expect(page.getByRole('heading', { name: row.title })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: image.title })).toContainText('Catégorie: TD');
  await expect(page.getByRole('article').filter({ hasText: youtube.title })).toContainText('Catégorie: Non classé');
  await page.route(`**${route(1)}`, route => route.fulfill({ body: png, contentType: 'image/png' }));
  await page.route(`**${route(2)}`, route => route.fulfill({ body: png, contentType: 'image/png' }));
  await page.route(`**${route(3)}`, route => route.fulfill({ body: webp, contentType: 'image/webp' }));
  await page.getByRole('article').filter({ hasText: pdf.title }).getByRole('button', { name: 'Load preview' }).click();
  await expect(page.getByAltText('First page preview of PDF notes')).toBeVisible();
  await page.getByRole('article').filter({ hasText: legacy.title }).getByRole('button', { name: 'Load preview' }).click();
  await expect(page.getByAltText('Image preview of Legacy image')).toBeVisible();
  await page.getByRole('article').filter({ hasText: image.title }).getByRole('button', { name: 'Load preview' }).click();
  await expect(page.getByAltText('Image preview of Canonical image')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('link', { name: 'Open example.org' })).toHaveAttribute('href', 'https://example.org/guide');
  await expect(page.getByRole('button', { name: 'Download Original' })).toHaveCount(0);
});

test('pending deletion is offered only by server capability and confirms the resource', async ({ page }) => {
  let removed = false;
  await setup(page, [{ ...pdf, is_uploader: true, can_vote: false, can_delete: true }, link]);
  await expect(page.getByRole('article').filter({ hasText: link.title }).getByRole('button', { name: 'Delete resource' })).toHaveCount(0);
  const own = page.getByRole('article').filter({ hasText: pdf.title });
  await own.getByRole('button', { name: 'Delete resource' }).click();
  await expect(page.getByRole('dialog')).toContainText(pdf.title);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.route(`${base}/pending**`, route => route.fulfill({ json: { items: removed ? [link] : [{ ...pdf, is_uploader: true, can_vote: false, can_delete: true }, link], next_cursor: null } }));
  let calls = 0;
  await page.route(`${base}/${id(1)}`, route => { calls++; removed = true; return route.fulfill({ status: 204 }); });
  await own.getByRole('button', { name: 'Delete resource' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete resource' }).click();
  await expect(own).toHaveCount(0);
  expect(calls).toBe(1);
});

test('delete control and confirmation fit light and dark review layouts', async ({ page }) => {
  await setup(page, [{ ...image, can_delete: true, can_vote: false, is_uploader: true }]);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 780 });
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
      const button = page.getByRole('button', { name: 'Delete resource' });
      await expect(button).toBeVisible();
      await button.focus();
      await expect(button).toBeFocused();
      await button.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await page.locator('body').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(width);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    }
  }
});

test('server flags gate controls; vote uses exact body and single flight, preserves PDF YES download', async ({ page }) => {
  await setup(page, [pdf, { ...legacy, is_uploader: true, can_vote: false }, { ...link, my_vote: 'NO', can_vote: false }]);
  await expect(page.getByRole('article').filter({ hasText: legacy.title }).getByRole('button', { name: /YES/ })).toHaveCount(0);
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`${base}/${id(1)}/vote`, async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ vote: 'YES' });
    await held;
    await route.fulfill({ json: { vote: 'YES', full_resource_access: true } });
  });
  const yes = page.getByRole('article').filter({ hasText: pdf.title }).getByRole('button', { name: /YES/ });
  await yes.click();
  await expect(yes).toBeDisabled();
  await yes.dispatchEvent('click');
  expect(requests).toBe(1);
  release();
  await expect(page.getByText(/Vote recorded for/)).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Download Original' })).toBeVisible();
});

test('staff approval confirms exact empty body; cancel and 409 refresh never repeat the mutation', async ({ page }) => {
  await setup(page, [{ ...link, can_approve: true }]);
  let approvals = 0, reads = 0;
  await page.route(`${base}/pending**`, route => { reads++; return route.fulfill({ json: { items: [{ ...link, can_approve: true }], next_cursor: null } }); });
  await page.getByRole('button', { name: 'Approve resource' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(approvals).toBe(0);
  await page.getByRole('button', { name: 'Approve resource' }).click();
  await page.route(`${base}/${id(5)}/approve`, route => {
    approvals++; expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ status: 409, json: { detail: 'Conflict' } });
  });
  await page.getByRole('button', { name: 'Approve resource' }).last().click();
  await expect.poll(() => reads).toBeGreaterThan(0);
  expect(approvals).toBe(1);
});

test('uncertain vote stays blocked until explicit refresh; invalid feed and preview fail closed', async ({ page }) => {
  await setup(page, [pdf]);
  let votes = 0;
  await page.route(`${base}/${id(1)}/vote`, route => { votes++; return route.abort(); });
  await page.getByRole('button', { name: /YES/ }).click();
  await expect(page.getByText(/outcome could not be confirmed/)).toBeVisible();
  await expect(page.getByRole('button', { name: /YES/ })).toBeDisabled();
  expect(votes).toBe(1);
  await page.route(`${base}/pending**`, route => route.fulfill({ json: { items: [{ ...pdf, preview: { url: 'https://evil.test/a', media_type: 'image/png' } }], next_cursor: null } }));
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(page.getByRole('heading', { name: pdf.title })).toHaveCount(0);
  await expect(page.getByText(/could not be loaded/)).toBeVisible();
  expect(votes).toBe(1);
});

test('private preview access loss clears pending rows and actions', async ({ page }) => {
  await setup(page, [pdf]);
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ status: 403, json: { detail: 'Membership lost' } }));
  await page.route(`**${route(1)}`, route => route.fulfill({ status: 403, json: { detail: 'Forbidden' } }));
  await page.getByRole('button', { name: 'Load preview' }).click();
  await expect(page.getByRole('heading', { name: pdf.title })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /YES/ })).toHaveCount(0);
});

test('cursor pagination de-duplicates rows and explicit refresh resets the cursor', async ({ page }) => {
  await setup(page, [pdf]);
  const cursors: Array<string | null> = [];
  await page.route(`${base}/pending**`, route => {
    const after = new URL(route.request().url()).searchParams.get('after');
    cursors.push(after);
    return route.fulfill({ json: after
      ? { items: [pdf, link], next_cursor: null }
      : { items: [pdf], next_cursor: id(1) } });
  });
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await page.getByRole('button', { name: 'Load more resources' }).click();
  await expect(page.getByRole('heading', { name: pdf.title })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: link.title })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(page.getByRole('heading', { name: link.title })).toHaveCount(0);
  expect(cursors).toEqual([null, id(1), null]);
});

test('staff approval succeeds once; uncertain approval requires a fresh read', async ({ page }) => {
  await setup(page, [{ ...link, can_approve: true }]);
  let approvals = 0;
  await page.route(`${base}/${id(5)}/approve`, route => {
    approvals++;
    return route.abort();
  });
  await page.getByRole('article').getByRole('button', { name: 'Approve resource' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve resource' }).click();
  await expect(page.getByText(/outcome could not be confirmed/).first()).toBeVisible();
  expect(approvals).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Refresh and check' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.route(`${base}/${id(5)}/approve`, route => {
    approvals++;
    expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: { id: id(5), status: 'APPROVED' } });
  });
  await page.route(`${base}/pending**`, route => route.fulfill({ json: { items: approvals > 1 ? [] : [{ ...link, can_approve: true }], next_cursor: null } }));
  await page.getByRole('article').getByRole('button', { name: 'Approve resource' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve resource' }).click();
  await expect(page.getByText(/was approved/)).toBeVisible();
  expect(approvals).toBe(2);
  await expect(page.getByRole('heading', { name: link.title })).toHaveCount(0);
});
