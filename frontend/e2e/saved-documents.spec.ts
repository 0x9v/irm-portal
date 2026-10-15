import { test, expect, type Page } from '@playwright/test';

const api = '**/api/v1';
const docId = 'doc-approved-1';
const item = {
  id: docId, module_id: 'mod-1', module_slug: 'algebre-1', module_name: 'Algebra I',
  title: 'Saved polynomial notes', type: 'COURSE', source: 'OFFICIAL',
  document_created_at: '2026-01-02T00:00:00Z', saved_at: '2026-02-03T00:00:00Z',
};

async function auth(page: Page, userId = 'user-1') {
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: {
    id: userId, username: userId, email: `${userId}@example.test`, first_name: 'Account', family_name: 'Name',
  } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 404, json: { detail: 'No membership' } }));
}

test('approved document save remains authoritative after reload and can be removed', async ({ page }) => {
  await auth(page);
  let saved = false;
  await page.route(`${api}/communities/irm/modules/algebre-1`, route => route.fulfill({ status: 200, json: {
    id: 'mod-1', community_id: 'community-1', name: 'Algebra I', slug: 'algebre-1', created_at: '2026-01-01', updated_at: '2026-01-01',
  } }));
  await page.route(`${api}/communities/irm/modules/algebre-1/documents`, route => route.fulfill({ status: 200, json: [
    { id: docId, title: item.title, module_id: 'mod-1', uploader_id: 'uploader-1', type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED', created_at: item.document_created_at, updated_at: item.document_created_at },
  ] }));
  await page.route(`${api}/communities/irm/documents/${docId}/saved`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, json: { saved } });
    if (route.request().method() === 'PUT') { saved = true; return route.fulfill({ status: 200, json: { saved } }); }
    if (route.request().method() === 'DELETE') { saved = false; return route.fulfill({ status: 200, json: { saved } }); }
  });
  await page.goto('/communities/irm/modules/algebre-1');
  await page.getByRole('button', { name: 'Save document' }).click();
  await expect(page.getByRole('button', { name: 'Saved · Remove' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Saved · Remove' })).toBeVisible();
  await page.getByRole('button', { name: 'Saved · Remove' }).click();
  await expect(page.getByRole('button', { name: 'Save document' })).toBeVisible();
});

test('saved page distinguishes empty and request failure, with retry', async ({ page }) => {
  await auth(page);
  let fail = true;
  await page.route(`${api}/communities/irm/documents/saved?*`, async route => {
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { detail: 'Unavailable' } }); }
    return route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
  });
  await page.goto('/communities/irm/documents/saved');
  await expect(page.getByRole('alert')).toContainText('Could not load saved documents');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('You have no saved documents yet.')).toBeVisible();
});

test('saved list renders safe approved links and remove actions', async ({ page }) => {
  await auth(page);
  await page.route(`${api}/communities/irm/documents/saved?*`, route => route.fulfill({ status: 200, json: { items: [item], next_cursor: null } }));
  await page.route(`${api}/communities/irm/documents/${docId}/saved`, route => route.fulfill({ status: 200, json: { saved: false } }));
  await page.goto('/communities/irm/documents/saved');
  await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open document' })).toHaveAttribute('href', /algebre-1\/documents\/doc-approved-1/);
  await expect(page.getByRole('button', { name: 'Remove from saved' })).toBeVisible();
  await expect(page.getByText('Course')).toBeVisible();
});

test('load more appends pages and uncertain removal checks the list before another request', async ({ page }) => {
  await auth(page);
  let failRemoval = true;
  let removals = 0;
  let pageCalls = 0;
  await page.route(`${api}/communities/irm/documents/saved?*`, async route => {
    pageCalls += 1;
    if (new URL(route.request().url()).searchParams.has('after')) {
      return route.fulfill({ status: 200, json: { items: [item, { ...item, id: 'doc-approved-2', title: 'Second saved document' }], next_cursor: null } });
    }
    return route.fulfill({ status: 200, json: { items: [item], next_cursor: 'save-cursor-1' } });
  });
  await page.route(`${api}/communities/irm/documents/${docId}/saved`, async route => {
    removals += 1;
    if (failRemoval) { failRemoval = false; return route.fulfill({ status: 503, json: { detail: 'Temporary failure' } }); }
    return route.fulfill({ status: 200, json: { saved: false } });
  });
  await page.goto('/communities/irm/documents/saved');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText(item.title)).toHaveCount(1);
  await expect(page.getByText('Second saved document')).toBeVisible();
  await page.getByRole('button', { name: 'Remove from saved' }).first().click();
  await expect(page.getByRole('alert')).toContainText('Removal could not be confirmed');
  await expect(page.getByText(item.title)).toBeVisible();
  await page.getByRole('button', { name: 'Refresh saved list' }).click();
  await expect(page.getByText(item.title)).toBeVisible();
  expect(removals).toBe(1);
  await page.getByRole('button', { name: 'Remove from saved' }).first().click();
  await expect(page.getByText(item.title)).toHaveCount(0);
  expect(removals).toBe(2);
  expect(pageCalls).toBe(3);
});

test('account change clears previous private list and controls remain usable at 320px', async ({ page }) => {
  let account = 'user-1';
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: {
    id: account, username: account, email: `${account}@example.test`, first_name: 'Account', family_name: 'Name',
  } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 404, json: { detail: 'No membership' } }));
  await page.route(`${api}/communities/irm/documents/saved?*`, route => route.fulfill({ status: 200, json: { items: account === 'user-1' ? [item] : [], next_cursor: null } }));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/communities/irm/documents/saved');
  await expect(page.getByText(item.title)).toBeVisible();
  account = 'user-2';
  await page.reload();
  await expect(page.getByText(item.title)).toHaveCount(0);
  const widths = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: window.innerWidth }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
});
