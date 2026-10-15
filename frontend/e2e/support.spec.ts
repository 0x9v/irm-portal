import { test, expect, type Page, type Locator } from './moderation-fixtures';

type Persona = 'guest' | 'member' | 'pending' | 'banned';
async function mockPage(page: Page, persona: Persona) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return persona === 'guest'
      ? route.fulfill({ status: 401, json: { detail: 'Not authenticated' } })
      : route.fulfill({ json: { id: 'f9-fixture', username: 'student_support_fixture', email: 'private@example.test', first_name: 'Private', family_name: 'Fixture' } });
    if (path.endsWith('/membership/me')) return route.fulfill({ json: { membership: {
      id: 'f9-membership', status: persona === 'pending' ? 'PENDING' : persona === 'banned' ? 'BANNED' : 'ACTIVE', role: 'MEMBER',
    }, capabilities: {} } });
    if (path.endsWith('/modules') || path.endsWith('/announcements')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: 'No local fixture' } });
  });
}
async function expectContrast(locator: Locator) {
  const ratio = await locator.evaluate(element => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (value: string) => rgb(value).map(v => { const x = v / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; })
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    let node: Element | null = element;
    while (node && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)') node = node.parentElement;
    if (!node) throw new Error('No backing surface');
    const foreground = luminance(getComputedStyle(element).color), background = luminance(getComputedStyle(node).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const persona of ['guest', 'member', 'pending', 'banned'] as const) {
  test(`${persona} Support identity, real contacts, help and navigation`, async ({ page }) => {
    await mockPage(page, persona);
    await page.goto('/support');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Support EtudSup');
    await expect(page.getByText('Student-built, community-supported')).toBeVisible();
    const main = page.locator('main');
    await expect(main).not.toContainText('IRM Hub');
    await expect(main).not.toContainText('What We Have Built');
    await expect(main).not.toContainText('private@example.test');
    const help = main.getByRole('region', { name: 'Need help with your account or community?' });
    await expect(help).toContainText('Help is available independently of contributions.');
    const nav = page.getByRole('navigation', { name: 'Support page navigation' });
    await expect(nav.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    if (persona === 'guest') {
      await expect(nav.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
      await expect(nav.getByRole('link', { name: 'Browse IRM modules' })).toHaveCount(0);
    } else await expect(nav.getByRole('link', { name: 'Browse IRM modules' })).toHaveAttribute('href', '/communities/irm/modules');
    if (persona === 'pending') {
      await expect(help).toContainText('awaiting manual review');
      await expect(help.getByRole('link', { name: 'Check application status' })).toHaveAttribute('href', '/account#community-membership');
    }
    if (persona === 'banned') {
      await expect(help).toContainText('contributing does not change that decision');
      await expect(help.locator('a[href="/account#community-membership"]')).toHaveCount(0);
    }
    // The build's real configuration governs browser output; no payment/contact override.
    const contacts = main.locator('a[href^="https://wa.me/"]');
    if (await contacts.count()) {
      await expect(contacts).toHaveCount(2);
      for (const link of await contacts.all()) {
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(new URL((await link.getAttribute('href'))!).hostname).toBe('wa.me');
      }
      const supportLink = main.getByRole('link', { name: 'Contact us about supporting EtudSup' });
      const contactUrl = new URL((await supportLink.getAttribute('href'))!);
      expect(contactUrl.searchParams.get('text')).toBe("Hi! I'd like to support EtudSup. How can I contribute?");
      await expect(main).toContainText('does not process a payment');
    } else {
      await expect(main).toContainText('Contribution details are not yet available.');
      await expect(help).toContainText('Online contact details are not yet available.');
    }
    await expect(page.locator('[data-site-footer]')).toHaveCount(1);
    const navNode = await nav.elementHandle();
    expect(await page.locator('[data-site-footer]').evaluate((footer, previous) => Boolean(previous && previous.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING), navNode)).toBe(true);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 1440]) {
    for (const persona of ['guest', 'member'] as const) {
      test(`${theme} ${persona} Support at ${width}px: focus, contrast, footer clearance and capture`, async ({ page }, testInfo) => {
        await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
        await page.setViewportSize({ width, height: 900 });
        await mockPage(page, persona);
        await page.goto('/support');
        const nav = page.getByRole('navigation', { name: 'Support page navigation' });
        await expect(nav.getByRole('link', { name: persona === 'guest' ? 'Sign in' : 'Browse IRM modules' })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        for (const link of await nav.getByRole('link').all()) {
          await expect(link).toHaveCSS('text-decoration-line', 'none');
          const box = (await link.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          await link.focus();
          await expect(link).toHaveCSS('outline-style', 'solid');
          await expectContrast(link);
        }
        await expectContrast(page.getByRole('heading', { level: 1 }));
        await expectContrast(page.locator('[data-site-footer] p'));
        await page.screenshot({ path: testInfo.outputPath(`support-${persona}-${theme}-${width}.png`), fullPage: true });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const footer = (await page.locator('[data-site-footer]').boundingBox())!;
        if (width < 1280 && persona === 'member') {
          const bottom = (await page.getByRole('navigation', { name: 'Mobile bottom navigation' }).boundingBox())!;
          expect(footer.y + footer.height).toBeLessThanOrEqual(bottom.y - 12);
        }
        await nav.getByRole('link', { name: 'Back to Home' }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator('[data-site-footer]')).toHaveCount(1);
      });
    }
  }
}

for (const persona of ['guest', 'member'] as const) {
  test(`${persona} footer ownership across landing, account and ordinary routes`, async ({ page }) => {
    await mockPage(page, persona);
    for (const path of ['/', '/login', '/register', '/support', '/communities/irm/modules']) {
      await page.goto(path);
      const footer = page.locator('[data-site-footer]');
      await expect(footer).toHaveCount(1);
      await expect(footer).toHaveText(`© ${new Date().getFullYear()} EtudSup · v0.1 · All rights reserved.`);
      await expect(page.locator('main')).toHaveCount(1);
      const mainNode = await page.locator('main').elementHandle();
      expect(await footer.evaluate((current, previous) => Boolean(previous && previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING), mainNode)).toBe(true);
    }
    for (const path of ['/communities/irm/discussion', '/communities/irm/modules/algo/documents/doc']) {
      await page.goto(path);
      await expect(page.locator('[data-site-footer]')).toHaveCount(0);
    }
  });
}
