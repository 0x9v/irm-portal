import { test, expect, type Page } from '@playwright/test';

const api = '**/api/v1';
const slug = 'intro-physics';
const moduleData = { id: 'module-id', community_id: 'irm', name: 'Introduction to Physics', slug };
const documentData = {
  id: 'approved-doc', title: 'A long title that should wrap instead of widening the page '.repeat(2),
  module_id: moduleData.id, uploader_id: 'uploader', type: 'COURSE', source: 'OFFICIAL',
  status: 'APPROVED', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
};

async function mockAuth(page: Page) {
  await page.route('**/api/**', route => route.abort());
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 200, json: {
    id: 'member-id', username: 'student', email: 'student@example.test', first_name: 'Account', family_name: 'Name',
  } }));
  await page.route(`${api}/communities/irm/membership/me`, route => route.fulfill({ status: 200, json: {
    membership: { id: 'membership-id', status: 'ACTIVE', role: 'MEMBER' }, capabilities: {},
  } }));
  await page.route(`${api}/communities/irm/modules/${slug}`, route => route.fulfill({ status: 200, json: moduleData }));
  await page.route(`${api}/communities/irm/modules/${slug}/resources**`, route => route.fulfill({ status: 200, json: { items: [{
    id: documentData.id, module_id: documentData.module_id, kind: 'PDF', title: documentData.title,
    description: null, category: documentData.type, document_type: documentData.type, source: documentData.source,
    status: documentData.status, created_at: documentData.created_at, updated_at: documentData.updated_at,
  }], next_cursor: null } }));
  await page.route(`${api}/communities/irm/modules/${slug}/documents**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/documents')) return route.fulfill({ status: 200, json: [documentData] });
    return route.fallback();
  });
  await page.route(`${api}/communities/irm/modules/${slug}/documents/approved-doc`, route => route.fulfill({ status: 200, json: documentData }));
  await page.route(`${api}/documents/approved-doc/view`, route => route.fulfill({ status: 404 }));
}

test('direct approved-document visit has a safe module return and invalid context cannot redirect', async ({ page }) => {
  await mockAuth(page);
  await page.goto(`/communities/irm/modules/${slug}/documents/approved-doc?from=https%3A%2F%2Fevil.example&q=waves&type=TD&source=STUDENT&returnTo=https%3A%2F%2Fevil.example`);
  const back = page.getByRole('link', { name: 'Back to module documents' });
  await expect(back).toHaveAttribute('href', `/communities/irm/modules/${slug}?q=waves&type=TD&source=STUDENT&from=module`);
  await expect(page.getByRole('link', { name: 'Introduction to Physics' })).toHaveAttribute('href', `/communities/irm/modules/${slug}?q=waves&type=TD&source=STUDENT&from=module`);
  await expect(page.getByText('Cours', { exact: true })).toBeVisible();
  await expect(page.getByText('Official', { exact: true })).toBeVisible();
});

test('module filters survive opening an approved document and returning', async ({ page }) => {
  await mockAuth(page);
  await page.goto(`/communities/irm/modules/${slug}?q=waves&type=COURSE&source=OFFICIAL`);
  await expect(page.getByRole('searchbox', { name: 'Search resources' })).toHaveValue('waves');
  await expect(page.getByRole('option', { name: 'Cours' })).toBeAttached();
  const read = page.getByRole('link', { name: 'Read Document' });
  await expect(read).toHaveAttribute('href', new RegExp(`from=module.*q=waves.*category=COURSE.*kind=PDF.*source=OFFICIAL`));
  await read.click();
  await expect(page.getByRole('heading', { name: documentData.title })).toBeVisible();
  await page.getByRole('link', { name: 'Back to module documents' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?q=waves&category=COURSE&kind=PDF&source=OFFICIAL&from=module$`));
  await expect(page.getByRole('searchbox', { name: 'Search resources' })).toHaveValue('waves');
});

test('My Submissions and pending contexts return to their own authorized lists', async ({ page }) => {
  await mockAuth(page);
  await page.route(`${api}/communities/irm/resources/mine**`, route => route.fulfill({ status: 200, json: {
    items: [{ id: 'approved-doc', module_id: moduleData.id, module_slug: slug, module_name: moduleData.name,
      title: 'Approved upload', kind: 'PDF', category: 'COURSE', document_type: 'COURSE',
      can_delete: false, description: null, source: 'OFFICIAL', status: 'APPROVED',
      created_at: documentData.created_at, updated_at: documentData.updated_at }], next_cursor: null,
  } }));
  await page.goto('/communities/irm/documents/mine');
  await expect(page.getByRole('link', { name: moduleData.name })).toHaveAttribute('href', `/communities/irm/modules/${slug}?from=mine`);
  await page.getByRole('link', { name: 'Read document' }).click();
  await page.getByRole('link', { name: 'Back to My Submissions' }).click();
  await expect(page.getByRole('heading', { name: 'My Submissions' })).toBeVisible();

  await page.route(`${api}/communities/irm/resources/pending**`, route => route.fulfill({ status: 200, json: { items: [{
    id: 'pending-doc', kind: 'PDF', title: 'Pending upload', document_type: 'TD', description: null,
    source: 'STUDENT', status: 'PENDING', created_at: documentData.created_at, updated_at: documentData.updated_at,
    module_id: moduleData.id, module_slug: slug, module_name: moduleData.name,
    is_uploader: false, my_vote: null, can_vote: true, can_approve: false, can_delete: false, full_resource_access: false,
    preview: { url: '/api/v1/communities/irm/resources/pending-doc/preview', media_type: 'image/png' },
  }], next_cursor: null } }));
  await page.goto('/communities/irm/documents/pending');
  await page.getByRole('link', { name: moduleData.name }).click();
  await page.getByRole('link', { name: 'Read Document' }).click();
  await page.getByRole('link', { name: 'Back to Pending Documents' }).click();
  await expect(page.getByRole('heading', { name: 'Pending Resources' })).toBeVisible();
});

test('long titles wrap at 320px and metadata controls remain keyboard-visible in both themes', async ({ page }) => {
  await mockAuth(page);
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto(`/communities/irm/modules/${slug}`);
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((node, value) => node.setAttribute('data-theme', value), theme);
    await expect(page.getByRole('heading', { name: documentData.title })).toBeVisible();
    expect(await page.locator('body').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(320);
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
  }
});
