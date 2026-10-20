import { test, expect, type Page } from '@playwright/test';

const slug = 'intro-physics';
const moduleId = 'd0000000-0000-4000-8000-000000000001';
const base = `**/api/v1/communities/irm/modules/${slug}`;
const mod = { id: moduleId, community_id: 'irm', slug, name: 'Introduction to Physics', created_at: '2026-10-14T12:00:00Z', updated_at: '2026-10-14T12:00:00Z' };
const common = { module_id: moduleId, description: null, source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-10-14T12:00:00Z', updated_at: '2026-10-14T12:00:00Z' };
const pdf = { ...common, id: 'a0000000-0000-4000-8000-000000000001', kind: 'PDF', title: 'PDF notes', category: 'TD', document_type: 'TD' };
const image = { ...common, id: 'a0000000-0000-4000-8000-000000000002', kind: 'IMAGE', title: 'Diagram', category: 'TD', preview_url: '/api/v1/communities/irm/resources/a0000000-0000-4000-8000-000000000002/preview' };
const youtube = { ...common, id: 'a0000000-0000-4000-8000-000000000003', kind: 'YOUTUBE', title: 'Video lesson', category: 'TD', video_id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
const link = { ...common, id: 'a0000000-0000-4000-8000-000000000004', kind: 'LINK', title: 'Reference guide', category: 'TD', url: 'https://example.org/guide' };
const unclassified = { ...common, id: 'a0000000-0000-4000-8000-000000000005', kind: 'LINK', title: 'Old link', category: null, url: 'https://example.org/old' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64');

async function setup(page: Page) {
  await page.route('**/api/**', route => route.abort());
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { id: 'member-1', username: 'member', email: 'member@example.test', first_name: 'A', family_name: 'Member' } }));
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ json: { membership: { id: 'membership-1', role: 'MEMBER', status: 'ACTIVE' }, capabilities: { upload_official_documents: false, create_announcements: false, manage_document_voting: false } } }));
  await page.route('**/api/v1/communities/irm/modules', route => route.fulfill({ json: [mod] }));
  await page.route(base, route => route.fulfill({ json: mod }));
  await page.route('**/api/v1/communities/irm/documents/**/saved', route => route.fulfill({ json: { saved: false } }));
}

test('one typed feed renders each kind once, private image and safe outbound actions', async ({ page }) => {
  await setup(page);
  await page.route(`${base}/resources**`, route => route.fulfill({ json: { items: [pdf, image, youtube, link], next_cursor: null } }));
  await page.route(`**${image.preview_url}`, route => route.fulfill({ status: 200, body: png, contentType: 'image/png' }));
  await page.goto(`/communities/irm/modules/${slug}`);
  for (const resource of [pdf, image, youtube, link]) await expect(page.getByRole('heading', { name: resource.title })).toHaveCount(1);
  await expect(page.getByAltText('Image resource: Diagram')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('link', { name: 'Open example.org' })).toHaveAttribute('href', 'https://example.org/guide');
  await expect(page.getByRole('button', { name: 'Save document' })).toHaveCount(1);
});

test('category comes before format and filters every kind without forcing PDF', async ({ page }) => {
  await setup(page);
  const requests: URL[] = [];
  await page.route(`${base}/resources**`, route => {
    const url = new URL(route.request().url()); requests.push(url);
    const category = url.searchParams.get('category');
    const kind = url.searchParams.get('kind');
    const source = url.searchParams.get('source');
    const q = url.searchParams.get('q');
    const rows = [pdf, image, youtube, link, unclassified].filter(item =>
      (!category || item.category === category) && (!kind || item.kind === kind) &&
      (!source || item.source === source) && (!q || item.title.includes(q)));
    return route.fulfill({ json: { items: rows, next_cursor: null } });
  });
  await page.goto(`/communities/irm/modules/${slug}`);
  const category = page.getByLabel('Catégorie');
  const format = page.getByLabel('Format');
  expect(await page.locator('form select').evaluateAll(nodes => nodes.map(node => node.id).slice(0, 2))).toEqual(['resource-category', 'resource-kind']);
  await expect(category.locator('option')).toHaveText(['Tous', 'Cours', 'TD', 'TP', 'Examen', 'Solution', 'Autre']);
  await expect(page.getByRole('heading', { name: unclassified.title })).toBeVisible();
  await expect(page.getByText('Non classé')).toBeVisible();
  await category.selectOption('TD');
  for (const item of [pdf, image, youtube, link]) await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: unclassified.title })).toHaveCount(0);
  expect(requests.some(url => url.searchParams.get('category') === 'TD' && !url.searchParams.has('kind'))).toBe(true);
  await format.selectOption('IMAGE');
  await expect(page.getByRole('heading', { name: image.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: pdf.title })).toHaveCount(0);
  expect(requests.some(url => url.searchParams.get('category') === 'TD' && url.searchParams.get('kind') === 'IMAGE')).toBe(true);
  await category.selectOption('');
  await expect(page.getByRole('heading', { name: image.title })).toBeVisible();
  expect(requests.some(url => !url.searchParams.has('category') && url.searchParams.get('kind') === 'IMAGE')).toBe(true);
  await format.selectOption('');
  await page.getByLabel('Source').selectOption('OFFICIAL');
  await page.getByLabel('Search resources').fill('PDF');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: pdf.title })).toBeVisible();
  expect(requests.some(url => url.searchParams.get('source') === 'OFFICIAL' && url.searchParams.get('q') === 'PDF')).toBe(true);
});

test('filter changes discard old pages and late responses; stale cursor reloads selected filters once', async ({ page }) => {
  await setup(page);
  const tpImage = { ...image, title: 'TP diagram', category: 'TP' };
  const tpLink = { ...link, title: 'TP guide', category: 'TP' };
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let tdStarted = false;
  let firstPageCount = 0;
  const requests: URL[] = [];
  await page.route(`${base}/resources**`, async route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.searchParams.get('category') === 'TD' && !url.searchParams.has('after') && !tdStarted) {
      tdStarted = true;
      await held;
      await route.fulfill({ json: { items: [pdf], next_cursor: null } }).catch(() => {});
      return;
    }
    if (url.searchParams.get('category') === 'TP') {
      if (url.searchParams.has('after')) return route.fulfill({ status: 404, json: { detail: 'Resource cursor not found' } });
      firstPageCount++;
      return route.fulfill({ json: firstPageCount === 1
        ? { items: [tpImage], next_cursor: tpImage.id }
        : { items: [tpLink], next_cursor: null } });
    }
    return route.fulfill({ json: { items: [unclassified], next_cursor: null } });
  });
  await page.goto(`/communities/irm/modules/${slug}`);
  await page.getByLabel('Catégorie').selectOption('TD');
  await expect.poll(() => tdStarted).toBe(true);
  await page.getByLabel('Catégorie').selectOption('TP');
  await expect(page.getByRole('heading', { name: tpImage.title })).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: pdf.title })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more resources' }).click();
  await expect(page.getByRole('heading', { name: tpLink.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: tpImage.title })).toHaveCount(0);
  expect(firstPageCount).toBe(2);
  expect(requests.filter(url => url.searchParams.get('category') === 'TP' && !url.searchParams.has('after')).length).toBe(2);
  await expect(page.getByLabel('Catégorie')).toHaveValue('TP');
});

test('first-page 404 remains a load error and does not enter cursor recovery', async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route(`${base}/resources**`, route => {
    reads++;
    return route.fulfill({ status: 404, json: { detail: 'Module not found' } });
  });
  await page.goto(`/communities/irm/modules/${slug}?category=TD`);
  await expect(page.getByRole('alert')).toContainText('Failed to load resources');
  expect(reads).toBe(1);
  await expect(page.getByLabel('Catégorie')).toHaveValue('TD');
});

test('kind/source filters, keyset load more and Back/Forward use validated URL state', async ({ page }) => {
  await setup(page);
  const requests: URL[] = [];
  await page.route(`${base}/resources**`, route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (url.searchParams.has('after')) return route.fulfill({ json: { items: [link], next_cursor: null } });
    return route.fulfill({ json: { items: [pdf], next_cursor: pdf.id } });
  });
  await page.goto(`/communities/irm/modules/${slug}`);
  await page.getByRole('button', { name: 'Load more resources' }).click();
  await expect(page.getByRole('heading', { name: link.title })).toBeVisible();
  expect(requests.some(url => url.searchParams.get('after') === pdf.id)).toBe(true);
  await page.getByLabel('Format').selectOption('PDF');
  await expect(page).toHaveURL(/kind=PDF/);
  await page.getByLabel('Catégorie').selectOption('TD');
  await expect(page).toHaveURL(/category=TD/);
  await page.getByLabel('Source').selectOption('OFFICIAL');
  await expect(page).toHaveURL(/source=OFFICIAL/);
  await page.goBack();
  await expect(page.getByLabel('Source')).toHaveValue('');
  await expect(page.getByLabel('Format')).toHaveValue('PDF');
  await expect(page.getByLabel('Catégorie')).toHaveValue('TD');
  await page.goBack();
  await expect(page.getByLabel('Catégorie')).toHaveValue('');
  await page.goForward();
  await expect(page.getByLabel('Catégorie')).toHaveValue('TD');
  await page.goForward();
  await expect(page.getByLabel('Source')).toHaveValue('OFFICIAL');
});

test('PDF opens existing reader with safe return context', async ({ page }) => {
  await setup(page);
  await page.route(`${base}/resources**`, route => route.fulfill({ json: { items: [pdf], next_cursor: null } }));
  await page.route(`${base}/documents/${pdf.id}`, route => route.fulfill({ json: { id: pdf.id, module_id: moduleId, uploader_id: 'uploader', title: pdf.title, type: 'TD', source: 'OFFICIAL', status: 'APPROVED', created_at: pdf.created_at, updated_at: pdf.updated_at } }));
  await page.goto(`/communities/irm/modules/${slug}?q=PDF&kind=PDF&source=OFFICIAL&from=module`);
  const read = page.getByRole('link', { name: 'Read Document' });
  await expect(read).toHaveAttribute('href', /from=module.*q=PDF.*kind=PDF.*source=OFFICIAL/);
  await read.click();
  await expect(page.getByRole('link', { name: 'Back to module documents' })).toHaveAttribute('href', /q=PDF.*kind=PDF.*source=OFFICIAL/);
});

test('invalid private image response is unavailable and account change hides old rows', async ({ page }) => {
  await setup(page);
  await page.route(`${base}/resources**`, route => route.fulfill({ json: { items: [image], next_cursor: null } }));
  await page.route(`**${image.preview_url}`, route => route.fulfill({ status: 200, body: 'not an image', contentType: 'text/plain' }));
  await page.goto(`/communities/irm/modules/${slug}`);
  await expect(page.getByText('Image unavailable.')).toBeVisible();
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, json: { detail: 'Unauthorized' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: image.title })).toHaveCount(0);
});

test('legacy image keeps its existing reader and save actions without duplicating its row', async ({ page }) => {
  await setup(page);
  await page.route(`${base}/resources**`, route => route.fulfill({ json: { items: [image], next_cursor: null } }));
  await page.route(`**${image.preview_url}`, route => route.fulfill({ status: 200, body: png, contentType: 'image/png' }));
  await page.route(`${base}/documents/${image.id}`, route => route.fulfill({ json: {
    id: image.id, module_id: moduleId, title: image.title, uploader_id: 'legacy-uploader',
    type: 'OTHER', source: 'OFFICIAL', status: 'APPROVED', created_at: image.created_at, updated_at: image.updated_at,
  } }));
  await page.goto(`/communities/irm/modules/${slug}`);
  await expect(page.getByRole('heading', { name: image.title })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open in document reader' })).toHaveAttribute('href', new RegExp(`/documents/${image.id}`));
  await expect(page.getByRole('button', { name: 'Save document' })).toBeVisible();
});

test('mixed rows and controls fit 320/390/1440px in light and dark themes', async ({ page }) => {
  await setup(page);
  await page.route(`${base}/resources**`, route => route.fulfill({ json: { items: [pdf, youtube, link], next_cursor: null } }));
  await page.goto(`/communities/irm/modules/${slug}`);
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    expect(await page.locator('body').evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByLabel('Catégorie')).toBeVisible();
    await expect(page.getByLabel('Format')).toBeVisible();
    expect((await page.getByLabel('Catégorie').boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByLabel('Format').boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByLabel('Catégorie').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Format')).toBeFocused();
  expect(await page.getByLabel('Format').evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
});
