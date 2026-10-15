import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

type Persona = 'active' | 'guest' | 'nonmember' | 'pending' | 'rejected' | 'error' | 'loading';
const artifacts = path.resolve('test-results/home-visual-20261010/screenshots');
const modules = ['Mathematics', 'Computer science', 'Networks', 'Management'].map((name, i) => ({ id: `module-${i}`, name, slug: `module-${i}` }));
const notices = ['Resources for the new semester', 'Share your questions with the community', 'Membership verification information'].map((title, i) => ({
  id: `notice-${i}`, title, content: 'Find the latest information for IRM members. Open this notice to read all the details.', created_at: `2026-10-0${8-i}T10:00:00Z`,
}));

async function fixture(page: Page, persona: Persona = 'active', dark = false, long = false) {
  const requests: string[] = [];
  const unexpected: string[] = [];
  let membershipFailure = persona === 'error';
  let feedFailure = false;
  let modulesFailure = false;
  let empty = false;
  let releaseMembership: (() => void) | undefined;
  const membershipReady = new Promise<void>(resolve => { releaseMembership = resolve; });
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname + url.search);
      const reply = (json: unknown, status = 200) => route.fulfill({ status, json, headers: {
        'Access-Control-Allow-Origin': 'http://127.0.0.1:3127',
        'Access-Control-Allow-Credentials': 'true',
      } });
      if (url.pathname.endsWith('/auth/me')) return reply(persona === 'guest' ? { detail: 'Not authenticated' } : {
        id: 'visual-member', username: long ? 'very_long_username_for_an_irm_community_member_'.repeat(4) : 'amina_irm',
        first_name: 'Amina', family_name: 'Fixture', email: 'private-fixture@example.invalid',
      }, persona === 'guest' ? 401 : 200);
      if (url.pathname.endsWith('/membership/me')) {
        if (persona === 'loading') await membershipReady;
        return reply(membershipFailure ? { detail: 'Membership service unavailable' } : {
          membership: persona === 'nonmember' ? null : { id: 'visual-membership', status: persona === 'pending' ? 'PENDING' : persona === 'rejected' ? 'REJECTED' : 'ACTIVE', role: 'MEMBER' },
          capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
        }, membershipFailure ? 500 : 200);
      }
      if (url.pathname.endsWith('/modules')) return reply(modulesFailure ? { detail: 'Modules temporarily unavailable' } : empty ? [] : modules.map(m => ({ ...m, name: long ? m.name + ' — advanced systems and applied engineering methods '.repeat(4) : m.name })), modulesFailure ? 500 : 200);
      if (url.pathname.endsWith('/announcements')) return reply(feedFailure ? { detail: 'Announcements temporarily unavailable' } : empty ? [] : notices.map(n => ({ ...n, title: long ? n.title + ' <script>alert("escaped")</script> ' + 'long title '.repeat(20) : n.title })), feedFailure ? 500 : 200);
      if (url.pathname.endsWith('/auth/logout')) return reply({ detail: 'Logged out' });
      unexpected.push(url.pathname); return route.abort();
    }
    if (url.origin !== 'http://127.0.0.1:3127') { unexpected.push(url.origin); return route.abort(); }
    return route.continue();
  });
  return {
    requests, unexpected,
    recoverMembership: () => { membershipFailure = false; },
    setFeedFailure: (value: boolean) => { feedFailure = value; },
    setModulesFailure: (value: boolean) => { modulesFailure = value; },
    setEmpty: () => { empty = true; },
    release: () => releaseMembership?.(),
  };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText('private-fixture@example.invalid');
}
async function screenshot(page: Page, name: string, fullPage = true) {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage });
}

for (const dark of [false, true]) {
  for (const width of [1672, 1440, 1024, 768, 390, 320]) {
    test(`Active ${dark ? 'dark' : 'light'} ${width}: real shell, responsive composition, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1672 ? 941 : 900 });
      const data = await fixture(page, 'active', dark);
      await page.goto('/');
      const main = page.locator('main');
      await expect(main.getByRole('link', { name: /^Module: / })).toHaveCount(4);
      await expect(main.getByRole('link', { name: /^Announcement: / })).toHaveCount(3);
      await expect(main.getByRole('link', { name: 'Browse modules', exact: true })).toHaveCount(1);
      await expect(main.getByRole('link', { name: 'Join discussion' })).toHaveAttribute('href', '/communities/irm/discussion');
      await expect(main.getByRole('link', { name: 'Posts', exact: true })).toHaveAttribute('href', '/communities/irm/posts');
      await expect(main.getByRole('link', { name: 'Discussion', exact: true })).toHaveAttribute('href', '/communities/irm/discussion');
      await expect(main.getByRole('link', { name: 'Announcements', exact: true })).toHaveAttribute('href', '/communities/irm/announcements');
      const study = (await main.getByRole('region', { name: 'Study resources', exact: true }).boundingBox())!;
      const support = (await main.getByRole('region', { name: 'Community', exact: true }).boundingBox())!;
      if (width >= 1440) {
        const sidebar = (await page.getByRole('complementary', { name: 'Desktop Sidebar' }).boundingBox())!;
        const bar = (await page.getByRole('region', { name: 'Context Bar' }).boundingBox())!;
        expect(sidebar.width).toBe(248); expect(bar.height).toBe(64);
        if (width === 1672) { expect(study.width / support.width).toBeCloseTo(2.2, 1); expect(study.width).toBeGreaterThan(900); }
        const hero = (await page.getByRole('region', { name: 'Welcome to IRM Hub' }).boundingBox())!;
        expect(hero.height).toBe(205);
      } else expect(support.y).toBeGreaterThan(study.y + study.height);
      const cardBounds = await main.getByRole('link', { name: /^Module: / }).evaluateAll(elements => elements.map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })));
      if (width >= 1024) expect(new Set(cardBounds.map(b => b.y)).size).toBe(1);
      if (width === 768) expect(new Set(cardBounds.map(b => b.y)).size).toBe(2);
      await noOverflow(page);
      expect(data.requests.filter(r => r.includes('/announcements'))).toEqual(['/api/v1/communities/irm/announcements?limit=3']);
      expect(data.requests.filter(r => r.endsWith('/modules'))).toHaveLength(1);
      expect(data.unexpected).toEqual([]);
      await screenshot(page, `active-${dark ? 'dark' : 'light'}-${width}`);
      if (width === 1672) await screenshot(page, `active-${dark ? 'dark' : 'light'}-1672-viewport`, false);
    });
  }
}

for (const persona of ['guest', 'nonmember', 'pending', 'rejected', 'error'] as const) {
  test(`${persona}: truthful access guidance and no protected data requests`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const data = await fixture(page, persona);
    await page.goto('/');
    const main = page.locator('main');
    if (persona === 'guest') await expect(main.getByRole('link', { name: 'Create an Account' })).toBeVisible();
    if (persona === 'nonmember') await expect(main.getByRole('link', { name: 'Request IRM Membership' })).toBeVisible();
    if (persona === 'pending') await expect(main.getByRole('link', { name: 'Check Application Status' })).toBeVisible();
    if (persona === 'rejected') await expect(main.getByRole('link', { name: 'Reapply for Membership' })).toBeVisible();
    if (persona === 'error') await expect(main.getByRole('button', { name: 'Retry Verification' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Join discussion' })).toHaveCount(0);
    await expect(main.getByRole('link', { name: /^(Posts|Discussion|Announcements)$/ })).toHaveCount(0);
    await expect(main.getByRole('link', { name: /^Announcement: / })).toHaveCount(0);
    expect(data.requests.some(r => r.includes('/announcements'))).toBe(false);
    if (persona === 'guest') expect(data.requests.some(r => r.endsWith('/modules'))).toBe(false);
    await noOverflow(page); expect(data.unexpected).toEqual([]);
    await screenshot(page, `${persona}-390`);
    if (persona === 'error') {
      data.recoverMembership(); await main.getByRole('button', { name: 'Retry Verification' }).click();
      await expect(main.getByRole('link', { name: 'Join discussion' })).toBeVisible();
    }
  });
}

test('Unknown membership hides protected cards until verification finishes', async ({ page }) => {
  const data = await fixture(page, 'loading'); await page.goto('/');
  await expect(page.getByText('Checking account…', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Join discussion' })).toHaveCount(0);
  expect(data.requests.some(r => r.includes('/announcements'))).toBe(false);
  data.release(); await expect(page.locator('main').getByRole('link', { name: 'Join discussion' })).toBeVisible();
});

test('Real API errors remain visible and retry independently; empty data stays honest', async ({ page }) => {
  const data = await fixture(page); data.setFeedFailure(true); data.setModulesFailure(true);
  await page.goto('/');
  await expect(page.locator('main')).toContainText('Announcements temporarily unavailable');
  await expect(page.locator('main')).toContainText('Modules temporarily unavailable');
  data.setFeedFailure(false); data.setModulesFailure(false);
  await page.getByRole('region', { name: 'Latest announcements', exact: true }).getByRole('button', { name: 'Retry Loading' }).click();
  await page.getByRole('region', { name: 'Community modules', exact: true }).getByRole('button', { name: 'Retry Loading' }).click();
  await expect(page.locator('main article')).toHaveCount(3);
  await expect(page.locator('main').getByRole('link', { name: /^Module: / })).toHaveCount(4);
  data.setEmpty(); await page.reload();
  await expect(page.locator('main')).toContainText('No announcements published yet.');
  await expect(page.locator('main')).toContainText('No modules found.');
});

for (const width of [1672, 390, 320]) {
  test(`Long content at ${width}: safe text and no overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 480 : 941 });
    await fixture(page, 'active', false, true); await page.goto('/');
    await expect(page.locator('main').getByRole('link', { name: /^Module: / })).toHaveCount(4);
    await expect(page.locator('main article')).toHaveCount(3);
    await expect(page.locator('main script')).toHaveCount(0);
    await noOverflow(page); await screenshot(page, `long-content-${width}`);
  });
}

test('Desktop sidebar collapse and short-height account controls stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 480 });
  await fixture(page); await page.goto('/');
  await expect(page.locator('main article')).toHaveCount(3);
  const sidebar = page.getByRole('complementary', { name: 'Desktop Sidebar' });
  await sidebar.getByRole('button', { name: 'Logout', exact: true }).scrollIntoViewIfNeeded();
  await expect(sidebar.getByRole('button', { name: 'Logout', exact: true })).toBeInViewport();
  await sidebar.getByLabel('Dark', { exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Hide navigation' }).click();
  await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await expect(sidebar).toBeVisible(); await noOverflow(page);
  await screenshot(page, 'desktop-short-dark');
});

for (const persona of ['active', 'guest', 'error'] as const) {
  test(`Short mobile ${persona}: appearance, account controls, Escape and touch targets`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await fixture(page, persona); await page.goto('/');
    await expect(page.locator('main').getByRole('link', { name: 'Browse modules', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open navigation menu' }).click();
    const nav = page.getByRole('navigation', { name: 'Mobile Navigation' });
    await nav.getByLabel('Dark', { exact: true }).check();
    const action = persona === 'guest' ? nav.getByRole('link', { name: 'Register', exact: true }) : nav.getByRole('button', { name: 'Logout', exact: true });
    await action.scrollIntoViewIfNeeded(); await expect(action).toBeInViewport();
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await screenshot(page, `drawer-${persona}-320-short`, false);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeFocused();
    await noOverflow(page); await screenshot(page, `${persona}-dark-320-short`);
  });
}
