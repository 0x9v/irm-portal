import { test, expect, type Page, type Route } from '@playwright/test';

const slug = 'intro-physics';
const moduleId = 'd0000000-0000-4000-8000-000000000001';
const endpoint = `**/api/v1/communities/irm/modules/${slug}/resources`;
const moduleData = { id: moduleId, community_id: 'irm', slug, name: 'Introduction to Physics' };
const account = { id: 'member-1', username: 'student', email: 'student@example.test', first_name: 'Student', family_name: 'Member' };

async function setup(page: Page, role = 'MEMBER', official = false) {
  // Every API request is blocked unless this spec explicitly fulfills it.
  await page.route('**/api/**', route => route.abort());
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: account }));
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ json: {
    membership: { id: 'membership-1', status: 'ACTIVE', role },
    capabilities: { upload_official_documents: official, create_announcements: false, manage_document_voting: false },
  } }));
  await page.route(`**/api/v1/communities/irm/modules/${slug}`, route => route.fulfill({ json: moduleData }));
  await page.goto(`/communities/irm/modules/${slug}/upload`);
  await expect(page.getByRole('heading', { name: 'Submit a resource' })).toBeVisible();
}

function response(kind: string, source = 'STUDENT') {
  return { id: 'e0000000-0000-4000-8000-000000000001', module_id: moduleId, kind, title: 'Study notes',
    description: null, source, status: source === 'STUDENT' ? 'PENDING' : 'APPROVED',
    created_at: '2026-10-14T12:00:00Z', updated_at: '2026-10-14T12:00:00Z',
    ...(kind === 'PDF' ? { document_type: 'TD' } : kind === 'IMAGE' ? { preview_url: '/api/v1/communities/irm/resources/e0000000-0000-4000-8000-000000000001/preview' }
      : kind === 'YOUTUBE' ? { video_id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
      : { url: 'https://example.org/guide' }),
  };
}

async function title(page: Page) { await page.getByRole('textbox', { name: 'Title' }).fill('Study notes'); }

test('PDF sends exact multipart fields and confirms pending review', async ({ page }) => {
  await setup(page);
  let payload = '';
  await page.route(endpoint, route => { payload = route.request().postData() ?? ''; return route.fulfill({ status: 201, json: response('PDF') }); });
  await title(page);
  await page.getByLabel('Document type').selectOption('TD');
  await page.getByLabel('PDF file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await page.getByRole('button', { name: 'Submit resource' }).click();
  await expect(page.getByRole('status')).toContainText('not published yet');
  expect(payload).toContain('name="kind"'); expect(payload).toContain('PDF');
  expect(payload).toContain('name="type"'); expect(payload).toContain('TD');
  expect(payload).toContain('name="file"; filename="notes.pdf"');
  expect(payload).not.toContain('name="url"');
});

test('image selection, replacement, removal and exact multipart fields', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Resource kind').selectOption('IMAGE');
  const picker = page.getByLabel('Image file');
  await picker.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: Buffer.from('first') });
  await expect(page.getByAltText('Unsaved selected image preview')).toBeVisible();
  await picker.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: Buffer.from('second') });
  await expect(page.getByText('Selected: second.png')).toBeVisible();
  await page.getByRole('button', { name: 'Remove selected file' }).click();
  await expect(page.getByAltText('Unsaved selected image preview')).toHaveCount(0);
  await picker.setInputFiles({ name: 'cancel.png', mimeType: 'image/png', buffer: Buffer.from('cancel') });
  await page.getByLabel('Resource kind').selectOption('LINK');
  await expect(page.getByAltText('Unsaved selected image preview')).toHaveCount(0);
  await page.getByLabel('Resource kind').selectOption('IMAGE');
  await picker.setInputFiles({ name: 'final.png', mimeType: 'image/png', buffer: Buffer.from('final') });
  await title(page);
  let payload = '';
  await page.route(endpoint, route => { payload = route.request().postData() ?? ''; return route.fulfill({ status: 201, json: response('IMAGE') }); });
  await page.getByRole('button', { name: 'Submit resource' }).click();
  await expect(page.getByRole('status')).toContainText('not published yet');
  expect(payload).toContain('name="file"; filename="final.png"');
  expect(payload).not.toContain('name="type"'); expect(payload).not.toContain('name="url"');
});

for (const kind of ['YOUTUBE', 'LINK'] as const) {
  test(`${kind} sends only the matching JSON payload`, async ({ page }) => {
    await setup(page);
    await page.getByLabel('Resource kind').selectOption(kind);
    await title(page);
    await page.getByLabel(kind === 'YOUTUBE' ? 'YouTube video URL' : 'Useful link URL')
      .fill(kind === 'YOUTUBE' ? 'https://youtu.be/dQw4w9WgXcQ' : 'https://example.org/guide');
    let body: Record<string, unknown> | null = null;
    await page.route(endpoint, route => { body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: response(kind) }); });
    await page.getByRole('button', { name: 'Submit resource' }).click();
    await expect(page.getByRole('status')).toContainText('not published yet');
    expect(Object.keys(body ?? {})).toEqual(['kind', 'title', 'description', 'source', 'url']);
    expect(body).toMatchObject({ kind, title: 'Study notes', source: 'STUDENT' });
  });
}

test('rejects bad files and URL before any request; changing kind drops hidden fields', async ({ page }) => {
  await setup(page);
  let requests = 0;
  await page.route(endpoint, route => { requests++; return route.abort(); });
  await page.getByLabel('Resource kind').selectOption('IMAGE');
  await page.getByLabel('Image file').setInputFiles({ name: 'bad.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByRole('alert')).toContainText('JPEG or PNG');
  await page.getByLabel('Resource kind').selectOption('YOUTUBE');
  await title(page);
  await page.getByLabel('YouTube video URL').fill('https://evil.example/watch?v=dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'Submit resource' }).click();
  await expect(page.getByRole('alert')).toContainText('YouTube');
  expect(requests).toBe(0);
});

test('pending lock starts one request; uncertain response keeps draft without automatic retry', async ({ page }) => {
  await setup(page);
  await title(page);
  await page.getByLabel('PDF file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  let resolve!: () => void;
  const held = new Promise<void>(done => { resolve = done; });
  let requests = 0;
  await page.route(endpoint, async (route: Route) => { requests++; await held; await route.fulfill({ status: 503, json: { detail: 'unavailable' } }); });
  const submit = page.getByRole('button', { name: /Submit resource|Submitting/ });
  await submit.click();
  await expect(submit).toBeDisabled();
  await submit.dispatchEvent('click');
  expect(requests).toBe(1);
  resolve();
  await expect(page.getByRole('status')).toContainText('Creation could not be confirmed');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Study notes');
  await expect(page.getByText('Selected: notes.pdf')).toBeVisible();
  expect(requests).toBe(1);
});

test('source permissions and response identity are enforced', async ({ page }) => {
  await setup(page, 'MODERATOR', false);
  await expect(page.getByLabel('Submit as').getByRole('option', { name: /Official/ })).toHaveCount(0);
  await expect(page.getByLabel('Submit as')).toHaveValue('STUDENT');
  await title(page);
  await page.getByLabel('PDF file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await page.route(endpoint, route => route.fulfill({ status: 201, json: { ...response('PDF'), module_id: 'wrong-module' } }));
  await page.getByRole('button', { name: 'Submit resource' }).click();
  await expect(page.getByRole('status')).toContainText('Creation could not be confirmed');
  await expect(page.getByText('Selected: notes.pdf')).toBeVisible();
});

test('authorized Delegate can explicitly publish an OFFICIAL link', async ({ page }) => {
  await setup(page, 'DELEGATE', true);
  await page.getByLabel('Submit as').selectOption('OFFICIAL');
  await page.getByLabel('Resource kind').selectOption('LINK');
  await title(page);
  await page.getByLabel('Useful link URL').fill('https://example.org/guide');
  let body: Record<string, unknown> | null = null;
  await page.route(endpoint, route => { body = route.request().postDataJSON(); return route.fulfill({ status: 201, json: response('LINK', 'OFFICIAL') }); });
  await page.getByRole('button', { name: 'Submit resource' }).click();
  await expect(page.getByRole('status')).toContainText('published');
  expect(body).toMatchObject({ kind: 'LINK', source: 'OFFICIAL' });
});

test('account change clears unsaved draft and selected file', async ({ page }) => {
  await setup(page);
  await title(page);
  await page.getByLabel('PDF file').setInputFiles({ name: 'private.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { ...account, id: 'member-2', username: 'second' } }));
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  await expect(page.getByText('Selected: private.pdf')).toHaveCount(0);
});

test('narrow and desktop forms stay within viewport in both themes', async ({ page }) => {
  await setup(page);
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    expect(await page.locator('body').evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByLabel('Resource kind')).toBeVisible();
  }
});
