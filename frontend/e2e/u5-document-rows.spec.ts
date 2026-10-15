import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const api = '**/api/v1';
const slug = 'algebra';
const longTitle = 'A very long document title about polynomial methods and worked examples '.repeat(4);
const moduleRecord = { id: 'module-1', community_id: 'irm', name: 'Algebra', slug, created_at: '2026-01-01', updated_at: '2026-01-01' };
const approved = { id: 'approved-1', module_id: 'module-1', uploader_id: 'author-1', title: longTitle, type: 'COURSE', source: 'STUDENT', status: 'APPROVED', created_at: '2026-02-01T12:00:00Z', updated_at: '2026-02-01T12:00:00Z' };

async function auth(page: Page) {
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: { id: 'reader-1', username: 'reader', email: 'reader@example.test', first_name: 'A', family_name: 'Reader' } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 200, json: { membership: { id: 'membership-1', status: 'ACTIVE', role: 'MEMBER' }, capabilities: {} } }));
  await page.route(`${api}/communities/irm/modules`, route => route.fulfill({ status: 200, json: [moduleRecord] }));
  await page.route(`${api}/communities/irm/modules/${slug}`, route => route.fulfill({ status: 200, json: moduleRecord }));
  await page.route(`${api}/communities/irm/documents/${approved.id}/saved`, route => route.fulfill({ status: 200, json: { saved: false } }));
}

async function capture(page: Page, name: string, width: number, theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
  mkdirSync('test-results/u5/captures', { recursive: true });
  await page.screenshot({ path: `test-results/u5/captures/${name}-${width}-${theme}.png`, fullPage: true });
}

test('module results have separate neutral borders, safe links, wrapping, filters and return state', async ({ page }) => {
  await auth(page);
  const requests: URL[] = [];
  await page.route(`${api}/communities/irm/modules/${slug}/documents**`, route => {
    requests.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, json: [approved, { ...approved, id: 'approved-2', title: 'Second document' }] });
  });
  await page.route(`${api}/communities/irm/modules/${slug}/documents/${approved.id}`, route => route.fulfill({ status: 200, json: approved }));
  await page.goto(`/communities/irm/modules/${slug}`);
  const rows = page.locator('section[aria-label="Module documents"] article');
  await expect(rows).toHaveCount(2);
  const first = rows.first();
  await expect(first).toHaveCSS('border-top-width', '1px');
  await expect(first).toHaveCSS('box-shadow', 'none');
  await expect(first.getByRole('link', { name: /A very long document title/ })).toBeVisible();
  await expect(first.getByRole('button', { name: 'Save document' })).toBeVisible();
  expect(await first.getByRole('link', { name: /A very long document title/ }).locator('button').count()).toBe(0);
  const gap = await rows.evaluateAll(nodes => nodes[1].getBoundingClientRect().top - nodes[0].getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(8);

  await page.getByRole('searchbox', { name: 'Search documents' }).fill('  polynomial  ');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Type').selectOption('COURSE');
  await expect.poll(() => requests.at(-1)?.searchParams.get('q')).toBe('polynomial');
  await expect.poll(() => requests.at(-1)?.searchParams.get('type')).toBe('COURSE');
  await first.getByRole('link', { name: /A very long document title/ }).click();
  await expect(page.getByRole('link', { name: 'Back to module documents' })).toHaveAttribute('href', /q=polynomial.*type=COURSE/);
  await page.getByRole('link', { name: 'Back to module documents' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search documents' })).toHaveValue('polynomial');
  await expect(page.getByLabel('Type')).toHaveValue('COURSE');
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.getByRole('searchbox', { name: 'Search documents' })).toHaveValue('');
});

test('module rows fit 320px and capture 390px and 1440px in both themes', async ({ page }) => {
  await auth(page);
  await page.route(`${api}/communities/irm/modules/${slug}/documents**`, route => route.fulfill({ status: 200, json: [approved, { ...approved, id: 'approved-2', title: 'Second document' }] }));
  await page.goto(`/communities/irm/modules/${slug}`);
  await expect(page.getByRole('link', { name: /A very long document title/ })).toBeVisible();
  for (const width of [390, 1440]) for (const theme of ['light', 'dark'] as const) await capture(page, 'module', width, theme);
  await page.setViewportSize({ width: 320, height: 760 });
  await expect(page.getByText('Change module')).toBeVisible();
  for (const name of ['Search', 'Clear filters']) {
    const button = page.getByRole('button', { name, exact: name === 'Search' }).first();
    expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  const row = page.locator('section[aria-label="Module documents"] article').first();
  expect((await row.boundingBox())?.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(320);
  await row.getByRole('link', { name: /A very long document title/ }).focus();
  await expect(row.getByRole('link', { name: /A very long document title/ })).toBeFocused();
});

test('personal rows retain saved, recent and submission-specific metadata and gates', async ({ page }) => {
  await auth(page);
  const shared = { id: approved.id, module_id: 'module-1', module_slug: slug, module_name: 'Algebra', title: longTitle, type: 'COURSE', source: 'STUDENT' };
  let removed = false;
  await page.route(`${api}/communities/irm/documents/saved?*`, route => route.fulfill({ status: 200, json: { items: removed ? [] : [{ ...shared, document_created_at: approved.created_at, saved_at: '2026-03-01T10:00:00Z' }], next_cursor: null } }));
  await page.route(`${api}/communities/irm/documents/${approved.id}/saved`, route => {
    if (route.request().method() === 'DELETE') removed = true;
    return route.fulfill({ status: 200, json: { saved: !removed } });
  });
  await page.route(`${api}/communities/irm/documents/recent?*`, route => route.fulfill({ status: 200, json: { items: [{ ...shared, last_page: 7, last_opened_at: '2026-04-02T10:30:00Z' }], next_cursor: null } }));
  await page.route(`${api}/communities/irm/documents/mine?*`, route => route.fulfill({ status: 200, json: { items: [
    { ...shared, status: 'APPROVED', created_at: approved.created_at, updated_at: approved.updated_at },
    { ...shared, id: 'pending-1', title: 'Pending handout', status: 'PENDING', created_at: approved.created_at, updated_at: approved.updated_at },
    { ...shared, id: 'rejected-1', title: 'Rejected handout', status: 'REJECTED', created_at: approved.created_at, updated_at: approved.updated_at },
  ], next_cursor: null } }));

  await page.goto('/communities/irm/documents/saved');
  const saved = page.locator('article').filter({ hasText: longTitle });
  await expect(saved).toHaveCSS('border-top-width', '1px');
  await expect(saved.getByRole('button', { name: 'Remove from saved' })).toBeVisible();
  await capture(page, 'saved', 390, 'light');
  await capture(page, 'saved', 1440, 'dark');
  await saved.getByRole('button', { name: 'Remove from saved' }).click();
  await expect(saved).toHaveCount(0);

  await page.goto('/communities/irm/documents/recent');
  const recent = page.locator('article').filter({ hasText: longTitle });
  await expect(recent).toContainText('Last page: 7');
  await expect(recent.locator('time')).toHaveAttribute('dateTime', '2026-04-02T10:30:00Z');
  await capture(page, 'recent', 390, 'light');
  await capture(page, 'recent', 1440, 'dark');

  await page.goto('/communities/irm/documents/mine');
  const pending = page.locator('article').filter({ hasText: 'Pending handout' });
  const rejected = page.locator('article').filter({ hasText: 'Rejected handout' });
  await expect(pending).toContainText('Awaiting review');
  await expect(pending.getByRole('link', { name: 'Open first-page preview' })).toBeVisible();
  await expect(rejected).toContainText('Not approved');
  await expect(rejected.getByRole('link', { name: /Read document|preview/i })).toHaveCount(0);
  await capture(page, 'submissions', 390, 'light');
  await capture(page, 'submissions', 1440, 'dark');
});
