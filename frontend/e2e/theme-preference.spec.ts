import { test, expect, type BrowserContext, type Page } from './moderation-fixtures';

interface PortalState {
  username: string | null;
  membershipFailure: boolean;
  requests: string[];
  errors: string[];
}

const states = new WeakMap<BrowserContext, PortalState>();

test.beforeEach(async ({ context, page, baseURL }) => {
  const state: PortalState = { username: null, membershipFailure: false, requests: [], errors: [] };
  states.set(context, state);
  const watch = (watched: Page) => {
    watched.on('pageerror', error => state.errors.push(error.message));
    watched.on('console', message => {
      if (message.type() === 'error' && /hydration|hydrated|did not match/i.test(message.text())) {
        state.errors.push(message.text());
      }
    });
  };
  watch(page);
  context.on('page', watch);
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/v1/')) {
      // Every API request is fulfilled locally, including logout/login mutations.
      state.requests.push(`${route.request().method()} ${url.pathname}`);
      const user = { id: 'theme-fixture', username: state.username, email: 'fixture@example.com',
        first_name: 'Theme', family_name: 'Fixture' };
      if (url.pathname.endsWith('/auth/login')) {
        state.username = 'second_account';
        return route.fulfill({ json: { ...user, username: state.username } });
      }
      if (url.pathname.endsWith('/auth/logout')) {
        state.username = null;
        return route.fulfill({ status: 204 });
      }
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ status: state.username ? 200 : 401,
        json: state.username ? user : { detail: 'Not authenticated' } });
      if (url.pathname.endsWith('/membership/me')) return route.fulfill({
        status: state.membershipFailure ? 500 : 200,
        json: state.membershipFailure ? { detail: 'Verification unavailable' } : {
          membership: { id: 'theme-membership', status: 'ACTIVE', role: 'MEMBER' }, capabilities: {} },
      });
      return route.fulfill({ status: 404, json: { detail: 'No fixture for this request' } });
    }
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    state.errors.push(`Blocked unexpected network request: ${url.origin}${url.pathname}`);
    return route.abort();
  });
});

test.afterEach(async ({ context }) => {
  expect(states.get(context)!.errors).toEqual([]);
});

async function appearance(page: Page) {
  return page.locator('[data-theme-control]:visible').first();
}

async function choose(page: Page, label: string) {
  if (label === 'System') {
    const system = page.locator('button:visible').filter({ hasText: 'Use system appearance' }).first();
    if (await system.count() === 0) await page.getByRole('button', { name: 'Account options', exact: true }).click();
    await system.click();
  } else {
    const control = await appearance(page);
    const wanted = label.toLowerCase();
    const resolved = await page.locator('html').getAttribute('data-theme');
    // A System preference already matching the desired mode needs two toggles
    // to deliberately choose that explicit appearance.
    if (resolved === wanted) await control.click();
    await (await appearance(page)).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', label.toLowerCase());
}

async function expectTheme(page: Page, theme: string, preference: string) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', preference);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`First visit follows ${scheme} System and exposes System as the selected preference`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/login');
    await expectTheme(page, scheme, 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
    expect(await page.evaluate(() => localStorage.getItem('irm-theme'))).toBeNull();
  });

  test(`Explicit ${scheme} survives reload and ignores opposite system appearance`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: scheme === 'light' ? 'dark' : 'light' });
    await page.goto('/login');
    await choose(page, scheme === 'light' ? 'Light' : 'Dark');
    await page.reload();
    await expectTheme(page, scheme, scheme);
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', scheme);
    expect(await page.evaluate(() => localStorage.getItem('irm-theme'))).toBe(scheme);
  });

  test(`Head bootstrap applies ${scheme} System with hydration scripts blocked`, async ({ context, page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await context.route('**/_next/**/*.js*', route => route.abort());
    const response = await page.goto('/login');
    const html = await response!.text();
    expect(html.indexOf('id="irm-theme-init"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="irm-theme-init"')).toBeLessThan(html.indexOf('<body'));
    await expectTheme(page, scheme, 'system');
    expect(states.get(context)!.requests).toEqual([]); // No hydrated AuthProvider requests.
    // This proves execution before hydration, not a visually measured flash-free first frame.
  });
}

test('System remains selected through OS changes; explicit modes ignore changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await choose(page, 'Light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'light', 'light');
  await choose(page, 'System');
  await expectTheme(page, 'dark', 'system');
  await choose(page, 'Dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark', 'dark');
  await choose(page, 'System');
  await expectTheme(page, 'light', 'system');
});

test('Dark OS System action turns off to persistent Light and can be enabled again', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  await choose(page, 'Dark');
  const system = page.getByRole('button', { name: 'Use system appearance' });
  await expect(system).toHaveAttribute('aria-pressed', 'false');

  await system.click();
  await expectTheme(page, 'dark', 'system');
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await expect(system).toContainText('✓');

  await system.click();
  await expectTheme(page, 'light', 'light');
  await expect(system).toHaveAttribute('aria-pressed', 'false');
  await expect(system).not.toContainText('✓');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 242, 238)');
  expect(await page.evaluate(() => localStorage.getItem('irm-theme'))).toBe('light');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'light', 'light');
  await page.reload();
  await expectTheme(page, 'light', 'light');
  await page.goto('/register');
  await expectTheme(page, 'light', 'light');
  await expect(page.getByRole('button', { name: 'Use system appearance' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Use system appearance' }).click();
  await expectTheme(page, 'dark', 'system');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 22, 27)');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expectTheme(page, 'light', 'light');
  await expect(page.getByRole('button', { name: 'Use system appearance' })).toHaveAttribute('aria-pressed', 'false');
});

for (const corrupt of ['', 'invalid', '{"theme":"dark"}']) {
  test(`Corrupt stored value ${JSON.stringify(corrupt)} resolves System`, async ({ context, page }) => {
    await context.addInitScript(value => localStorage.setItem('irm-theme', value), corrupt);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await expectTheme(page, 'dark', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  });
}

for (const failure of ['getter', 'read', 'write'] as const) {
  test(`Storage ${failure} failure preserves rendering and current-page choices`, async ({ context, page }) => {
    await context.addInitScript(kind => {
      if (kind === 'getter') {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
      } else if (kind === 'read') {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === 'irm-theme') throw new Error('Read unavailable');
          return original.call(this, key);
        };
      } else {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'irm-theme') throw new Error('Write unavailable');
          original.call(this, key, value);
        };
      }
    }, failure);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    await expectTheme(page, 'dark', 'system');
    await choose(page, 'Light');
    await expectTheme(page, 'light', 'light');
    await choose(page, 'System');
    await expectTheme(page, 'dark', 'system');
  });
}

test('Missing matchMedia is safe and explicit Dark remains available', async ({ context, page }) => {
  await context.addInitScript(() => Object.defineProperty(window, 'matchMedia', { value: undefined }));
  await page.goto('/login');
  await expectTheme(page, 'light', 'system');
  await choose(page, 'Dark');
  await expectTheme(page, 'dark', 'dark');
  await choose(page, 'System');
  await expectTheme(page, 'light', 'system');
});

test('Real cross-tab changes and key removal update the other tab', async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  const other = await context.newPage();
  await other.setViewportSize({ width: 1440, height: 900 });
  await other.emulateMedia({ colorScheme: 'dark' });
  await other.goto('/login');
  await choose(page, 'Light');
  await expectTheme(other, 'light', 'light');
  await expect(other.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await choose(other, 'Dark');
  await expectTheme(page, 'dark', 'dark');
  await other.evaluate(() => localStorage.removeItem('irm-theme'));
  await expectTheme(page, 'dark', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
});

test('Theme survives logout, account changes and client navigation without extra auth requests', async ({ context, page }) => {
  const state = states.get(context)!;
  state.username = 'first_account';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Context Bar' }).getByText('first_account', { exact: true })).toBeVisible();
  const requests = [...state.requests];
  await choose(page, 'Dark');
  expect(state.requests).toEqual(requests);
  await page.getByRole('button', { name: 'Account options', exact: true }).click();
  await page.getByRole('region', { name: 'Account options', exact: true }).getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expectTheme(page, 'dark', 'dark');
  await page.locator('#email').fill('fixture@example.com');
  await page.locator('#password').fill('fixture-password');
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/account#community-membership');
  await expect(page.getByRole('region', { name: 'Context Bar' }).getByText('second_account', { exact: true })).toBeVisible();
  await expectTheme(page, 'dark', 'dark');
  await page.getByRole('button', { name: 'Account options', exact: true }).click();
  await page.getByRole('region', { name: 'Account options', exact: true }).getByRole('link', { name: 'Support', exact: true }).click();
  await page.waitForURL('**/support');
  await expectTheme(page, 'dark', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('irm-theme'))).toBe('dark');
});

test('Verification failure does not gate Appearance or trigger an auth refresh on selection', async ({ context, page }) => {
  const state = states.get(context)!;
  state.username = 'member_fixture';
  state.membershipFailure = true;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Context Bar' }).getByRole('button', { name: /Switch to .* mode/ })).toBeVisible();
  const requests = [...state.requests];
  await choose(page, 'Dark');
  await expectTheme(page, 'dark', 'dark');
  expect(state.requests).toEqual(requests);
});

test('Desktop/mobile share the same choice in the top controls', async ({ page, context }) => {
  states.get(context)!.username = 'member_fixture';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await choose(page, 'Dark');
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await choose(page, 'Light');
  await expect(page.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page).toHaveURL(/\/$/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
});

for (const width of [320, 1440]) {
  test(`Compact toggle and System recovery support keyboard/focus and enlarged text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    const control = await appearance(page);
    const toggle = control;
    await toggle.focus();
    await expect(toggle).toHaveCSS('outline-style', 'solid');
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Space');
    await expectTheme(page, 'dark', 'dark');
    const system = page.getByRole('button', { name: 'Use system appearance' });
    await system.focus();
    await page.keyboard.press('Space');
    await expectTheme(page, 'light', 'system');
    await expect(system).toBeFocused();
    await expect(system).toHaveAttribute('aria-pressed', 'true');
    await page.addStyleTag({ content: '[data-theme-control], button[aria-pressed] { font-size: 24px; line-height: 32px; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
