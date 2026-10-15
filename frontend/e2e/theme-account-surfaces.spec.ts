import { expect, test, type Locator } from './moderation-fixtures';

async function expectTextContrast(element: Locator, minimum = 4.5) {
  const ratio = await element.evaluate(node => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (channels: number[]) => channels.map(value => {
      const scaled = value / 255;
      return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(rgb(getComputedStyle(node).color));
    let ancestor: Element | null = node;
    while (ancestor && getComputedStyle(ancestor).backgroundColor === 'rgba(0, 0, 0, 0)') {
      ancestor = ancestor.parentElement;
    }
    if (!ancestor) throw new Error('No opaque backing surface');
    const background = luminance(rgb(getComputedStyle(ancestor).backgroundColor));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(minimum);
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1440]) {
    test(`${theme} account surfaces, Home tile and logout states at ${width}px`, async ({ context, page, baseURL }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && /hydrat|did not match/i.test(message.text())) errors.push(message.text());
      });
      let releaseLogout!: () => void;
      const logoutResponse = new Promise<void>(resolve => { releaseLogout = resolve; });
      await context.routeWebSocket(/.*/, socket => socket.close());
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/api/v1/')) {
          if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: {
            id: 'surface-fixture', username: 'delegate_fixture', email: 'fixture@example.com',
            first_name: 'Theme', family_name: 'Fixture',
          } });
          if (url.pathname.endsWith('/membership/me')) return route.fulfill({ json: {
            membership: { id: 'surface-membership', status: 'ACTIVE', role: 'DELEGATE' }, capabilities: {},
          } });
          if (url.pathname.endsWith('/auth/logout')) {
            await logoutResponse;
            return route.fulfill({ status: 500, json: { detail: 'Mock logout failure' } });
          }
          if (url.pathname.endsWith('/announcements')) return route.fulfill({ json: [] });
          return route.fulfill({ status: 404, json: { detail: 'No fixture' } });
        }
        if (url.origin === new URL(baseURL!).origin) return route.continue();
        errors.push(`Blocked unexpected request: ${url.origin}${url.pathname}`);
        return route.abort();
      });
      await context.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.getByRole('button', { name: 'Account options', exact: true }).click();
      const navigation = page.getByRole('region', { name: 'Account options', exact: true });
      const logout = navigation.getByRole('button', { name: 'Logout', exact: true });
      await expect(logout).toBeEnabled();
      await expectTextContrast(navigation.getByText('delegate_fixture', { exact: true }));
      await expectTextContrast(navigation.getByText('EtudSup account', { exact: true }));
      const control = page.locator('[data-theme-control]:visible');
      await expectTextContrast(control);
      await expect(control).toHaveAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
      await expect(navigation.getByRole('button', { name: 'Use system appearance' })).toHaveAttribute('aria-pressed', 'false');
      await logout.hover();
      await expectTextContrast(logout);
      await logout.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(logout).toBeFocused();
      await expect(logout).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Space');
      await expect(logout).toBeDisabled();
      await expect(logout).toContainText('Signing out…');
      releaseLogout();
      await expect(logout).toBeEnabled();
      const alert = navigation.getByRole('alert');
      await expect(alert).toContainText('Logout failed. Please try again.');
      await expectTextContrast(alert);
      const retry = alert.getByRole('button', { name: 'Retry logout' });
      await retry.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(retry).toBeFocused();
      await expect(retry).toHaveCSS('outline-style', 'solid');
      await expect(retry).toHaveCSS('outline-style', 'solid');
      expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await logout.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => localStorage.getItem('irm-theme'))).toBe(theme);
      expect(errors).toEqual([]);
    });
  }
}
