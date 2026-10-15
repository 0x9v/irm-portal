import { test, expect, type Page } from './moderation-fixtures';

const username = 'a_very_long_account_name_'.repeat(8);

async function mockShell(page: Page, guest = false) {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return guest
      ? route.fulfill({ status: 401, json: { detail: 'Not authenticated' } })
      : route.fulfill({ json: { id: 'u2-user', username, email: 'private@example.test' } });
    if (path.endsWith('/membership/me')) return route.fulfill({ json: {
      membership: { id: 'u2-membership', status: 'ACTIVE', role: 'MEMBER' }, capabilities: {},
    } });
    if (path.endsWith('/modules') || path.endsWith('/announcements')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: 'No fixture' } });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [390, 1440]) {
    test(`${theme} ${width}px header and preference screenshot`, async ({ page }, info) => {
      await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
      await page.setViewportSize({ width, height: 844 });
      await mockShell(page);
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const menu = page.getByRole('button', { name: 'Open navigation menu' });
      const account = page.getByRole('button', { name: 'Account options', exact: true });
      const toggle = page.getByRole('button', { name: `Switch to ${theme === 'light' ? 'dark' : 'light'} mode` });
      await expect(toggle).toBeVisible();
      await expect(account).toBeVisible();
      await expect(page.locator('[data-theme-control]:visible')).toHaveCount(1);
      if (width < 1280) {
        await expect(menu).toBeVisible();
        expect(await page.locator('header').first().evaluate(header => header.querySelector('button')?.getAttribute('aria-label'))).toBe('Open navigation menu');
        expect((await menu.boundingBox())!.x).toBeLessThan((await toggle.boundingBox())!.x);
        expect((await toggle.boundingBox())!.x).toBeLessThan((await account.boundingBox())!.x);
        await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).toBeVisible();
      } else {
        await expect(page.getByRole('region', { name: 'Context Bar' })).toBeVisible();
        await expect(menu).toHaveCount(0);
      }
      await expect(page.locator('[data-theme-control]:visible')).toHaveCSS('text-decoration-line', 'none');
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await account.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`u2-${theme}-${width}.png`), fullPage: true });
    });
  }
}

test('mobile disclosure order, focus return, and theme/System transitions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ colorScheme: 'light' });
  await mockShell(page);
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  await menu.click();
  await expect(page.locator('#mobile-navigation').getByRole('link', { name: 'Home' })).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  const account = page.getByRole('button', { name: 'Account options', exact: true });
  await account.click();
  const panel = page.getByRole('region', { name: 'Account options', exact: true });
  await expect(panel).toContainText(username);
  await expect(panel).not.toContainText('private@example.test');
  await menu.click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#mobile-navigation')).toBeVisible();
  await page.keyboard.press('Escape');
  await account.click();
  const system = panel.getByRole('button', { name: 'Use system appearance' });
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(system).toHaveAttribute('aria-pressed', 'false');
  await system.click();
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await system.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expect(system).toHaveAttribute('aria-pressed', 'false');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await system.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(system).toHaveAttribute('aria-pressed', 'true');
  await system.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(system).toHaveAttribute('aria-pressed', 'false');
  await system.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('guest navigation offers System without an account trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockShell(page, true);
  await page.goto('/support');
  await expect(page.getByRole('button', { name: 'Account options' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu' }).click();
  const menu = page.locator('#guest-home-navigation');
  await expect(menu.getByRole('button', { name: 'Use system appearance' })).toHaveAttribute('aria-pressed', 'true');
  await menu.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await menu.getByRole('button', { name: 'Use system appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await menu.getByRole('button', { name: 'Use system appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
});
