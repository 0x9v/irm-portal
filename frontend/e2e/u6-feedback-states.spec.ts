import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const api = '**/api/v1';
const slug = 'algebra';
const moduleRecord = { id: 'module-1', community_id: 'irm', name: 'Algebra', slug, created_at: '2026-01-01', updated_at: '2026-01-01' };
const documentRecord = { id: 'doc-1', module_id: 'module-1', uploader_id: 'author', title: 'Algebra notes', type: 'COURSE', source: 'STUDENT', status: 'APPROVED', created_at: '2026-02-01', updated_at: '2026-02-01' };

async function session(page: Page, delegate = false) {
  await page.route('**/api/**', route => route.abort());
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: { id: 'account-1', username: 'student', email: 'student@example.test' } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 200, json: {
    membership: { id: 'membership-1', status: 'ACTIVE', role: delegate ? 'DELEGATE' : 'MEMBER' },
    capabilities: { create_announcements: delegate, manage_document_voting: delegate },
  } }));
  await page.route(`${api}/communities/irm/modules`, route => route.fulfill({ status: 200, json: [moduleRecord] }));
  await page.route(`${api}/communities/irm/modules/${slug}`, route => route.fulfill({ status: 200, json: moduleRecord }));
}

async function capture(page: Page, label: string, width: number, theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
  mkdirSync('test-results/u6/captures', { recursive: true });
  await page.screenshot({ path: `test-results/u6/captures/${label}-${width}-${theme}.png`, fullPage: true });
}

test('document loading, ordinary empty, filtered error and retry stay distinct', async ({ page }) => {
  await session(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route(`${api}/communities/irm/modules/${slug}/documents**`, async route => {
    calls++;
    if (calls === 1) { await held; return route.fulfill({ status: 200, json: [] }); }
    if (calls === 2) return route.fulfill({ status: 503, json: { detail: 'internal server trace' } });
    return route.fulfill({ status: 200, json: [] });
  });
  await page.goto(`/communities/irm/modules/${slug}`);
  await expect(page.getByText('Loading documents…', { exact: true })).toBeVisible();
  await expect(page.getByText('No documents found for this module yet.')).toHaveCount(0);
  release();
  await expect(page.getByText('No documents found for this module yet.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('polynomial');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Failed to load documents');
  await expect(page.getByRole('alert')).not.toContainText('internal server trace');
  await expect(page.getByRole('searchbox', { name: 'Search documents' })).toHaveValue('polynomial');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('No documents match these filters.')).toBeVisible();
  await capture(page, 'filtered-empty', 390, 'light');
  await capture(page, 'filtered-empty', 1440, 'dark');
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width);
    expect((await page.getByRole('button', { name: 'Clear filters' }).first().boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
});

test('announcement network uncertainty retains draft and offers a read-only check', async ({ page }) => {
  await session(page, true);
  let posts = 0;
  await page.route(`${api}/communities/irm/announcements`, route => {
    if (route.request().method() === 'POST') { posts++; return route.abort(); }
    return route.fulfill({ status: 200, json: [] });
  });
  await page.goto('/communities/irm/announcements');
  await expect(page.getByText('No announcements published yet.')).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('A real update');
  await page.getByLabel('Content', { exact: true }).fill('Keep this draft');
  await page.getByRole('button', { name: 'Post Announcement' }).click();
  await expect(page.getByRole('alert')).toContainText('could not confirm');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('A real update');
  await expect(page.getByLabel('Content', { exact: true })).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: 'Check announcements' }).click();
  expect(posts).toBe(1);
  await capture(page, 'announcement-uncertain', 390, 'light');
  await capture(page, 'announcement-uncertain', 1440, 'dark');
});

test('an uncertain Save mutation checks server state before another mutation', async ({ page }) => {
  await session(page);
  await page.route(`${api}/communities/irm/modules/${slug}/documents**`, route => route.fulfill({ status: 200, json: [documentRecord] }));
  let saved = false;
  let writes = 0;
  await page.route(`${api}/communities/irm/documents/${documentRecord.id}/saved`, route => {
    if (route.request().method() === 'PUT') { writes++; saved = true; return route.abort(); }
    return route.fulfill({ status: 200, json: { saved } });
  });
  await page.goto(`/communities/irm/modules/${slug}`);
  await page.getByRole('button', { name: 'Save document' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await page.getByRole('button', { name: 'Check saved status' }).click();
  await expect(page.getByRole('button', { name: 'Saved · Remove' })).toBeVisible();
  expect(writes).toBe(1);
});

test('voting settings associate field errors and reconcile an uncertain save by reading', async ({ page }) => {
  await session(page, true);
  let updates = 0;
  await page.route(`${api}/communities/irm/document-voting/settings`, route => {
    if (route.request().method() === 'PATCH') { updates++; return route.abort(); }
    return route.fulfill({ status: 200, json: { required_total_votes: 5 } });
  });
  await page.goto('/communities/irm/document-voting/settings');
  const field = page.getByLabel('Required Total Votes (Community Default)');
  await expect(field).toHaveValue('5');
  await field.fill('abc');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', 'threshold-error');
  await expect(page.locator('#threshold-error')).toContainText('positive whole number');
  expect(updates).toBe(0);
  await field.fill('7');
  await expect(field).toHaveAttribute('aria-invalid', 'false');
  await page.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText(/settings update could not be confirmed/i)).toBeVisible();
  await expect(field).toHaveValue('7');
  await page.getByRole('button', { name: 'Check settings' }).click();
  await expect(field).toHaveValue('5');
  expect(updates).toBe(1);
});
