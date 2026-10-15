import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

type Persona = 'guest' | 'nonmember' | 'pending' | 'rejected' | 'active' | 'delegate' | 'error' | 'loading';
const artifacts = path.resolve('test-results/home-mobile-20261010/screenshots');
const api = '/api/v1/communities/irm';
const modules = ['Mathematics', 'Computer science', 'Networks', 'Management'].map((name, i) => ({ id: `m-${i}`, name, slug: `module-${i}`, community_id: 'irm' }));
const notices = ['Resources for the new semester', 'Community study resources', 'Membership information'].map((title, i) => ({
  id: `notice-${i}`, title, content: 'Read this community notice for the details and useful information.', created_at: `2026-10-0${8-i}T10:00:00Z`, author_username: i === 0 ? 'actual_author' : null,
}));
async function fixture(page: Page, persona: Persona = 'active', options: { dark?: boolean; long?: boolean; count?: number; empty?: boolean; fail?: boolean } = {}) {
  const requests: string[] = [], unexpected: string[] = [];
  let fail = !!options.fail, membershipError = persona === 'error';
  let releaseMembership: (() => void) | undefined;
  const membershipReady = new Promise<void>(resolve => { releaseMembership = resolve; });
  await page.emulateMedia({ colorScheme: options.dark ? 'dark' : 'light' });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
        'Access-Control-Allow-Origin': 'http://127.0.0.1:3128', 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type',
      } });
      requests.push(url.pathname + url.search);
      if (route.request().method() !== 'GET') { unexpected.push('mutation: ' + url.pathname); return route.abort(); }
      const reply = (json: unknown, status = 200) => route.fulfill({ status, json, headers: {
        'Access-Control-Allow-Origin': 'http://127.0.0.1:3128', 'Access-Control-Allow-Credentials': 'true',
      } });
      if (url.pathname.endsWith('/auth/me')) return reply(persona === 'guest' ? { detail: 'Not authenticated' } : {
        id: 'mobile-fixture', username: options.long ? 'very_long_account_username_'.repeat(8) : 'amina_irm',
        first_name: 'Amina', family_name: 'Fixture', email: 'private-mobile@example.invalid',
      }, persona === 'guest' ? 401 : 200);
      if (url.pathname.endsWith('/membership/me')) {
        if (persona === 'loading') await membershipReady;
        return reply(membershipError ? { detail: 'Membership unavailable' } : {
          membership: persona === 'nonmember' ? null : { id: 'mobile-membership', status: persona === 'pending' ? 'PENDING' : persona === 'rejected' ? 'REJECTED' : 'ACTIVE', role: persona === 'delegate' ? 'DELEGATE' : 'MEMBER' },
          capabilities: { create_announcements: persona === 'delegate', manage_document_voting: persona === 'delegate', upload_official_documents: persona === 'delegate' },
        }, membershipError ? 500 : 200);
      }
      if (url.pathname.endsWith('/modules')) return reply(fail ? { detail: 'Modules temporarily unavailable' } : options.empty ? [] : modules.map(m => ({ ...m, name: options.long ? m.name + ' — applied engineering and information systems '.repeat(5) : m.name })), fail ? 500 : 200);
      if (url.pathname.endsWith('/announcements')) return reply(fail ? { detail: 'Announcements temporarily unavailable' } : options.empty ? [] : notices.slice(0, options.count ?? 3).map(n => ({ ...n, title: options.long ? n.title + ' <script>unsafe()</script> ' + 'long title '.repeat(15) : n.title })), fail ? 500 : 200);
      if (url.pathname.endsWith('/replies')) return reply({ items: [], next_cursor: null });
      if (url.pathname.includes('/announcements/')) return reply(notices[0]);
      if (url.pathname.endsWith('/posts')) return reply({ items: [], next_cursor: null });
      if (url.pathname.endsWith('/discussion/messages')) return reply({ items: [], older_cursor: null, newer_cursor: null, has_more_older: false, has_more_newer: false });
      if (url.pathname.endsWith('/discussion/stickers')) return reply([]);
      unexpected.push(url.pathname); return route.abort();
    }
    if (url.origin !== 'http://127.0.0.1:3128') { unexpected.push(url.origin); return route.abort(); }
    return route.continue();
  });
  return { requests, unexpected, recover: () => { fail = false; membershipError = false; }, release: () => releaseMembership?.() };
}
async function screenshot(page: Page, name: string, fullPage = true) {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText('private-mobile@example.invalid');
}
async function unobstructed(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport();
  const nav = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
  if (await nav.isVisible()) {
    const bounds = (await control.boundingBox())!, bar = (await nav.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(bar.y);
  }
}

for (const dark of [false, true]) for (const width of [320, 390, 430, 768]) {
  test(`Mobile active ${dark ? 'dark' : 'light'} at ${width}: shortcuts, stacked rows, safe footer`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    const data = await fixture(page, 'active', { dark }); await page.goto('/');
    const main = page.locator('main'), bottom = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
    await expect(main.getByRole('link', { name: /^Module: / })).toHaveCount(4);
    await expect(main.getByRole('link', { name: /^Announcement: / })).toHaveCount(3);
    await expect(bottom.getByRole('link')).toHaveCount(5);
    await expect(bottom.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    const shortcuts = main.getByRole('navigation', { name: 'Home shortcuts' });
    await expect(shortcuts.getByRole('link')).toHaveCount(4);
    const boxes = await shortcuts.getByRole('link').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().y));
    expect(new Set(boxes).size).toBe(width >= 600 ? 1 : 2);
    await expect(main.getByRole('link', { name: 'Browse modules', exact: true })).toBeHidden();
    const rows = await main.getByRole('link', { name: /^Module: / }).evaluateAll(elements => elements.map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })));
    expect(new Set(rows.map(row => row.x)).size).toBe(1); expect(new Set(rows.map(row => row.y)).size).toBe(4);
    await expect(main.getByText('By actual_author', { exact: true })).toBeVisible();
    for (const control of await bottom.getByRole('link').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noOverflow(page);
    expect(data.requests.filter(r => r.endsWith('/modules'))).toHaveLength(1);
    expect(data.requests.filter(r => r.includes('/announcements'))).toEqual([`${api}/announcements?limit=3`]);
    expect(data.unexpected).toEqual([]);
    await screenshot(page, `active-${dark ? 'dark' : 'light'}-${width}`);
    if (width === 390 || width === 320) await screenshot(page, `active-${dark ? 'dark' : 'light'}-${width}-viewport`, false);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = (await page.locator('[data-site-footer] p').last().boundingBox())!, nav = (await bottom.boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(nav.y - 12);
  });
}

for (const persona of ['guest', 'nonmember', 'pending', 'rejected', 'delegate', 'error'] as const) {
  test(`${persona}: correct bottom destinations, truthful Home access, authorized drawer`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const data = await fixture(page, persona); await page.goto('/');
    const main = page.locator('main'), bottom = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
    const expected = persona === 'delegate' ? ['Home', 'Modules', 'Posts', 'Discussion', 'Membership'] : ['Home', 'Modules', persona === 'guest' ? 'Login' : 'Membership', 'Support'];
    await expect(bottom.getByRole('link')).toHaveText(expected);
    if (persona === 'guest') await expect(main.getByRole('link', { name: 'Create an Account' })).toBeVisible();
    if (persona === 'nonmember') await expect(main.getByRole('link', { name: 'Request IRM Membership' })).toBeVisible();
    if (persona === 'pending') await expect(main.getByRole('link', { name: 'Check Application Status' })).toBeVisible();
    if (persona === 'rejected') await expect(main.getByRole('link', { name: 'Reapply for Membership' })).toBeVisible();
    if (persona === 'error') await expect(main.getByRole('button', { name: 'Retry Verification' })).toBeVisible();
    if (persona !== 'delegate') {
      await expect(main.getByRole('navigation', { name: 'Home shortcuts' }).getByRole('link')).toHaveCount(1);
      expect(data.requests.some(r => r.includes('/announcements'))).toBe(false);
    }
    await screenshot(page, `${persona}-390`);
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const drawer = page.getByRole('navigation', { name: 'Mobile Navigation', exact: true });
    if (persona === 'delegate') {
      await expect(drawer.getByRole('link', { name: 'Review Applications' })).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Manage Staff' })).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Voting Settings' })).toBeVisible();
    } else await expect(drawer.getByRole('link', { name: 'Manage Staff' })).toHaveCount(0);
    await drawer.getByRole('group', { name: 'Appearance' }).scrollIntoViewIfNeeded();
    await drawer.getByLabel('Dark', { exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const accountAction = persona === 'guest' ? drawer.getByRole('link', { name: 'Register', exact: true }) : drawer.getByRole('button', { name: 'Logout', exact: true });
    await unobstructed(page, accountAction);
    await screenshot(page, `${persona}-drawer-dark-390`, false);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0); await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeFocused();
    await noOverflow(page); expect(data.unexpected).toEqual([]);
  });
}

test('Unknown membership never flashes protected navigation; verification recovery updates it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const data = await fixture(page, 'loading'); await page.goto('/');
  await expect(page.getByText('Checking account…', { exact: true })).toBeVisible();
  const bottom = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
  await expect(bottom.getByRole('link', { name: /Posts|Discussion/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Home shortcuts' }).getByRole('link')).toHaveCount(1);
  expect(data.requests.some(r => r.includes('/announcements'))).toBe(false);
  data.release(); await expect(bottom.getByRole('link', { name: 'Posts' })).toBeVisible();
});

test('Error retry and empty data stay honest inside the mobile composition', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const data = await fixture(page, 'active', { fail: true }); await page.goto('/');
  await expect(page.locator('main')).toContainText('Announcements temporarily unavailable');
  await expect(page.locator('main')).toContainText('Modules temporarily unavailable');
  await screenshot(page, 'feed-module-errors-390'); data.recover();
  for (const name of ['Latest announcements', 'Community modules']) await page.getByRole('region', { name, exact: true }).getByRole('button', { name: 'Retry Loading' }).click();
  await expect(page.locator('main article')).toHaveCount(3);
  await expect(page.locator('main').getByRole('link', { name: /^Module: / })).toHaveCount(4);
});
for (const options of [{ empty: true }, { count: 1 }]) {
  test(`Home ${options.empty ? 'empty' : 'one announcement'} state`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await fixture(page, 'active', options); await page.goto('/');
    if (options.empty) { await expect(page.locator('main')).toContainText('No announcements published yet.'); await expect(page.locator('main')).toContainText('No modules found.'); }
    else await expect(page.locator('main article')).toHaveCount(1);
    await noOverflow(page); await screenshot(page, options.empty ? 'empty-390' : 'one-announcement-390');
  });
}

for (const width of [320, 390]) {
  test(`Long content and doubled text at ${width} short height stay readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 480 }); await fixture(page, 'active', { long: true }); await page.goto('/');
    await expect(page.locator('main article')).toHaveCount(3);
    await expect(page.locator('main').getByRole('link', { name: /^Module: / })).toHaveCount(4);
    await noOverflow(page); await screenshot(page, `long-content-${width}-short`);
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const drawer = page.getByRole('navigation', { name: 'Mobile Navigation', exact: true });
    await drawer.getByRole('button', { name: 'Logout', exact: true }).scrollIntoViewIfNeeded();
    await expect(drawer).toContainText('very_long_account_username_');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('body *')).filter(e => !(e instanceof SVGElement));
      const sizes = elements.map(e => [parseFloat(getComputedStyle(e).fontSize), parseFloat(getComputedStyle(e).lineHeight)]);
      elements.forEach((element, i) => { const e = element as HTMLElement; e.style.fontSize = `${sizes[i][0] * 2}px`; if (Number.isFinite(sizes[i][1])) e.style.lineHeight = `${sizes[i][1] * 2}px`; });
    });
    await noOverflow(page); await screenshot(page, `doubled-text-${width}-short`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = (await page.locator('[data-site-footer] p').last().boundingBox())!, bar = (await page.getByRole('navigation', { name: 'Mobile bottom navigation' }).boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(bar.y - 12);
  });
}

for (const width of [1024, 1440]) for (const dark of [false, true]) {
  test(`Accepted desktop preserved at ${width} ${dark ? 'dark' : 'light'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 941 }); await fixture(page, 'active', { dark }); await page.goto('/');
    await expect(page.locator('main').getByRole('link', { name: /^Module: / })).toHaveCount(4);
    await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Home shortcuts' })).toBeHidden();
    await expect(page.locator('main').getByRole('link', { name: 'Browse modules', exact: true })).toBeVisible();
    const hero = (await page.getByRole('region', { name: 'Welcome to IRM Hub' }).boundingBox())!; expect(hero.height).toBe(205);
    const modulesY = await page.locator('main').getByRole('link', { name: /^Module: / }).evaluateAll(e => e.map(x => x.getBoundingClientRect().y));
    expect(new Set(modulesY).size).toBe(1);
    if (width === 1440) {
      expect((await page.getByRole('complementary', { name: 'Desktop Sidebar' }).boundingBox())!.width).toBe(248);
      expect((await page.getByRole('region', { name: 'Context Bar' }).boundingBox())!.height).toBe(64);
    } else await expect(page.getByRole('complementary', { name: 'Desktop Sidebar' })).toBeHidden();
    await noOverflow(page); await screenshot(page, `desktop-${dark ? 'dark' : 'light'}-${width}`);
  });
}

test('Bottom links navigate and update active state; drawer dismisses outside and on route change', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page); await page.goto('/');
  const bottom = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
  await expect(bottom.getByRole('link', { name: 'Posts' })).toBeVisible();
  await bottom.getByRole('link', { name: 'Modules' }).click(); await expect(page).toHaveURL(/\/modules$/);
  await expect(bottom.getByRole('link', { name: 'Modules' })).toHaveAttribute('aria-current', 'page');
  await bottom.getByRole('link', { name: 'Home' }).click(); await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('heading', { name: 'Welcome to IRM Hub' }).click();
  await expect(page.getByRole('navigation', { name: 'Mobile Navigation', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await page.getByRole('navigation', { name: 'Mobile Navigation', exact: true }).getByRole('link', { name: 'Support', exact: true }).click();
  await expect(page).toHaveURL(/\/support$/); await expect(page.getByRole('navigation', { name: 'Mobile Navigation', exact: true })).toHaveCount(0);
});

for (const destination of ['login', 'discussion', 'reply'] as const) {
  test(`${destination} text entry hides the bar; submission controls remain reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 480 }); await fixture(page, destination === 'login' ? 'guest' : 'active');
    await page.goto(destination === 'login' ? '/login' : destination === 'discussion' ? '/communities/irm/discussion' : '/communities/irm/announcements/notice-0');
    const field = destination === 'login' ? page.getByLabel('Email Address') : destination === 'discussion' ? page.getByRole('textbox', { name: 'Write a message' }) : page.getByLabel('Leave a reply');
    await expect(field).toBeEnabled(); await field.focus();
    await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).toBeHidden();
    await page.setViewportSize({ width: 390, height: 320 });
    await field.fill(destination === 'login' ? 'fixture@example.invalid' : 'Local unsent draft');
    const button = destination === 'login' ? page.getByRole('button', { name: 'Log In', exact: true }) : page.getByRole('button', { name: destination === 'discussion' ? 'Send' : 'Post Reply', exact: true });
    await unobstructed(page, button);
    await field.evaluate(e => (e as HTMLElement).blur());
    await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).toBeVisible();
    await unobstructed(page, button); await noOverflow(page); await screenshot(page, `${destination}-short-controls`);
  });
}

test('PDF controls are not covered and paper is not themed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page, 'active', { dark: true });
  const file = await readFile(path.resolve('e2e/document-reader.spec.ts'), 'utf8');
  const pdf = Buffer.from(file.match(/const TWO_PAGE_PDF_B64 =\s*'([^']+)'/)![1], 'base64');
  await page.route(`**${api}/modules/module-0`, route => route.fulfill({ json: modules[0] }));
  await page.route(`**${api}/modules/module-0/documents/mobile-pdf`, route => route.fulfill({ json: {
    id: 'mobile-pdf', title: 'Local PDF fixture', module_id: 'm-0', uploader_id: 'fixture', type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-10-10T12:00:00Z', updated_at: '2026-10-10T12:00:00Z',
  } }));
  await page.route('**/api/v1/documents/mobile-pdf/view', route => route.fulfill({ contentType: 'application/pdf', body: pdf }));
  await page.goto('/communities/irm/modules/module-0/documents/mobile-pdf');
  await expect(page.getByText('PDF Document — 2 pages')).toBeVisible();
  for (const label of ['Zoom in', 'Zoom out', 'Next page', 'Download Original']) await unobstructed(page, page.getByRole('button', { name: label, exact: true }));
  const paper = page.locator('canvas[data-testid="pdf-canvas"]').first();
  await expect(paper).toBeVisible(); await expect(paper).toHaveCSS('filter', 'none');
  await noOverflow(page); await screenshot(page, 'pdf-dark-390');
});
