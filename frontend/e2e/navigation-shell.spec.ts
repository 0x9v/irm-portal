import { test, expect, type Page } from './moderation-fixtures';

type Persona = 'guest' | 'none' | 'pending' | 'member' | 'moderator' | 'delegate' | 'banned';
const root = '/communities/irm';
const user = { id: 'nav-user', username: 'student_navigation_fixture', email: 'private@example.test', first_name: 'Student', family_name: 'Fixture' };

async function mockShell(page: Page, persona: Persona, voting = false) {
  const state = { username: user.username, signedOut: false, logoutCalls: 0, logoutStatus: 204, logoutRelease: undefined as undefined | (() => void), holdLogout: false, holdAuth: false, authRelease: undefined as undefined | (() => void) };
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) {
      if (state.holdAuth) await new Promise<void>(resolve => { state.authRelease = resolve; });
      return persona === 'guest' || state.signedOut
        ? route.fulfill({ status: 401, json: { detail: 'Not authenticated' } })
        : route.fulfill({ json: { ...user, username: state.username } });
    }
    if (url.pathname.endsWith('/membership/me')) {
      const status = persona === 'none' ? null : persona === 'pending' ? 'PENDING' : persona === 'banned' ? 'BANNED' : 'ACTIVE';
      return route.fulfill({ json: { membership: status ? { id: 'membership', status, role: persona === 'delegate' ? 'DELEGATE' : persona === 'moderator' ? 'MODERATOR' : 'MEMBER' } : null,
        capabilities: { create_announcements: false, upload_official_documents: false, manage_document_voting: voting } } });
    }
    if (url.pathname.endsWith('/auth/logout')) {
      state.logoutCalls++;
      if (state.holdLogout) await new Promise<void>(resolve => { state.logoutRelease = resolve; });
      if (state.logoutStatus === 204) state.signedOut = true;
      return state.logoutStatus === 204
        ? route.fulfill({ status: 204, body: '' })
        : route.fulfill({ status: state.logoutStatus, json: { detail: 'Logout failed' } });
    }
    if (url.pathname.endsWith('/modules')) return route.fulfill({ json: [] });
    if (url.pathname.endsWith('/announcements')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: 'Mocked page data unavailable' } });
  });
  return state;
}


async function openAccount(page: Page) {
  const trigger = page.getByRole('button', { name: 'Account options', exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  return page.getByRole('region', { name: 'Account options', exact: true });
}

const activeLinks = [
  ['Home', '/'], ['Modules', `${root}/modules`], ['Pending documents', `${root}/documents/pending`],
  ['Announcements', `${root}/announcements`], ['Posts', `${root}/posts`], ['Discussion', `${root}/discussion`],
  ['Saved documents', `${root}/documents/saved`],
  ['Recently opened', `${root}/documents/recent`], ['My submissions', `${root}/documents/mine`],
] as const;
const management = [
  ['Review applications', `${root}/membership/review`], ['Manage staff', `${root}/membership/staff`],
  ['Members', `${root}/membership/members`], ['Voting settings', `${root}/document-voting/settings`],
] as const;

for (const persona of ['none', 'pending', 'member', 'moderator', 'delegate', 'banned'] as const) {
  test(`${persona} desktop permissions and account context`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockShell(page, persona, persona === 'moderator' || persona === 'delegate');
    await page.goto('/');
    const sidebar = page.getByRole('complementary', { name: 'Desktop Sidebar' });
    const nav = sidebar.getByRole('navigation', { name: 'Main Navigation' });
    await expect(sidebar.getByRole('link', { name: 'EtudSup Home' })).toHaveAttribute('href', '/');
    await expect(sidebar).toContainText('IRM');
    await expect(sidebar).toContainText('FST Mohammedia');
    const profile = sidebar.locator('a[href="/account"]');
    await expect(profile).toContainText(user.username);
    await expect(profile).toContainText('View account');
    expect((await profile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(sidebar.getByRole('link', { name: 'Support' })).toHaveCount(0);
    const panel = await openAccount(page);
    await expect(panel).toContainText(user.username);
    await expect(panel.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
    await expect(panel.getByRole('button', { name: 'Logout' })).toBeVisible();
    await expect(panel.locator('a[href="/account"]')).toContainText('EtudSup account');
    await expect(panel.getByText('My account', { exact: true })).toHaveCount(0);
    await expect(panel).not.toContainText(user.email);
    const expected = persona === 'member' || persona === 'moderator' || persona === 'delegate'
      ? activeLinks : activeLinks.filter(([label]) => ['Home', 'Modules', 'Saved documents', 'Recently opened'].includes(label));
    for (const [label, href] of expected) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
    for (const [label] of activeLinks.filter(([label]) => !expected.some(([name]) => name === label))) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    for (const [label, href] of management) {
      const allowed = label === 'Voting settings' ? persona === 'moderator' || persona === 'delegate' : persona === 'delegate';
      if (allowed) await expect(nav.getByRole('link', { name: label })).toHaveAttribute('href', href);
      else await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
    }
    await expect(panel).toContainText('EtudSup account');
  });
}

test('Moderator without voting capability has no management links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockShell(page, 'moderator');
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main Navigation' }).getByText('Management')).toHaveCount(0);
});

test('nested routes mark only their owning link active', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockShell(page, 'delegate', true);
  for (const [path, label] of [
    [`${root}/modules/algo/documents/file`, 'Modules'], [`${root}/announcements/notice`, 'Announcements'],
    [`${root}/posts/thread`, 'Posts'], [`${root}/membership/review/application`, 'Review applications'],
    [`${root}/membership/staff`, 'Manage staff'], [`${root}/membership/members/profile`, 'Members'],
  ] as const) {
    await page.goto(path);
    const nav = page.getByRole('navigation', { name: 'Main Navigation' });
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
    const context = page.getByRole('region', { name: 'Context Bar' });
    await expect(context).toContainText(path.includes('/modules/') ? 'Modules / Document Reader'
      : path.includes('/announcements/') ? 'Announcements / Notice'
      : path.includes('/posts/') ? 'Student Posts / Discussion'
      : label === 'Review applications' ? 'Membership / Application Reviews'
      : label === 'Manage staff' ? 'Leadership / Manage Staff' : 'Leadership / Members');
  }
});

test('guest and unresolved auth never render signed navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await mockShell(page, 'member');
  state.holdAuth = true;
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Desktop Sidebar' })).toHaveCount(0);
  await expect.poll(() => Boolean(state.authRelease)).toBe(true);
  state.authRelease?.();
  await expect(page.getByRole('complementary', { name: 'Desktop Sidebar' })).toBeVisible();
  await page.unrouteAll();
  await mockShell(page, 'guest');
  for (const path of ['/', '/login', '/register']) {
    await page.goto(path);
    await expect(page.getByRole('complementary', { name: 'Desktop Sidebar' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open navigation menu' })).toHaveCount(0);
  }
});

test('desktop collapse and short-height access', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 510 });
  await mockShell(page, 'delegate', true);
  await page.goto('/');
  const sidebar = page.getByRole('complementary', { name: 'Desktop Sidebar' });
  await expect((await openAccount(page)).getByRole('button', { name: 'Logout' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Switch to .* mode/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await sidebar.getByRole('link', { name: 'Voting settings' }).focus();
  await expect(sidebar.getByRole('link', { name: 'Voting settings' })).toBeInViewport();
  const profile = sidebar.locator('a[href="/account"]');
  await expect(profile).toBeInViewport();
  const navBox = (await sidebar.locator('nav').locator('..').boundingBox())!;
  const profileBox = (await profile.boundingBox())!;
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(profileBox.y);
  const toggle = page.getByRole('button', { name: 'Hide navigation' });
  await toggle.click();
  await expect(sidebar).toHaveCount(0);
  await page.getByRole('button', { name: 'Show navigation' }).click();
  await expect(sidebar).toBeVisible();
});

test('mobile drawer mirrors desktop destinations and management gates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, 'delegate', true);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const drawer = page.locator('#mobile-navigation');
  const nav = drawer.getByRole('navigation', { name: 'Mobile Navigation' });
  for (const [label, href] of [...activeLinks, ...management]) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', href);
  }
  await expect(drawer.locator('a[href="/account"]')).toContainText(user.username);
  await expect(drawer.locator('[data-theme-control]')).toHaveCount(0);
  await expect(drawer.getByRole('link', { name: 'Support' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Logout' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Account options' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Account options' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dismiss navigation' })).toHaveCount(0);
  expect(await page.locator('[data-application-shell] > div').evaluateAll(nodes => nodes.some(node => (node as HTMLElement).inert))).toBe(false);
  await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation', includeHidden: true })).toHaveCount(1);
});

test('mobile drawer Escape, outside click, navigation and focus return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, 'member');
  await page.goto('/');
  const open = page.getByRole('button', { name: 'Open navigation menu' });
  await open.click();
  const drawer = page.locator('#mobile-navigation');
  await expect(drawer.getByRole('navigation', { name: 'Mobile Navigation' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Home' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await page.getByRole('button', { name: 'Dismiss navigation' }).click({ position: { x: 380, y: 500 } });
  await expect(drawer).toHaveCount(0);
  await open.click();
  await drawer.getByRole('link', { name: 'Modules' }).click();
  await expect(page).toHaveURL(/\/communities\/irm\/modules$/);
  await expect(drawer).toHaveCount(0);
  await open.click();
  await drawer.locator('a[href="/account"]').click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(drawer).toHaveCount(0);
});

test('shrinking mobile viewport for keyboard keeps drawer and page reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, 'member');
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 420 });
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const drawer = page.locator('#mobile-navigation');
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(421);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('main')).toBeVisible();
});

test('logout pending, error, retry and theme preference', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await mockShell(page, 'member');
  await page.goto('/');
  const panel = await openAccount(page);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await openAccount(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('irm-theme'))).toBe('dark');
  state.holdLogout = true;
  state.logoutStatus = 503;
  await panel.getByRole('button', { name: 'Logout' }).click();
  await expect(panel.getByRole('button', { name: 'Logout' })).toBeDisabled();
  await expect(panel.getByRole('status')).toContainText('Signing out');
  expect(state.logoutCalls).toBe(1);
  await expect.poll(() => Boolean(state.logoutRelease)).toBe(true);
  state.logoutRelease?.();
  await expect(panel.getByRole('alert')).toContainText('Logout failed');
  state.holdLogout = false;
  state.logoutStatus = 204;
  await panel.getByRole('button', { name: 'Retry logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${theme} ${width}px shell fits and controls are reachable`, async ({ page }, testInfo) => {
      await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
      await page.setViewportSize({ width, height: width === 1440 ? 650 : 800 });
      await mockShell(page, 'member');
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width < 1280) {
        const menu = page.getByRole('button', { name: 'Open navigation menu' });
        await expect(menu).toBeVisible();
        if (width === 390) await page.screenshot({ path: testInfo.outputPath(`${theme}-mobile-closed-390.png`), fullPage: true });
        await menu.click();
        await expect(page.locator('#mobile-navigation').getByRole('button', { name: 'Logout' })).toHaveCount(0);
        if (width === 390) await page.screenshot({ path: testInfo.outputPath(`${theme}-mobile-390.png`), fullPage: true });
      } else {
        await expect(page.getByRole('complementary', { name: 'Desktop Sidebar' })).toBeVisible();
        if (width === 1440) await page.screenshot({ path: testInfo.outputPath(`${theme}-desktop-1440.png`), fullPage: true });
      }
      const panel = await openAccount(page);
      await expect(panel.getByRole('button', { name: 'Logout' })).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-account-${width}.png`), fullPage: true });
    });
  }
}

for (const width of [320, 1440]) {
  test(`account disclosure keyboard and dismissal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockShell(page, 'member');
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Account options', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Account options', exact: true });
    const id = await trigger.getAttribute('aria-controls');
    await expect(panel).toHaveAttribute('id', id!);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(panel.locator('a[href="/account"]')).toBeFocused();
    await expect(panel.locator('a[href="/account"]')).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('link', { name: 'Support' })).toBeFocused();
    await expect(panel.getByRole('link', { name: 'Support' })).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('button', { name: 'Logout' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await openAccount(page);
    await page.locator('h1').click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await openAccount(page);
    await panel.getByRole('link', { name: 'Support' }).click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test(`logout error is retained on reopen, pending rejects duplicate and retry succeeds at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const state = await mockShell(page, 'member');
    state.holdLogout = true; state.logoutStatus = 503;
    await page.goto('/');
    const panel = await openAccount(page);
    await panel.getByRole('button', { name: 'Logout' }).click();
    await expect(panel.getByRole('button', { name: 'Logout' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Logout' }).evaluate(button => { (button as HTMLButtonElement).click(); });
    expect(state.logoutCalls).toBe(1);
    await expect.poll(() => !!state.logoutRelease).toBe(true);
    state.logoutRelease?.();
    await expect(panel.getByRole('alert')).toContainText('Logout failed');
    await expect(page.getByRole('button', { name: 'Account options', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await openAccount(page);
    await expect(panel.getByRole('alert')).toContainText('Logout failed');
    state.holdLogout = false; state.logoutStatus = 204;
    await panel.getByRole('button', { name: 'Retry logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(state.logoutCalls).toBe(2);
    await expect(page.getByRole('button', { name: 'Account options', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).toHaveCount(0);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${theme} ${width}px long identity and short viewport`, async ({ page }, testInfo) => {
      await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
      await page.setViewportSize({ width, height: 420 });
      const state = await mockShell(page, 'delegate', true);
      state.username = 'a_very_long_actual_account_identity_'.repeat(6);
      await page.goto('/');
      const trigger = page.getByRole('button', { name: 'Account options', exact: true });
      await expect(trigger).toBeVisible();
      await expect(page.locator('[data-theme-control]:visible')).toHaveCount(1);
      for (const control of [trigger, page.getByRole('button', { name: /Switch to .* mode/ })]) {
        const box = (await control.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const panel = await openAccount(page);
      await expect(panel.locator('strong')).toHaveText(state.username);
      await expect(panel).not.toContainText(user.email);
      await panel.getByRole('button', { name: 'Logout' }).focus();
      await expect(panel.getByRole('button', { name: 'Logout' })).toBeInViewport();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(420);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-long-account-${width}.png`) });
      await page.keyboard.press('Escape');
      if (width >= 1280) {
        const bar = page.getByRole('region', { name: 'Context Bar' });
        const barBox = (await bar.boundingBox())!;
        expect(barBox.height).toBeGreaterThanOrEqual(60);
        expect(barBox.height).toBeLessThanOrEqual(65);
        const navLink = page.getByRole('navigation', { name: 'Main Navigation' }).getByRole('link', { name: 'Voting settings' });
        await navLink.focus();
        await expect(navLink).toBeInViewport();
        await expect(navLink).toHaveCSS('text-decoration-line', 'none');
        await expect(bar.getByRole('button', { name: 'Hide navigation' })).toHaveCSS('text-decoration-line', 'none');
      }
    });
  }
}

test('theme options, drawer, account and bottom destinations cooperate', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await mockShell(page, 'member');
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openAccount(page);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('region', { name: 'Account options', exact: true })).toHaveCount(0);
  await expect(page.locator('#mobile-navigation').getByRole('link', { name: 'Home' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Account options', exact: true })).toBeFocused();
  const menu = page.getByRole('button', { name: 'Close navigation menu' });
  await menu.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#mobile-navigation').locator('a[href="/account"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeFocused();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await openAccount(page);
  const system = page.getByRole('region', { name: 'Account options' }).getByRole('button', { name: 'Use system appearance' });
  await expect(system).toHaveAttribute('aria-pressed', 'false');
  await system.click();
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('irm-theme'))).toBe('system');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await openAccount(page);
  const bottom = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
  await bottom.getByRole('link', { name: 'Modules', exact: true }).click();
  await expect(page).toHaveURL(/\/modules$/);
  await expect(page.getByRole('button', { name: 'Account options', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(bottom.getByRole('link', { name: 'Modules', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.setViewportSize({ width: 1440, height: 800 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('region', { name: 'Context Bar' })).toContainText('IRM / Modules');
});
