import { test, expect, type Page } from '@playwright/test';

const fixtureUser = {
  id: 'guest-home-fixture',
  username: 'irm_student',
  email: 'fixture@example.test',
  first_name: 'IRM',
  family_name: 'Student',
};

async function mockGuest(page: Page) {
  const apiRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) apiRequests.push(`${request.method()} ${url.pathname}`);
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    }
    return route.fulfill({ status: 500, json: { detail: 'Unexpected protected request' } });
  });
  return apiRequests;
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
}

test.describe('Guest Home (mocked API only)', () => {
  test('holds a neutral checking state until /auth/me confirms a guest', async ({ page }) => {
    let release!: () => void;
    await page.route('**/api/v1/**', async route => {
      if (!new URL(route.request().url()).pathname.endsWith('/auth/me')) {
        return route.fulfill({ status: 500, json: { detail: 'Unexpected protected request' } });
      }
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: 'Checking your account' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('aside')).toHaveCount(0);
    await expect(page.locator('main').getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
    await expect(page.locator('main').getByRole('link', { name: 'Create an account' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Welcome to IRM Hub');
    release();
    await expect(page.locator('main').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('confirmed guest gets clear auth actions, useful content, and Support without protected fetches', async ({ page }) => {
    const requests = await mockGuest(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const main = page.locator('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(main.getByRole('heading', { level: 1 })).toContainText('A shared place');
    await expect(main.getByRole('link', { name: 'EtudSup home' })).toBeVisible();
    await expect(main.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login');
    await expect(main.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/register');
    await expect(main.getByRole('heading', { name: 'IRM student community' })).toBeVisible();
    await expect(main.getByRole('link', { name: /Sign in to explore IRM/ })).toHaveAttribute('href', '/login');
    await expect(main.getByText('Coming soon')).toBeVisible();
    await expect(main.getByRole('heading', { name: 'More communities' }).locator('..').getByRole('link')).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'Study resources' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Participation' })).toBeVisible();
    await expect(main.getByRole('link', { name: /Visit Support/ })).toHaveAttribute('href', '/support');
    await expect(main.getByRole('link', { name: /modules|announcements|discussion|posts|membership|documents/i })).toHaveCount(0);
    await expect(main.locator('article')).toHaveCount(8);
    await expect(main.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('aside')).toHaveCount(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(request => request === 'GET /api/v1/auth/me')).toBe(true);
    await page.locator('main').getByRole('link', { name: /Visit Support/ }).click();
    await expect(page).toHaveURL(/\/support$/);
  });

  test('authenticated transition keeps signed-in Home and membership verification error', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/v1/')) requests.push(url.pathname);
    });
    let release!: () => void;
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/me')) {
        await new Promise<void>(resolve => { release = resolve; });
        return route.fulfill({ status: 200, json: fixtureUser });
      }
      if (path.endsWith('/membership/me')) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
      if (path.endsWith('/modules')) return route.fulfill({ json: [] });
      return route.fulfill({ status: 500, json: { detail: 'Unexpected request' } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: 'Checking your account' })).toBeVisible();
    release();
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: /Your resources\..*Your people\./ })).toBeVisible();
    await expect(main).toHaveCount(1);
    await expect(page.locator('aside[aria-label="Desktop Sidebar"]')).toHaveCount(1);
    await expect(main.getByText('Verification unavailable', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: /Retry verification/ })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
    expect(requests.some(path => path.endsWith('/membership/me'))).toBe(true);
  });

  test('auth links have visible keyboard focus and activate with Enter', async ({ page }) => {
    await mockGuest(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const signIn = page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Sign in', exact: true });
    await signIn.focus();
    await expect(signIn).toHaveCSS('outline-width', '3px');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('auth errors and a delayed retry never expose the guest welcome', async ({ page }) => {
    let retry = false;
    let release!: () => void;
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path !== '/api/v1/auth/me') throw new Error(`Unexpected request: ${path}`);
      if (!retry) return route.fulfill({ status: 503, json: { detail: 'Session check unavailable' } });
      await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'We couldn’t verify your account' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('aside')).toHaveCount(0);
    await expect(page.locator('[data-guest-home]')).toHaveCount(0);
    await expect(page.locator('[data-guest-primary-actions]')).toHaveCount(0);
    retry = true;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Checking your account' })).toBeVisible();
    await expect(page.locator('[data-guest-home]')).toHaveCount(0);
    await expect(page.locator('[data-guest-primary-actions]')).toHaveCount(0);
    release();
    await expect(page.locator('[data-guest-home]')).toBeVisible();
  });

  test('delayed successful authentication and membership retain the signed-in dashboard', async ({ page }) => {
    let resolveAuth!: () => void;
    let resolveMembership!: () => void;
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/me')) {
        await new Promise<void>(resolve => { resolveAuth = resolve; });
        return route.fulfill({ json: fixtureUser });
      }
      if (path.endsWith('/membership/me')) {
        await new Promise<void>(resolve => { resolveMembership = resolve; });
        return route.fulfill({ json: { membership: { status: 'ACTIVE', role: 'MEMBER' }, capabilities: {} } });
      }
      if (path.endsWith('/modules') || path.endsWith('/announcements')) return route.fulfill({ json: [] });
      throw new Error(`Unexpected request: ${path}`);
    });
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: 'Checking your account' })).toBeVisible();
    resolveAuth();
    await expect.poll(() => Boolean(resolveMembership)).toBe(true);
    await expect(page.locator('[data-guest-home]')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Checking your account' })).toBeVisible();
    resolveMembership();
    await expect(page.locator('main').getByRole('heading', { name: /Your resources\..*Your people\./ })).toBeVisible();
    await expect(page.locator('[data-guest-home-shell]')).toHaveCount(0);
    await expect(page.locator('[data-guest-home]')).toHaveCount(0);
  });

  test('landing header has useful destinations without a public application sidebar or mobile menu', async ({ page }) => {
    const requests = await mockGuest(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-guest-home]')).toBeVisible();
    await expect(page.locator('aside')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Landing navigation' }).getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support');
    await expect(page.locator('[data-guest-primary-actions]').getByRole('link')).toHaveCount(2);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopNav = page.getByRole('navigation', { name: 'Landing navigation' });
    expect(await desktopNav.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(['#communities', '/support', '/login', '/register']);
    await desktopNav.getByRole('link', { name: 'Communities' }).click();
    await expect(page).toHaveURL(/#communities$/);
    expect(requests.every(request => request === 'GET /api/v1/auth/me')).toBe(true);
  });

  test('secondary action follows Sign in in keyboard order and opens registration', async ({ page }) => {
    await mockGuest(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Sign in', exact: true }).focus();
    await page.keyboard.press('Tab');
    const create = page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Create an account' });
    await expect(create).toBeFocused();
    await expect(create).toHaveCSS('outline-width', '3px');
    await expect(create).toHaveCSS('text-decoration-line', 'none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('theme persistence and reduced motion use the existing theme system', async ({ page }) => {
    await mockGuest(page);
    await setTheme(page, 'dark');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-guest-home]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('irm-theme'))).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Sign in', exact: true })).toHaveCSS('transition-duration', '0s');
  });

  for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1280, 1440]) {
    test(`guest content fits ${width}px in ${theme} without horizontal overflow`, async ({ page }) => {
      await mockGuest(page);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Create an account' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => document.documentElement.clientWidth),
      );
      if (width < 1280) {
        const hero = await page.locator('main section[aria-labelledby="guest-home-heading"]').boundingBox();
        const actions = await page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Sign in', exact: true }).boundingBox();
        expect(actions!.y).toBeGreaterThan(hero!.y);
        if (width <= 390) {
          const create = await page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Create an account' }).boundingBox();
          expect(create!.y + create!.height).toBeLessThan(844);
          expect(actions!.height).toBeGreaterThanOrEqual(48);
          expect(create!.height).toBeGreaterThanOrEqual(48);
        }
      }
    });
  }

  }

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [390, 1440]) {
      test(`captures ${theme} guest page at ${width}px`, async ({ page }, info) => {
        await setTheme(page, theme);
        await mockGuest(page);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.goto('/');
        await expect(page.locator('[data-guest-primary-actions]').getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('main')).toHaveCSS('overflow-x', 'visible');
        await page.screenshot({ path: info.outputPath(`guest-${theme}-${width}.png`), fullPage: true });
      });
    }
  }
});
