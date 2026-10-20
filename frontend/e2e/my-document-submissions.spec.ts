import { test, expect, type Page } from '@playwright/test';

const api = '**/api/v1';
const items = [
  { id: 'pending-id', module_id: 'm1', module_slug: 'algebra', module_name: 'Algebra', title: 'Pending handout', kind: 'PDF', category: 'TD', document_type: 'TD', can_delete: true, description: null, source: 'STUDENT', status: 'PENDING', created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z' },
  { id: 'approved-id', module_id: 'm2', module_slug: 'physics', module_name: 'Physics', title: 'Approved notes', kind: 'PDF', category: 'COURSE', document_type: 'COURSE', can_delete: false, description: null, source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-03-01T10:00:00Z', updated_at: '2026-03-01T10:00:00Z' },
  { id: 'rejected-id', module_id: 'm1', module_slug: 'algebra', module_name: 'Algebra', title: 'Rejected exam', kind: 'PDF', category: 'EXAM', document_type: 'EXAM', can_delete: true, description: null, source: 'STUDENT', status: 'REJECTED', created_at: '2026-02-01T10:00:00Z', updated_at: '2026-02-01T10:00:00Z' },
];

async function mockAuth(page: Page, identity: { id: string; username: string }) {
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: {
    id: identity.id, username: identity.username, email: `${identity.username}@example.test`, first_name: 'User', family_name: 'Account',
  } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 200, json: {
    membership: { id: `membership-${identity.id}`, status: 'ACTIVE', role: 'MEMBER' }, capabilities: {},
  } }));
}

async function openPage(page: Page, response: (url: URL) => Promise<unknown> | unknown = () => ({ items, next_cursor: null })) {
  await page.route('**/api/**', route => route.abort());
  await mockAuth(page, { id: 'user-1', username: 'student' });
  await page.route(`${api}/communities/irm/resources/mine**`, async route => {
    try {
      const body = await response(new URL(route.request().url()));
      await route.fulfill({ status: 200, json: body });
    } catch {
      await route.abort();
    }
  });
  await page.goto('/communities/irm/documents/mine');
  await expect(page.getByRole('heading', { name: 'My Submissions' })).toBeVisible();
}

test('shows truthful mixed statuses, module links, and status-gated file actions', async ({ page }) => {
  await openPage(page);
  await expect(page.getByText('Pending handout')).toBeVisible();
  await expect(page.getByText('Approved notes')).toBeVisible();
  await expect(page.getByText('Rejected exam')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Algebra' }).first()).toHaveAttribute('href', '/communities/irm/modules/algebra?from=mine');
  await expect(page.getByRole('link', { name: 'Read document' })).toHaveAttribute('href', '/communities/irm/modules/physics/documents/approved-id?from=mine');
  await expect(page.getByRole('link', { name: 'Open first-page preview' })).toHaveAttribute('href', /\/api\/v1\/documents\/pending-id\/preview/);
  const rejectedCard = page.locator('article').filter({ hasText: 'Rejected exam' });
  await expect(rejectedCard.getByRole('link', { name: 'Read document' })).toHaveCount(0);
  await expect(rejectedCard.getByRole('link', { name: 'Open first-page preview' })).toHaveCount(0);
  await expect(page.getByText('This student submission remains pending while community votes are collected.')).toBeVisible();
  await expect(page.getByText('This resource is not available in the module.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete resource' })).toHaveCount(2);
});

test('separates empty and filtered-empty states and keeps loading/error retry local', async ({ page }) => {
  let release!: () => void;
  let markHeld!: () => void;
  const heldRequest = new Promise<void>(resolve => { markHeld = resolve; });
  let hold = true;
  let failNext = false;
  await mockAuth(page, { id: 'user-1', username: 'student' });
  await page.route(`${api}/communities/irm/resources/mine**`, async route => {
    const url = new URL(route.request().url());
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    }
    if (hold) {
      markHeld();
      await new Promise<void>(resolve => { release = resolve; });
      hold = false;
    }
    await route.fulfill({ status: 200, json: url.searchParams.has('status') ? { items: [], next_cursor: null } : { items: [], next_cursor: null } });
  });
  await page.goto('/communities/irm/documents/mine');
  await expect(page.getByRole('status')).toContainText('Loading your submissions');
  await heldRequest;
  release();
  await expect(page.getByText('You have not submitted any resources.')).toBeVisible();
  await page.getByLabel('Status').selectOption('REJECTED');
  await expect(page.getByText('No submissions match this filter.')).toBeVisible();

  failNext = true;
  await page.getByLabel('Status').selectOption('');
  await expect(page.getByRole('alert')).toContainText('Failed to load submissions');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('You have not submitted any resources.')).toBeVisible();
});

test('paginates and retries the same page without adding duplicate rows', async ({ page }) => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({ ...items[0], id: `pending-${index}`, title: `Submission ${index}` }));
  let failNextPage = true;
  const requestedCursors: (string | null)[] = [];
  await openPage(page, url => {
    const cursor = url.searchParams.get('after');
    requestedCursors.push(cursor);
    if (!cursor) return { items: firstPage, next_cursor: 'cursor-20' };
    if (failNextPage) {
      failNextPage = false;
      throw new Error('PAGE_FAIL');
    }
    return { items: [firstPage[19], { ...items[1], id: 'last-id', title: 'Last submission' }], next_cursor: null };
  });
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('alert')).toContainText('Failed to load more submissions');
  await expect(page.getByText('Submission 0')).toBeVisible();
  await page.getByRole('button', { name: 'Retry this page' }).click();
  await expect(page.getByText('Last submission')).toBeVisible();
  await expect(page.getByText('Submission 19')).toHaveCount(1);
  expect(requestedCursors).toEqual([null, 'cursor-20', 'cursor-20']);
});

test('does not retain one account’s submissions after account change or logout', async ({ page }) => {
  let identity = { id: 'user-1', username: 'student' };
  let logoutResponse = false;
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: {
    ...identity, email: `${identity.username}@example.test`, first_name: 'User', family_name: 'Account',
  } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 200, json: {
    membership: { id: `membership-${identity.id}`, status: 'ACTIVE', role: 'MEMBER' }, capabilities: {},
  } }));
  await page.route(`${api}/communities/irm/resources/mine**`, route => route.fulfill({ status: 200, json: {
    items: [{ ...items[0], id: identity.id, title: `${identity.username} private upload` }], next_cursor: null,
  } }));
  await page.route(`${api}/auth/logout`, route => { logoutResponse = true; return route.fulfill({ status: 204 }); });

  await page.goto('/communities/irm/documents/mine');
  await expect(page.getByText('student private upload')).toBeVisible();
  identity = { id: 'user-2', username: 'another-student' };
  await page.reload();
  await expect(page.getByText('another-student private upload')).toBeVisible();
  await expect(page.getByText('student private upload')).toHaveCount(0);
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect.poll(() => logoutResponse).toBe(true);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/private upload/)).toHaveCount(0);
});

test('status controls work by keyboard and fit a 320px light/dark viewport', async ({ page }) => {
  await openPage(page);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 760 });
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
      await expect(page.getByLabel('Status')).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toBeVisible();
      expect(await page.locator('body').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
});

test('typed own submissions show independent category and format for every kind', async ({ page }) => {
  const typed = [
    items[0],
    { ...items[0], id: 'image-id', title: 'TD diagram', kind: 'IMAGE', preview_url: '/api/v1/communities/irm/resources/image-id/preview' },
    { ...items[0], id: 'youtube-id', title: 'TD video', kind: 'YOUTUBE', video_id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { ...items[2], id: 'link-id', title: 'Rejected link', kind: 'LINK', category: null, url: 'https://example.org/guide' },
    items[1],
  ];
  await openPage(page, () => ({ items: typed, next_cursor: null }));
  for (const row of typed.slice(0, 4)) {
    const card = page.locator('article').filter({ hasText: row.title });
    await expect(card.getByRole('button', { name: 'Delete resource' })).toBeVisible();
  }
  await expect(page.locator('article').filter({ hasText: 'Rejected link' })).toContainText('Non classé');
  await expect(page.locator('article').filter({ hasText: 'TD video' })).toContainText('Format: YOUTUBE');
  await expect(page.locator('article').filter({ hasText: 'Approved notes' }).getByRole('button', { name: 'Delete resource' })).toHaveCount(0);
});

test('own pending resource deletion confirms, stays single flight, and removes only after 204', async ({ page }) => {
  let deleted = false;
  await openPage(page, () => ({ items: deleted ? [items[1], items[2]] : items, next_cursor: null }));
  const pending = page.locator('article').filter({ hasText: 'Pending handout' });
  await expect(page.locator('article').filter({ hasText: 'Approved notes' }).getByRole('button', { name: 'Delete resource' })).toHaveCount(0);
  await pending.getByRole('button', { name: 'Delete resource' }).click();
  await expect(page.getByRole('dialog')).toContainText('Pending handout');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route(`${api}/communities/irm/resources/pending-id`, async route => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().postData()).toBeNull();
    calls++;
    await held;
    deleted = true;
    await route.fulfill({ status: 204 });
  });
  await pending.getByRole('button', { name: 'Delete resource' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete resource' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete resource' })).toBeDisabled();
  await expect(pending).toBeVisible();
  expect(calls).toBe(1);
  release();
  await expect(pending).toHaveCount(0);
  expect(calls).toBe(1);
});

test('approval conflict reconciles, while an uncertain delete remains unconfirmed', async ({ page }) => {
  let approved = false;
  await openPage(page, () => ({ items: [{ ...items[0], ...(approved ? { status: 'APPROVED', can_delete: false } : {}) }], next_cursor: null }));
  let calls = 0;
  await page.route(`${api}/communities/irm/resources/pending-id`, route => {
    calls++;
    approved = true;
    return route.fulfill({ status: 409, json: { detail: 'Approved resources cannot be deleted' } });
  });
  await page.getByRole('button', { name: 'Delete resource' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete resource' }).click();
  await expect(page.getByText('Approved resources cannot be deleted. Refreshing your submissions.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete resource' })).toHaveCount(0);
  expect(calls).toBe(1);

  approved = false;
  await page.getByRole('button', { name: 'Refresh submissions' }).click();
  await expect(page.getByRole('button', { name: 'Delete resource' })).toBeVisible();
  await page.unroute(`${api}/communities/irm/resources/pending-id`);
  await page.route(`${api}/communities/irm/resources/pending-id`, route => { calls++; return route.abort(); });
  await page.getByRole('button', { name: 'Delete resource' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete resource' }).click();
  await expect(page.getByRole('dialog')).toContainText('The outcome could not be confirmed');
  await expect(page.locator('article').filter({ hasText: 'Pending handout' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Refresh and check' }).click();
  expect(calls).toBe(2);
});
