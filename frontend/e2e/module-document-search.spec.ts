import { test, expect } from '@playwright/test';

const api = '**/api/v1';
const moduleSlug = 'algebre-1';
const baseDocuments = [
  { id: 'doc-1', title: 'Cours Polynômes', module_id: 'mod-1', uploader_id: 'u-1', type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-01-01', updated_at: '2026-01-01' },
  { id: 'doc-2', title: 'TD Polynômes', module_id: 'mod-1', uploader_id: 'u-2', type: 'TD', source: 'STUDENT', status: 'APPROVED', created_at: '2026-01-02', updated_at: '2026-01-02' },
];
const baseResources = baseDocuments.map(doc => ({
  id: doc.id, module_id: doc.module_id, kind: 'PDF', title: doc.title, description: null,
  category: doc.type, document_type: doc.type, source: doc.source, status: doc.status,
  created_at: doc.created_at, updated_at: doc.updated_at,
}));

async function openModule(page: import('@playwright/test').Page) {
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: {
    id: 'u-1', username: 'student', email: 'student@example.test', first_name: 'User', family_name: 'Account',
  } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 200, json: {
    membership: { id: 'm-1', status: 'ACTIVE', role: 'MEMBER' }, capabilities: {},
  } }));
  await page.route(`${api}/communities/irm/modules/${moduleSlug}`, route => route.fulfill({ status: 200, json: {
    id: 'mod-1', community_id: 'c-1', name: 'Algebra I', slug: moduleSlug,
    created_at: '2026-01-01', updated_at: '2026-01-01',
  } }));
  await page.goto(`/communities/irm/modules/${moduleSlug}`);
  await expect(page.getByRole('heading', { name: 'Algebra I' })).toBeVisible();
  await expect(page.getByText('Cours Polynômes')).toBeVisible();
}

test('search submits encoded title and exact filters; clear restores the unfiltered list', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  const requested: URL[] = [];
  await page.route(`${api}/communities/irm/modules/${moduleSlug}/resources**`, route => {
    requested.push(new URL(route.request().url()));
    return route.fulfill({ status: 200, json: { items: baseResources, next_cursor: null } });
  });
  await page.route(`${api}/communities/irm/modules/${moduleSlug}/documents**`, async route => {
    requested.push(new URL(route.request().url()));
    await route.fulfill({ status: 200, json: baseDocuments });
  });
  await openModule(page);
  await page.getByRole('searchbox', { name: 'Search resources' }).fill('  50%_ off  ');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect.poll(() => requested.some(url => url.searchParams.get('q') === '50%_ off')).toBe(true);
  await page.getByLabel('Format').selectOption('PDF');
  await page.getByLabel('Catégorie').selectOption('TD');
  await expect.poll(() => requested.some(url => url.searchParams.get('category') === 'TD' && url.searchParams.get('q') === '50%_ off')).toBe(true);
  await page.getByLabel('Source').selectOption('STUDENT');
  await expect.poll(() => requested.some(url => url.searchParams.get('source') === 'STUDENT' && url.searchParams.get('category') === 'TD')).toBe(true);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect.poll(() => requested.at(-1)?.searchParams.get('kind')).toBe(null);
});

test('filtered empty, ordinary empty, and retry error states remain distinct', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  let mode: 'normal' | 'empty' = 'normal';
  let failNext = false;
  await page.route(`${api}/communities/irm/modules/${moduleSlug}/resources**`, async route => {
    if (failNext) { failNext = false; return route.fulfill({ status: 500, json: { detail: 'Unavailable' } }); }
    return route.fulfill({ status: 200, json: { items: mode === 'empty' ? [] : baseResources, next_cursor: null } });
  });
  await page.route(`${api}/communities/irm/modules/${moduleSlug}/documents**`, async route => {
    if (failNext) {
      failNext = false;
      return route.fulfill({ status: 500, json: { detail: 'Unavailable' } });
    }
    await route.fulfill({ status: 200, json: mode === 'empty' ? [] : baseDocuments });
  });
  await openModule(page);
  mode = 'empty';
  await page.getByLabel('Format').selectOption('PDF');
  await page.getByLabel('Catégorie').selectOption('EXAM');
  await expect(page.getByText('No resources match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).last().click();
  await expect(page.getByText('No resources found for this module yet.')).toBeVisible();
  mode = 'normal';
  failNext = true;
  await page.getByRole('searchbox', { name: 'Search resources' }).fill('draft');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Failed to load resources');
  await expect(page.getByRole('searchbox', { name: 'Search resources' })).toHaveValue('draft');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Cours Polynômes')).toBeVisible();
});

test('a delayed earlier search cannot replace a newer result', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  let releaseSlow!: () => void;
  let slowStarted = false;
  const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
  await page.route(`${api}/communities/irm/modules/${moduleSlug}/resources**`, async route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'slow') {
      slowStarted = true;
      await slowGate;
      try {
        await route.fulfill({ status: 200, json: { items: [{ ...baseResources[0], id: 'slow-doc', title: 'Slow result' }], next_cursor: null } });
      } catch { /* The page may correctly abort this stale request. */ }
      return;
    }
    if (q === 'fast') return route.fulfill({ status: 200, json: { items: [{ ...baseResources[0], id: 'fast-doc', title: 'Fast result' }], next_cursor: null } });
    return route.fulfill({ status: 200, json: { items: baseResources, next_cursor: null } });
  });
  await openModule(page);
  await page.getByRole('searchbox', { name: 'Search resources' }).fill('slow');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect.poll(() => slowStarted).toBe(true);
  await page.getByRole('searchbox', { name: 'Search resources' }).fill('fast');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Fast result')).toBeVisible();
  releaseSlow();
  await expect(page.getByText('Fast result')).toBeVisible();
  await expect(page.getByText('Slow result')).toHaveCount(0);
});

test('controls are keyboard reachable and fit a 320px light and dark viewport', async ({ page }) => {
  await page.route('**/api/**', route => route.abort());
  await page.route(`${api}/communities/irm/modules/${moduleSlug}/resources**`, route => route.fulfill({ status: 200, json: { items: baseResources, next_cursor: null } }));
  await openModule(page);
  await page.setViewportSize({ width: 320, height: 760 });
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
    await expect(page.getByLabel('Search resources')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    const width = await page.locator('body').evaluate(node => node.scrollWidth);
    expect(width).toBeLessThanOrEqual(320);
  }
});
