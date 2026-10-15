import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type AnnouncementCard from '../src/components/AnnouncementCard';

type State = 'guest' | 'nonmember' | 'pending' | 'rejected' | 'active' | 'failure';
const fixtureUser = { id: 'acceptance-user', username: 'u'.repeat(50), email: 'fixture@example.com', first_name: 'Amina', family_name: 'Student' };
const notice = { id: 'a0000000-0000-0000-0000-000000000001', title: 'Acceptance notice', content: 'Read the community notice.', created_at: '2026-10-05T12:00:00Z' };
const member = (state: State) => ({ membership: state === 'nonmember' ? null : {
  id: 'acceptance-member', status: state === 'pending' ? 'PENDING' : state === 'rejected' ? 'REJECTED' : 'ACTIVE', role: 'MEMBER',
}, capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false } });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function portal(page: Page, state: State) {
  const fixture = { state, notices: [notice], authReads: 0, membershipReads: 0, feedReads: 0, socket: null as WebSocketRoute | null };
  await page.route('**/api/v1/**', async (route) => {
    // All API traffic is explicitly mocked. Unexpected mutations are aborted.
    if (route.request().method() !== 'GET') return route.abort();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/auth/me')) {
      fixture.authReads++;
      return route.fulfill({ status: fixture.state === 'guest' ? 401 : 200,
        json: fixture.state === 'guest' ? { detail: 'Not authenticated' } : fixtureUser });
    }
    if (pathname.endsWith('/membership/me')) {
      fixture.membershipReads++;
      return route.fulfill({ status: fixture.state === 'failure' ? 500 : 200,
        json: fixture.state === 'failure' ? { detail: 'Verification unavailable' } : member(fixture.state) });
    }
    if (pathname.endsWith('/announcements')) {
      fixture.feedReads++;
      return route.fulfill({ json: fixture.notices });
    }
    if (pathname.endsWith(`/announcements/${notice.id}`)) return route.fulfill({ json: notice });
    if (pathname.endsWith('/modules') || pathname.endsWith('/documents/pending') || pathname.endsWith('/discussion/stickers')) return route.fulfill({ json: [] });
    if (pathname.endsWith('/posts') || pathname.endsWith('/replies')) return route.fulfill({ json: { items: [], next_cursor: null } });
    if (pathname.endsWith('/discussion/messages')) return route.fulfill({ json: { items: [], older_cursor: null, has_more_older: false } });
    return route.fulfill({ status: 404, json: { detail: 'No acceptance fixture' } });
  });
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', (socket) => { fixture.socket = socket; });
  return fixture;
}

async function noProtectedHome(page: Page) {
  const main = page.locator('main');
  await expect(main.locator('article')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Latest announcements' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: /^(Posts|Discussion|All announcements|Review pending documents)$/ })).toHaveCount(0);
}

async function dimensions(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const clipped = await page.locator('main').evaluate((main) => [...main.querySelectorAll<HTMLElement>('p,h1,h2,h3,a,button')]
    .filter((element) => element.clientWidth && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1))
    .map((element) => element.textContent));
  expect(clipped).toEqual([]);
}

async function doubleText(page: Page) {
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('header,header *,main,main *')].map((element) => ({
      element, size: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight),
    }));
    for (const { element, size, line } of sizes) {
      element.style.fontSize = `${size * 2}px`;
      if (Number.isFinite(line)) element.style.lineHeight = `${line * 2}px`;
    }
  });
}

test.describe('Home navigation acceptance — isolated mocked APIs', () => {
  test('Initial account → active waits for membership confirmation with no protected-content flash', async ({ page }, info) => {
    const fixture = await portal(page, 'active');
    const auth = gate(), membership = gate();
    let membershipStarted = false;
    await page.route('**/api/v1/auth/me', async (route) => { await auth.promise; await route.fulfill({ json: fixtureUser }); });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => { membershipStarted = true; await membership.promise; await route.fulfill({ json: member('active') }); });
    await page.goto('/');
    await expect(page.locator('main').getByRole('status')).toHaveText('Checking account…');
    await noProtectedHome(page);
    expect(fixture.feedReads).toBe(0);
    auth.release();
    await expect.poll(() => membershipStarted).toBe(true);
    await expect(page.locator('main').getByRole('status')).toHaveText('Checking account…');
    await noProtectedHome(page);
    await expect(page.locator('main')).not.toContainText('You have not yet requested');
    await expect(page.locator('main')).toContainText('Module resources require sign-in.');
    await page.screenshot({ path: info.outputPath('initial-membership-confirmation.png'), fullPage: true });
    membership.release();
    await expect(page.locator('main article')).toHaveCount(1);
    await expect(page.locator('header')).toContainText('ACTIVE MEMBER');
    await expect(page.locator('main')).toContainText('Active IRM member');
  });

  for (const outcome of ['failure', 'guest', 'nonmember'] as const) {
    test(`Observed active → ${outcome} clears Home cards via existing access revalidation`, async ({ page }, info) => {
      const fixture = await portal(page, 'active');
      await page.goto('/');
      await expect(page.locator('main article')).toHaveCount(1);
      await page.locator('main').getByRole('link', { name: 'Discussion', exact: true }).click();
      await expect(page.getByText('Live', { exact: true })).toBeVisible();
      const auth = gate(), membership = gate();
      let authStarted = false, memberStarted = false;
      await page.route('**/api/v1/auth/me', async (route) => {
        fixture.authReads++; authStarted = true;
        await auth.promise;
        await route.fulfill({ status: outcome === 'guest' ? 401 : 200,
          json: outcome === 'guest' ? { detail: 'Session expired' } : fixtureUser });
      });
      await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
        fixture.membershipReads++; memberStarted = true;
        await membership.promise;
        await route.fulfill({ status: outcome === 'failure' ? 500 : 200,
          json: outcome === 'failure' ? { detail: 'Verification unavailable' } : member('nonmember') });
      });
      const authBefore = fixture.authReads;
      await fixture.socket!.close({ code: 1008, reason: 'Revalidate access' });
      await expect.poll(() => authStarted).toBe(true);
      expect(fixture.authReads).toBe(authBefore + 1);
      // Return with the real AuthProvider refresh still pending. No context injection.
      await page.locator('header').getByRole('link', { name: 'IRM Hub', exact: true }).click();
      await expect(page.locator('main article')).toHaveCount(1);
      await expect(page.locator('header').getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
      auth.release();
      if (outcome !== 'guest') {
        await expect.poll(() => memberStarted).toBe(true);
        membership.release();
      }
      await noProtectedHome(page);
      const feedsAfterLoss = fixture.feedReads;
      if (outcome === 'failure') {
        await expect(page.locator('header')).toContainText('Membership unavailable');
        await expect(page.locator('main').getByRole('alert')).toContainText('could not be verified');
        await expect(page.locator('main')).not.toContainText('You have not yet requested');
        await page.screenshot({ path: info.outputPath('active-to-verification-failure.png'), fullPage: true });
        const retry = gate(); let retryStarted = false;
        await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: fixtureUser }));
        await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
          retryStarted = true; await retry.promise; await route.fulfill({ json: member('active') });
        });
        fixture.notices = [{ ...notice, title: 'Fresh notice after retry' }];
        await page.getByRole('button', { name: 'Retry Verification' }).click();
        await expect.poll(() => retryStarted).toBe(true);
        await expect(page.locator('main').getByRole('status')).toHaveText('Checking membership…');
        await expect(page.locator('header')).toContainText('Checking membership…');
        await noProtectedHome(page);
        expect(fixture.feedReads).toBe(feedsAfterLoss);
        await expect(page.locator('main').getByRole('link', { name: 'Browse Modules' })).toBeVisible();
        await expect(page.locator('header').getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
        retry.release();
        await expect(page.locator('main article h3')).toHaveText('Fresh notice after retry');
        await expect(page.locator('main')).not.toContainText(notice.title);
        await expect(page.locator('header')).toContainText('ACTIVE MEMBER');
      } else {
        await expect(page.locator('main').getByRole('link', { name: outcome === 'guest' ? 'Log In' : 'Request IRM Membership', exact: true })).toBeVisible();
        if (outcome === 'guest') await expect(page.locator('header').getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
        else await expect(page.locator('header')).toContainText('No membership');
        await expect(page.locator('main')).not.toContainText(notice.title);
        expect(fixture.feedReads).toBe(feedsAfterLoss);
      }
    });
  }

  test('Pending → active after browser refresh stays neutral until confirmed', async ({ page }) => {
    const fixture = await portal(page, 'pending');
    await page.goto('/');
    await expect(page.locator('main')).toContainText('under review by the community Delegate');
    expect(fixture.feedReads).toBe(0);
    fixture.state = 'active';
    const lookup = gate(); let started = false;
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      started = true; fixture.membershipReads++; await lookup.promise; await route.fulfill({ json: member('active') });
    });
    const authBefore = fixture.authReads;
    await page.reload();
    await expect.poll(() => started).toBe(true);
    expect(fixture.authReads).toBe(authBefore + 1);
    await noProtectedHome(page);
    await expect(page.locator('main').getByRole('status')).toHaveText('Checking account…');
    lookup.release();
    await expect(page.locator('main article')).toHaveCount(1);
    await expect(page.locator('main').getByRole('link', { name: 'Check Application Status' })).toHaveCount(0);
    await expect(page.locator('header')).toContainText('ACTIVE MEMBER');
  });

  test('Guest links activate Modules, Login and Register and return through existing Home links', async ({ page }) => {
    await portal(page, 'guest');
    await page.goto('/');
    for (const [name, href, heading] of [
      ['Browse Modules', '/communities/irm/modules', 'IRM Modules'],
      ['Log In', '/login', 'Log In'], ['Create an Account', '/register', 'Create an Account'],
    ]) {
      const link = page.locator('main').getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await link.focus(); await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`http://127.0.0.1:3103${href}`);
      await expect(page.locator('main').getByRole('heading', { name: heading, exact: true })).toBeVisible();
      const home = page.locator('main').getByRole('link', { name: '← Back to Home', exact: true });
      await expect(home).toHaveAttribute('href', '/');
      await home.click();
      await expect(page).toHaveURL('http://127.0.0.1:3103/');
      await noProtectedHome(page);
    }
  });

  for (const state of ['nonmember', 'pending', 'rejected'] as const) {
    test(`${state} membership guidance activates the status/request/reapplication destination and returns`, async ({ page }) => {
      await portal(page, state);
      await page.goto('/');
      const name = { nonmember: 'Request IRM Membership', pending: 'Check Application Status', rejected: 'Reapply for Membership' }[state];
      const link = page.locator('main').getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', '/account#community-membership');
      await link.click();
      await expect(page).toHaveURL(/\/account#community-membership$/);
      await expect(page.locator('main').getByRole('heading', { name: 'Community membership' })).toBeVisible();
      await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page).toHaveURL('http://127.0.0.1:3103/');
      await expect(page.locator('main').getByRole('link', { name, exact: true })).toBeVisible();
      await noProtectedHome(page);
    });
  }

  test('Active Home destinations activate actual routes, retain Header active state, and return', async ({ page }) => {
    await portal(page, 'active');
    await page.goto('/');
    for (const [name, suffix, heading, headerName] of [
      ['Browse Modules', 'modules', 'IRM Modules', 'Modules'],
      ['Membership status', 'membership', 'IRM Membership', 'Membership'],
      ['Review pending documents', 'documents/pending', 'Pending Documents', 'Pending Docs'],
      ['Posts', 'posts', 'Community Posts', 'Posts'],
      ['Discussion', 'discussion', 'General Discussion', 'Discussion'],
      ['All announcements', 'announcements', 'IRM Announcements', 'Announcements'],
      [`Announcement: ${notice.title}`, `announcements/${notice.id}`, notice.title, 'Announcements'],
    ]) {
      const link = page.locator('main').getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', `/communities/irm/${suffix}`);
      await link.click();
      await expect(page).toHaveURL(`http://127.0.0.1:3103/communities/irm/${suffix}`);
      await expect(page.locator('main').getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Main Navigation', exact: true }).getByRole('link', { name: headerName, exact: true })).toHaveAttribute('aria-current', 'page');
      await page.locator('main').getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page).toHaveURL('http://127.0.0.1:3103/');
      await expect(page.locator('main article')).toHaveCount(1);
    }
  });

  test('Keyboard order follows Home reading order; mobile selection and dismissal leave focus usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await portal(page, 'active');
    await page.goto('/');
    await expect(page.locator('main article')).toHaveCount(1);
    const toggle = page.getByRole('button', { name: 'Open navigation menu' });
    await toggle.focus(); await page.keyboard.press('Enter');
    const nav = page.getByRole('navigation', { name: 'Mobile Navigation', exact: true });
    await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(nav).toHaveCount(0);
    for (const name of ['Membership status', 'Browse Modules', 'Review pending documents', 'Posts', 'Discussion', 'All announcements', `Announcement: ${notice.title}`]) {
      await page.keyboard.press('Tab');
      const link = page.locator('main').getByRole('link', { name, exact: true });
      await expect(link).toBeFocused();
      await expect(link).toHaveCSS('outline-style', 'solid');
      await expect(link).toHaveCSS('outline-width', '2px');
    }
    await page.keyboard.press('Tab');
    await expect(page.locator('main a:has(article)')).not.toBeFocused();
    await toggle.focus(); await page.keyboard.press('Enter');
    const modules = nav.getByRole('link', { name: 'Modules', exact: true });
    await modules.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/modules$/);
    await expect(nav).toHaveCount(0);
    await toggle.focus(); await page.keyboard.press('Enter');
    await nav.getByRole('link', { name: 'Home', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('http://127.0.0.1:3103/');
    await expect(nav).toHaveCount(0);
    await toggle.focus(); await page.keyboard.press('Tab');
    await expect(page.locator('main').getByRole('link', { name: 'Membership status' })).toBeFocused();
  });

  for (const width of [320, 768, 1024, 1280, 1440]) {
    test(`Guest responsive gap at ${width}px retains compact welcome, hierarchy and disclosure`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
      await portal(page, 'guest');
      await page.goto('/');
      await expect(page.locator('main').getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
      await dimensions(page);
      const primary = page.locator('main .ui-button--primary');
      await expect(primary).toHaveCount(1);
      await expect(primary).toHaveText('Browse Modules');
      await expect(page.locator('main')).toContainText('upload documents, preview first pages of pending documents, vote on pending resources, and use community spaces');
      await page.screenshot({ path: info.outputPath(`guest-${width}.png`), fullPage: true });
    });
  }

  test('Active missing 1280px viewport: heading hierarchy, long titles, no fixed-height truncation', async ({ page }, info) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    const fixture = await portal(page, 'active');
    fixture.notices = [{ ...notice, title: 'Long announcement heading '.repeat(9), content: 'unbroken'.repeat(40) }];
    await page.goto('/');
    await expect(page.locator('main article')).toHaveCount(1);
    await dimensions(page);
    expect(await page.locator('main h1,main h2,main h3').evaluateAll((headings) => headings.map((element) => element.tagName))).toEqual(['H1', 'H2', 'H2', 'H3', 'H3', 'H2', 'H3']);
    await expect(page.locator('main .ui-button--primary')).toHaveCount(1);
    await expect(page.locator('main article h3')).toHaveCSS('-webkit-line-clamp', 'none');
    await page.screenshot({ path: info.outputPath('active-long-title-1280-short.png'), fullPage: true });
  });

  for (const state of ['guest', 'pending', 'rejected', 'failure'] as const) {
    test(`${state} at 320×480 with doubled text: complete guidance and reachable controls`, async ({ page }, info) => {
      await page.setViewportSize({ width: 320, height: 480 });
      await portal(page, state);
      await page.goto('/');
      await expect(page.locator('main').getByRole('link', { name: 'Browse Modules' })).toBeVisible();
      if (state === 'failure') await expect(page.locator('main').getByRole('alert')).toBeVisible();
      else await expect(page.locator('main').getByRole('link', { name: state === 'guest' ? 'Log In' : state === 'pending' ? 'Check Application Status' : 'Reapply for Membership', exact: true })).toBeVisible();
      await doubleText(page);
      await dimensions(page);
      await noProtectedHome(page);
      for (const control of await page.locator('main a,main button').all()) {
        await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport();
      }
      await page.screenshot({ path: info.outputPath(`${state}-200-percent-text-320-short.png`), fullPage: true });
    });
  }

  test('Feed error and retry wrap at 320px with enlarged text while Modules navigation remains usable', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await portal(page, 'active');
    let fail = true;
    await page.route('**/api/v1/communities/irm/announcements?*', (route) => route.fulfill(fail
      ? { status: 500, json: { detail: 'Temporary feed failure '.repeat(15) } } : { json: [notice] }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Retry Loading' })).toBeVisible();
    await doubleText(page);
    await dimensions(page);
    await page.screenshot({ path: info.outputPath('feed-error-200-percent-text-320.png'), fullPage: true });
    fail = false;
    await page.getByRole('button', { name: 'Retry Loading' }).click();
    await expect(page.locator('main article')).toHaveCount(1);
    await page.locator('main').getByRole('link', { name: 'Browse Modules', exact: true }).click();
    await expect(page).toHaveURL(/\/modules$/);
  });

  test('Card API preserves default/home heading levels, prefetch and deterministic date/excerpt formatting', () => {
    const filename = path.resolve(__dirname, '../src/components/AnnouncementCard.tsx');
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    const moduleExports = {} as { default: typeof AnnouncementCard };
    runInNewContext(compiled, { exports: moduleExports, require: createRequire(filename) });
    for (const variant of ['default', 'home'] as const) {
      for (const headingLevel of ['h2', 'h3'] as const) {
        const element = moduleExports.default({ announcement: { ...notice, content: `  First\n\t second ${'x'.repeat(200)}  `, author_username: 'publisher' }, variant, headingLevel, communitySlug: 'irm' });
        expect(element.props.prefetch).toBe(false);
        expect(element.props.href).toBe(`/communities/irm/announcements/${notice.id}`);
        const [metadata, heading, excerpt] = element.props.children.props.children;
        expect(heading.type).toBe(headingLevel);
        expect(excerpt.props.children).toBe(`First second ${'x'.repeat(147)}…`);
        expect(metadata.props.children[0].props.dateTime).toBe(notice.created_at);
        expect(metadata.props.children[0].props.children).toBe('Oct 5, 2026');
      }
    }
    const fallback = moduleExports.default({ announcement: { ...notice, created_at: 'invalid-date', content: '  Short\ntext  ' } });
    expect(fallback.props.children.props.children[0].props.children[0].props.children).toBe('invalid-date');
    expect(fallback.props.children.props.children[1].type).toBe('h3');
    expect(fallback.props.children.props.children[2].props.children).toBe('Short text');
  });
});
