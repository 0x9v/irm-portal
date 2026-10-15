import { test, expect, Page } from './moderation-fixtures';

const path = '/communities/irm/membership/members';
const id = '00000000-0000-4000-8000-000000000003';
const date = '2026-10-11T10:00:00Z';
const member = (status: string, target = id) => ({ id: target, username: `student_${status.toLowerCase()}`, status, role: 'MEMBER', created_at: date, updated_at: date });
async function fixture(page: Page, persona = 'DELEGATE') {
  const state = {
    persona, status: 'ACTIVE', userId: 'actor', reads: [] as URL[], mutations: [] as string[],
    outcome: 204 as number | 'network', readError: 0, empty: false, unbanned: false, paginate: false,
    waitAuthority: null as Promise<void> | null, username: null as string | null, duplicate: false,
    waitRead: null as Promise<void> | null, waitMutation: null as Promise<void> | null,
  };
  const headers = { 'Access-Control-Allow-Origin': process.env.IRM_ACCEPTANCE_FRONTEND || 'http://127.0.0.1:3128', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS' };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status, headers });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith('/auth/me')) return json({ id: state.userId, username: 'delegate' }, state.persona === 'guest' ? 401 : 200);
    if (url.pathname.endsWith('/membership/me')) { if (state.waitAuthority) await state.waitAuthority; return json({ membership: { id: `membership_${state.userId}`, status: state.status, role: state.persona }, capabilities: {} }, state.persona === 'error' ? 500 : 200); }
    if (url.pathname.endsWith('/memberships') && method === 'GET') {
      state.reads.push(url);
      const status = url.searchParams.get('status') ?? 'ALL'; const after = url.searchParams.get('after');
      const snapshot = state.empty || (status === 'BANNED' && state.unbanned) ? [] : [member(state.unbanned ? 'REMOVED' : status === 'ALL' ? 'BANNED' : status, after && !state.duplicate ? '00000000-0000-4000-8000-000000000004' : id)];
      if (state.username) snapshot.forEach(item => { item.username = state.username!; });
      const error = state.readError; const wait = state.waitRead;
      if (wait) await wait;
      if (error) return json({ detail: 'Synthetic refusal' }, error);
      return json({ items: snapshot, next_cursor: state.paginate && !after && snapshot.length ? id : null });
    }
    if (url.pathname.endsWith(`/memberships/${id}/ban`) && method === 'DELETE') {
      state.mutations.push(url.pathname); if (state.waitMutation) await state.waitMutation;
      if (state.outcome === 'network') return route.abort('failed');
      if (state.outcome !== 204) return json({ detail: 'Synthetic refusal' }, state.outcome);
      state.unbanned = true; return route.fulfill({ status: 204, headers });
    }
    if (url.pathname.endsWith('/logout')) { state.persona = 'guest'; return route.fulfill({ status: 204, headers }); }
    return route.abort();
  });
  return state;
}
const filter = (page: Page) => page.getByLabel('Membership status', { exact: true });
const directory = (page: Page) => page.getByRole('region', { name: 'Membership directory' });
async function openUnban(page: Page) {
  await filter(page).selectOption('BANNED');
  const actions = directory(page).locator('li details').first();
  if (!(await actions.evaluate(element => (element as HTMLDetailsElement).open))) await actions.locator('summary').click();
  await actions.getByRole('button', { name: 'Unban member', exact: true }).click();
  return page.getByRole('dialog');
}
for (const persona of ['MEMBER', 'MODERATOR', 'guest', 'error', 'PENDING', 'REMOVED', 'BANNED']) test(`${persona}: direct route and navigation deny records`, async ({ page }) => {
  const state = await fixture(page, persona); if (['PENDING', 'REMOVED', 'BANNED'].includes(persona)) { state.persona = 'DELEGATE'; state.status = persona; }
  await page.goto(path); await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
  await expect(directory(page)).toHaveCount(0); expect(state.reads).toHaveLength(0);
  await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0);
});
for (const status of ['ALL', 'ACTIVE', 'PENDING', 'REJECTED', 'REMOVED', 'BANNED']) test(`${status}: exact filter query and actual username`, async ({ page }) => {
  const state = await fixture(page); await page.goto(path); await filter(page).selectOption(status);
  await expect(directory(page).getByText(`@student_${status === 'ALL' ? 'banned' : status.toLowerCase()}`, { exact: true })).toBeVisible();
  expect(state.reads.at(-1)!.searchParams.get('status')).toBe(status === 'ALL' ? null : status);
  expect(state.reads.at(-1)!.searchParams.get('limit')).toBe('20'); expect(state.reads.at(-1)!.searchParams.has('after')).toBe(false);
  await expect(directory(page).getByText(id, { exact: true })).toHaveCount(0);
});
test('Banned empty and bounded pagination preserve rows on failure', async ({ page }) => {
  const state = await fixture(page); state.empty = true; await page.goto(path); await filter(page).selectOption('BANNED');
  await expect(page.getByText('No banned memberships found.')).toBeVisible();
  state.empty = false; state.paginate = true; await page.getByRole('button', { name: 'Refresh directory' }).click();
  await expect(directory(page).locator('li')).toHaveCount(1); state.readError = 500;
  await page.getByRole('button', { name: 'Load More', exact: true }).click(); await expect(page.getByRole('button', { name: 'Retry Load More' })).toBeVisible();
  await expect(directory(page).locator('li')).toHaveCount(1); state.readError = 0;
  await page.getByRole('button', { name: 'Retry Load More' }).click(); await expect(directory(page).locator('li')).toHaveCount(2);
  expect(state.reads.at(-1)!.searchParams.get('after')).toBe(id); await expect(page.getByRole('button', { name: 'Load More', exact: true })).toHaveCount(0);
});
test('Unban cancel, keyboard containment, 204, duplicate lock and authoritative refresh', async ({ page }) => {
  const state = await fixture(page); await page.goto(path); let dialog = await openUnban(page);
  await expect(dialog).toHaveAccessibleName('Unban @student_banned?');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(dialog).toContainText('does not restore'); await expect(dialog).toContainText('REMOVED');
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Unban member', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape'); expect(state.mutations).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Unban member', exact: true })).toBeFocused();
  dialog = await openUnban(page); let release!: () => void; state.waitMutation = new Promise(resolve => { release = resolve; });
  await dialog.getByRole('button', { name: 'Unban member', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Unban member', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled(); release();
  await expect(page.getByText('No banned memberships found.')).toBeVisible();
  expect(state.mutations).toEqual([`/api/v1/communities/irm/memberships/${id}/ban`]);
  expect(state.reads.at(-1)!.searchParams.get('status')).toBe('BANNED'); expect(state.reads.at(-1)!.searchParams.has('after')).toBe(false);
  await filter(page).selectOption('ALL'); await expect(directory(page).getByText('Status: REMOVED')).toBeVisible();
});
for (const outcome of [401, 403, 404, 409, 500, 'network'] as const) test(`Unban ${outcome}: safe error handling`, async ({ page }) => {
  const state = await fixture(page); await page.goto(path); const dialog = await openUnban(page); state.outcome = outcome;
  if (outcome === 401 || outcome === 403) state.persona = 'MEMBER';
  await dialog.getByRole('button', { name: 'Unban member', exact: true }).click();
  if (outcome === 401 || outcome === 403) { await expect(directory(page)).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0); }
  else if (outcome === 404 || outcome === 409) { await expect(dialog).not.toBeVisible(); await expect(page.getByText(outcome === 404 ? /This membership is unavailable/ : /current membership state prevents/)).toBeVisible(); expect(state.reads.at(-1)!.searchParams.has('after')).toBe(false); }
  else { await expect(dialog).toContainText('outcome could not be confirmed'); expect(state.mutations).toHaveLength(1); await dialog.getByRole('button', { name: 'Refresh and check' }).click(); await expect(dialog).not.toBeVisible(); expect(state.mutations).toHaveLength(1); }
});
for (const error of [400, 404, 500]) test(`directory read ${error}: retry/refresh`, async ({ page }) => {
  const state = await fixture(page); state.readError = error; await page.goto(path);
  await expect(page.getByRole('button', { name: 'Retry directory' })).toBeVisible(); state.readError = 0;
  await page.getByRole('button', { name: 'Retry directory' }).click(); await expect(directory(page).locator('li')).toHaveCount(1);
});
test('filter and refresh ignore obsolete pagination responses', async ({ page }) => {
  const state = await fixture(page); state.paginate = true; await page.goto(path); await expect(directory(page).locator('li')).toHaveCount(1);
  let release!: () => void; state.waitRead = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Load More', exact: true }).click();
  await expect.poll(() => state.reads.length).toBe(2); state.waitRead = null;
  await filter(page).selectOption('BANNED'); await expect(directory(page).getByText('@student_banned', { exact: true })).toBeVisible(); release();
  await expect(directory(page).locator('li')).toHaveCount(1); expect(state.reads.at(-1)!.searchParams.has('after')).toBe(false);
  state.waitRead = new Promise(resolve => { release = resolve; }); await page.getByRole('button', { name: 'Load More', exact: true }).click();
  await expect.poll(() => state.reads.length).toBe(4); state.waitRead = null; state.empty = true;
  await page.getByRole('button', { name: 'Refresh directory' }).click(); await expect(page.getByText('No banned memberships found.')).toBeVisible(); release();
  await expect(directory(page).locator('li')).toHaveCount(0);
});
test('account revalidation closes dialog and clears old records', async ({ page }) => {
  const state = await fixture(page); await page.goto(path); await openUnban(page); state.userId = 'new_actor'; state.persona = 'MEMBER';
  // A denied mutation triggers the existing auth/membership revalidation.
  state.outcome = 403;
  await page.getByRole('dialog').getByRole('button', { name: 'Unban member', exact: true }).click();
  await expect(directory(page)).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
});
for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) test(`${width}px ${theme}: directory and confirmation fit`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 }); await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
  const state = await fixture(page); state.username = 'long_student_'.repeat(30); await page.goto(path); const dialog = await openUnban(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const disclosure = directory(page).locator('li summary').first();
  expect((await disclosure.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(directory(page).locator('li')).toHaveCount(1);
  const box = await dialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  await page.screenshot({ path: test.info().outputPath(`members-${width}-${theme}.png`), fullPage: true });
});
for (const status of [401, 403]) test(`directory ${status}: clears loaded records and revalidates`, async ({ page }) => {
  const state = await fixture(page); await page.goto(path); await expect(directory(page).locator('li')).toHaveCount(1);
  state.persona = 'MEMBER'; state.readError = status; await page.getByRole('button', { name: 'Refresh directory' }).click();
  await expect(directory(page)).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0);
});
test('uncertain authority never reads directory', async ({ page }) => {
  const state = await fixture(page); let release!: () => void;
  state.waitAuthority = new Promise(resolve => { release = resolve; }); await page.goto(path);
  await expect(page.getByText('Checking Delegate access…')).toBeVisible(); expect(state.reads).toHaveLength(0);
  state.persona = 'MEMBER'; release(); await expect(page.getByText('Checking Delegate access…')).toHaveCount(0);
  expect(state.reads).toHaveLength(0); await expect(directory(page)).toHaveCount(0);
});
test('pagination deduplicates by membership id', async ({ page }) => {
  const state = await fixture(page); state.duplicate = true; state.paginate = true; await page.goto(path);
  await expect(directory(page).locator('li')).toHaveCount(1); await page.getByRole('button', { name: 'Load More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load More', exact: true })).toHaveCount(0); await expect(directory(page).locator('li')).toHaveCount(1);
});
test('filter clears old rows, cursor and open confirmation before new read', async ({ page }) => {
  const state = await fixture(page); state.paginate = true; await page.goto(path); await openUnban(page);
  // Native modal prevents user interaction behind it; changing the select's
  // native value simulates an external filter update while the dialog is open.
  let release!: () => void; state.waitRead = new Promise(resolve => { release = resolve; });
  await filter(page).evaluate(select => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(select, 'REMOVED'); select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(directory(page).locator('li')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load More', exact: true })).toHaveCount(0); release();
  await expect(directory(page).getByText('Status: REMOVED')).toBeVisible(); expect(state.reads.at(-1)!.searchParams.has('after')).toBe(false);
});
