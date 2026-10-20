import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const community = '/api/v1/communities/irm';
const course = { id: 'identity-module', name: 'Algorithms and data structures', slug: 'algorithms', community_id: 'irm', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z' };
const document = { id: 'identity-document', module_id: course.id, module_slug: course.slug, module_name: course.name, title: 'Graphs, traversal and shortest paths — practical study notes', type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED', created_at: course.created_at, updated_at: course.updated_at, uploader_id: 'identity-user' };
const user = { id: 'identity-user', username: 'student_with_a_deliberately_long_username_for_wrapping', email: 'student@example.test', first_name: 'Test', family_name: 'Student' };
const readerSource = readFileSync('e2e/document-reader.spec.ts', 'utf8');
const pdf = Buffer.from(readerSource.match(/const TWO_PAGE_PDF_B64 =\s*'([^']+)'/)![1], 'base64');
const preview = Buffer.from(readerSource.match(/const SAMPLE_PNG_B64 =\s*'([^']+)'/)![1], 'base64');

type Persona = 'guest' | 'non-member' | 'member' | 'delegate';
async function fixture(page: Page, persona: Persona) {
  const state = { authenticated: persona !== 'guest', saved: false, voted: false, removed: false, membership: persona === 'member' || persona === 'delegate' ? { id: 'identity-membership', status: 'ACTIVE', role: persona === 'delegate' ? 'DELEGATE' : 'MEMBER' } : null as null | { id: string; status: string; role: string }, requests: [] as { method: string; path: string; body: unknown }[], unexpected: [] as string[] };
  await page.routeWebSocket('**/discussion/ws*', socket => socket.onMessage(() => {}));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3142', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Cache-Control': 'no-store' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { body = request.postData(); }
    state.requests.push({ method, path: path + url.search, body });
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value, headers });
    if (path.endsWith('/auth/me')) return json(state.authenticated ? user : { detail: 'Not authenticated' }, state.authenticated ? 200 : 401);
    if (path.endsWith('/auth/login')) { state.authenticated = true; return json(user); }
    if (path.endsWith('/auth/register')) return json(user, 201);
    if (path.endsWith('/auth/logout')) { state.authenticated = false; return route.fulfill({ status: 204, headers }); }
    if (path.endsWith('/membership/me')) return json({ membership: state.membership, capabilities: persona === 'delegate' ? { manage_document_voting: true, create_announcements: true, upload_official_documents: true } : {} });
    if (path.endsWith('/membership/application-options')) return json({ applicant_types: ['STUDENT', 'LAUREATE'], student_identifier_types: ['MASSAR', 'FOREIGN'], promotion_options: ['2025/2026', '2024/2025'], custom_promotion_formats: ['YYYY', 'YY', 'YYYY/YYYY', 'YY/YY'] });
    if (path === `${community}/membership` && method === 'POST') { state.membership = { id: 'pending-member', status: 'PENDING', role: 'MEMBER' }; return json(state.membership, 201); }
    if (path.endsWith('/membership/pending') || path.endsWith('/membership/active')) return json([]);
    if (path.endsWith('/document-voting/settings')) return json({ required_total_votes: 3 });
    if (path.endsWith('/memberships/other-member') && method === 'DELETE') { state.removed = true; return route.fulfill({ status: 204, headers }); }
    if (path.endsWith('/memberships')) return json({ items: state.removed ? [] : [{ id: 'other-member', user_id: 'other-user', username: 'other_student', status: 'ACTIVE', role: 'MEMBER', created_at: course.created_at, updated_at: course.updated_at }], next_cursor: null });
    if (path === `${community}/modules`) return json([course]);
    if (path === `${community}/modules/algorithms`) return json(course);
    if (path === `${community}/modules/algorithms/documents`) return json([document]);
    if (path === `${community}/modules/algorithms/documents/identity-document`) return json(document);
    if (path.endsWith('/documents/identity-document/saved')) { if (method === 'PUT') state.saved = true; if (method === 'DELETE') state.saved = false; return json({ saved: state.saved }); }
    if (path.endsWith('/documents/saved')) return json({ items: [{ ...document, saved_at: course.created_at }], next_cursor: null });
    if (path.endsWith('/documents/recent')) return json({ items: [{ ...document, last_opened_at: course.created_at, last_page: 2 }], next_cursor: null });
    if (path.endsWith('/resources/mine')) return json({ items: [], next_cursor: null });
    if (path.endsWith('/reading/open')) return json({ last_page: 2, last_opened_at: course.created_at });
    if (path.endsWith('/reading/position')) return json({ last_page: (body as { last_page: number }).last_page });
    if (path.endsWith('/documents/pending')) return json(state.voted ? [] : [{ ...document, id: 'pending-document', status: 'PENDING', source: 'STUDENT', is_uploader: false, can_vote: true, my_vote: null, full_document_access: false }]);
    if (path.endsWith('/preview')) return route.fulfill({ body: preview, contentType: 'image/png', headers });
    if (path.endsWith('/vote')) { state.voted = true; return json({ vote: (body as { vote: string }).vote, full_document_access: true }); }
    if (path.endsWith('/view') || path.endsWith('/download')) return route.fulfill({ body: pdf, contentType: 'application/pdf', headers });
    if (path.endsWith('/announcements')) return json([]);
    if (path.endsWith('/discussion/stickers')) return json([]);
    if (path.endsWith('/discussion/messages') && method === 'POST') return json({ id: 'sent-message', kind: 'TEXT', content: (body as { content: string }).content, sticker_id: null, author_username: user.username, created_at: course.created_at, reactions: [], caller_reaction: null }, 201);
    if (path.endsWith('/discussion/messages')) return json({ items: [], older_cursor: null, newer_cursor: null, has_more_older: false, has_more_newer: false });
    if (path.endsWith('/posts')) return json({ items: [], next_cursor: null });
    state.unexpected.push(`${method} ${path}`);
    return json({ detail: 'Unmocked request was blocked by the test fixture' }, 500);
  });
  return state;
}

async function theme(page: Page, value: 'light' | 'dark') { await page.addInitScript(value => localStorage.setItem('irm-theme', value), value); }

test('account forms keep login/register payloads and the existing redirect', async ({ page }) => {
  const state = await fixture(page, 'guest');
  await page.goto('/register');
  for (const [label, value] of [['Username', 'new_student'], ['Email Address', 'new@example.test'], ['First Name', 'New'], ['Family Name', 'Student'], ['Password', 'valid-password']]) await page.getByLabel(label, { exact: false }).fill(value);
  await page.locator('main').getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Your account was created successfully!')).toBeVisible();
  expect(state.requests.find(r => r.path.endsWith('/auth/register'))?.body).toEqual({ username: 'new_student', email: 'new@example.test', first_name: 'New', family_name: 'Student', password: 'valid-password' });
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('new@example.test');
  await page.getByLabel('Password', { exact: true }).fill('valid-password');
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/communities\/irm\/membership$/);
  expect(state.requests.find(r => r.path.endsWith('/auth/login'))?.body).toEqual({ email: 'new@example.test', password: 'valid-password' });
});

test('module search keeps URL filters, and approved PDF keeps saving and recent-position controls', async ({ page }) => {
  const state = await fixture(page, 'member');
  await page.goto('/communities/irm/modules/algorithms');
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('graphs');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Type', { exact: true }).selectOption('COURSE');
  await expect.poll(() => state.requests.some(r => r.path.includes('q=graphs') && r.path.includes('type=COURSE'))).toBe(true);
  await page.getByRole('link', { name: 'Read Document', exact: true }).click();
  await expect(page.getByTestId('pdf-canvas')).toBeVisible();
  await expect(page.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect.poll(() => state.requests.some(r => r.path.endsWith('/reading/position') && (r.body as { last_page: number }).last_page === 1)).toBe(true);
  await page.getByRole('button', { name: 'Save document', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved · Remove' })).toBeVisible();
  await page.goto('/communities/irm/documents/saved');
  await expect(page.getByRole('heading', { name: document.title })).toBeVisible();
  await page.goto('/communities/irm/documents/recent');
  await expect(page.getByRole('link', { name: 'Continue reading' })).toHaveAttribute('href', /algorithms\/documents\/identity-document$/);
  expect(state.unexpected).toEqual([]);
});

test('pending preview gates voting; Discussion sends text; membership submits Student fields', async ({ page }) => {
  const state = await fixture(page, 'member');
  await page.goto('/communities/irm/documents/pending');
  await expect(page.getByRole('button', { name: /YES/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load Preview' }).click();
  await expect(page.getByRole('img', { name: /Preview of/ })).toBeVisible();
  await page.getByRole('button', { name: /YES/ }).click();
  await expect.poll(() => state.requests.some(r => r.path.endsWith('/vote'))).toBe(true);
  await page.goto('/communities/irm/discussion');
  await page.getByRole('textbox', { name: 'Write a message' }).fill('A message sent by the isolated browser check.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('A message sent by the isolated browser check.', { exact: true })).toBeVisible();
  state.membership = null;
  await page.goto('/account#community-membership');
  await page.getByLabel('Applicant type').selectOption('STUDENT');
  await page.getByLabel('Real first name').fill('Test');
  await page.getByLabel('Real family name').fill('Student');
  await page.getByLabel('Student identifier', { exact: true }).fill('R123456789');
  await page.getByRole('button', { name: 'Request membership' }).click();
  await expect.poll(() => state.requests.some(r => r.path === `${community}/membership` && r.method === 'POST')).toBe(true);
  expect(state.unexpected).toEqual([]);
});

test('Delegate removal keeps explicit confirmation, cancellation, and focus return', async ({ page }) => {
  const state = await fixture(page, 'delegate');
  await page.goto('/communities/irm/membership/members');
  const remove = page.getByRole('button', { name: 'Remove member', exact: true });
  await remove.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(remove).toBeFocused();
  expect(state.requests.some(r => r.method === 'DELETE')).toBe(false);
  await remove.click();
  await dialog.getByRole('button', { name: 'Remove member', exact: true }).click();
  await expect(page.getByText('@other_student', { exact: true })).toHaveCount(0);
  expect(state.requests.some(r => r.method === 'DELETE' && r.path === `${community}/memberships/other-member`)).toBe(true);
});

for (const persona of ['guest', 'non-member', 'member', 'delegate'] as const) test(`${persona} mobile menu has one surface and preserves permitted destinations`, async ({ page }) => {
  await fixture(page, persona);
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto(persona === 'guest' ? '/support' : '/communities/irm/modules');
  if (persona !== 'guest') await expect(page.locator('aside[aria-label="Desktop Sidebar"]').getByText(user.username, { exact: true })).toHaveCount(1);
  const menu = page.getByRole('button', { name: /^(Menu|Open navigation menu)$/ });
  await menu.click();
  const nav = page.getByRole('navigation', { name: persona === 'guest' ? 'Guest mobile navigation' : 'Mobile Navigation', exact: true });
  await expect(nav).toBeVisible();
  if (persona === 'guest') expect(await nav.getByRole('link').evaluateAll(links => links.map(l => l.getAttribute('href')))).toEqual(['/', '/login', '/register', '/support']);
  else {
    await expect(nav.getByRole('link', { name: 'Modules', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Manage Staff', exact: true })).toHaveCount(persona === 'delegate' ? 1 : 0);
    await expect(nav.getByRole('link', { name: 'Discussion', exact: true })).toHaveCount(persona === 'member' || persona === 'delegate' ? 1 : 0);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole('button', { name: 'Dismiss navigation', exact: true }).click({ position: { x: 385, y: 590 } });
  await expect(menu).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).toHaveCount(0);
});

const views = [
  { name: 'login', path: '/login', persona: 'guest' },
  { name: 'module', path: '/communities/irm/modules/algorithms', persona: 'member' },
  { name: 'reader', path: '/communities/irm/modules/algorithms/documents/identity-document', persona: 'member' },
  { name: 'discussion', path: '/communities/irm/discussion', persona: 'member' },
  { name: 'membership', path: '/account#community-membership', persona: 'non-member' },
  { name: 'delegate', path: '/communities/irm/membership/members', persona: 'delegate' },
] as const;
for (const value of ['light', 'dark'] as const) for (const width of [320, 390, 768, 1024, 1440]) test(`representative feature pages fit ${width}px in ${value}`, async ({ page }, info) => {
  await theme(page, value);
  await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  for (const view of views) {
    await page.unroute('**/api/**');
    await fixture(page, view.persona);
    await page.goto(view.path);
    if (view.persona !== 'guest') await expect(page.locator('aside[aria-label="Desktop Sidebar"]').getByText(user.username, { exact: true })).toHaveCount(1);
    const main = page.locator('main');
    await expect(main).toBeVisible();
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
    if (view.name === 'reader') {
      await expect(page.getByTestId('pdf-canvas')).toBeVisible();
      await expect(page.getByTestId('pdf-canvas').locator('..')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    }
    if (view.name === 'module') await expect(main.getByRole('link', { name: 'Read Document', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
    if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`${view.name}-${value}-${width}.png`), fullPage: true });
    const action = main.locator('button:not(:disabled), a[href]').first();
    await action.focus();
    await expect(action).toHaveCSS('outline-width', '3px');
  }
});
