import { test, expect, type Page } from '@playwright/test';

const longUsername = 'delegate_with_a_very_long_irm_username_1234567890';
const modules = ['Advanced C', 'Web Development', 'Object-Oriented Programming'].map((name, index) => ({
  id: `module-${index}`, community_id: 'irm', name, slug: `module-${index}`,
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
}));

async function mockPortal(page: Page) {
  const state = { guest: false, membershipFailure: false,
    membershipStatus: 'ACTIVE' as 'ACTIVE' | 'PENDING' | 'REJECTED' | null, delegate: true };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ status: state.guest ? 401 : 200, json: state.guest
        ? { detail: 'Not authenticated' }
        : { id: 'user-fixture', username: longUsername, email: 'fixture@example.com', first_name: 'Amina', family_name: 'Student' } });
    }
    if (path.endsWith('/membership/me')) {
      return route.fulfill({ status: state.membershipFailure ? 500 : 200, json: state.membershipFailure
        ? { detail: 'Membership lookup unavailable' }
        : { membership: state.membershipStatus ? { id: 'membership-fixture', status: state.membershipStatus,
          role: state.delegate ? 'DELEGATE' : 'MEMBER' } : null,
          capabilities: { create_announcements: state.delegate, manage_document_voting: state.delegate,
            upload_official_documents: state.delegate } } });
    }
    if (path.endsWith('/modules')) return route.fulfill({ json: modules });
    if (path.endsWith('/modules/module-0')) return route.fulfill({ json: modules[0] });
    if (path.endsWith('/document-voting/settings')) return route.fulfill({ json: { required_total_votes: 10 } });
    if (path.endsWith('/posts')) return route.fulfill({ json: { items: [], next_cursor: null } });
    if (/\/(announcements|documents|pending|active)$/.test(path)) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: 'No fixture for this request' } });
  });
  return state;
}

async function expectLayout(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

function contrast(first: string, second: string) {
  const luminance = (colour: string) => {
    const channels = colour.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test.describe('Shared visual foundation', () => {
  for (const width of [320, 390, 768, 1024, 1279, 1280, 1440]) {
    test(`Layouts, delegate navigation, and authentication presentation at ${width}px`, async ({ page }, testInfo) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      const state = await mockPortal(page);
      await page.goto('/communities/irm/modules');
      await expect(page.getByRole('heading', { name: 'IRM Modules' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open Module', exact: false })).toHaveCount(3);
      const header = page.locator('header');
      if (width < 1024) {
        const toggle = header.getByRole('button', { name: 'Open navigation menu' });
        await toggle.click();
        const nav = page.getByRole('navigation', { name: 'Mobile Navigation' });
        await expect(nav.getByRole('link', { name: 'Review Applications' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Manage Staff' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Voting Settings' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Modules', exact: true })).toHaveCSS('font-size', '16px');
        await expect(nav.getByText(longUsername)).toBeVisible();
        await expectLayout(page);
        await page.screenshot({ path: testInfo.outputPath(`navigation-${width}.png`), fullPage: true });
        await page.keyboard.press('Escape');
        await expect(toggle).toBeFocused();
        await expect(nav).toHaveCount(0);
      } else {
        const nav = page.getByRole('navigation', { name: 'Main Navigation' });
        for (const label of ['Home', 'Modules', 'Announcements', 'Posts', 'Discussion', 'Pending Docs', 'Membership', 'Support']) {
          const link = nav.getByRole('link', { name: label, exact: true });
          await expect(link).toBeVisible();
          await expect(link).toHaveCSS('font-size', '14px');
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        const brand = await header.getByRole('link', { name: 'IRM Hub', exact: true }).boundingBox();
        const navBox = await nav.boundingBox();
        if (width < 1280) expect(navBox!.y).toBeGreaterThanOrEqual(brand!.y + brand!.height);
        else expect(navBox!.y).toBeLessThan(brand!.y + brand!.height);
        await expect(header.getByText(longUsername)).toHaveAttribute('title', longUsername);
        const manage = header.getByRole('button', { name: 'Manage', exact: true });
        await manage.click();
        for (const label of ['Review Applications', 'Manage Staff', 'Voting Settings']) {
          await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
        }
        await expectLayout(page);
        await page.keyboard.press('Escape');
        await expect(manage).toBeFocused();
      }
      await expectLayout(page);
      await page.screenshot({ path: testInfo.outputPath(`modules-${width}.png`), fullPage: true });

      // Exercise existing pages affected by the shared container, without mutations.
      // Home's adversarial long-username case has a separate regression check below.
      for (const path of ['/support', '/communities/irm/modules/module-0',
        '/communities/irm/modules/module-0/upload', '/communities/irm/documents/pending',
        '/communities/irm/announcements', '/communities/irm/posts', '/communities/irm/posts/new',
        '/account#community-membership', '/communities/irm/membership/review',
        '/communities/irm/membership/staff', '/communities/irm/document-voting/settings']) {
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        await expectLayout(page);
      }
      state.guest = true;
      for (const path of ['/login', '/register']) {
        await page.goto(path);
        await expect(page.locator('#email')).toBeVisible();
        await expectLayout(page);
        const main = await page.locator('main').boundingBox();
        expect(main!.width).toBeLessThanOrEqual(480);
        await expect(page.locator('#email')).toHaveCSS('font-size', '16px');
        await expect(page.locator('#email')).toHaveCSS('line-height', '24px');
        await expect(page.locator('#email')).toHaveCSS('border-radius', '8px');
        expect((await page.locator('#email').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: testInfo.outputPath(`${path.slice(1)}-${width}.png`), fullPage: true });
      }
    });
  }

  test('Computed colours, contrast, keyboard focus, and reduced motion use the shared styles', async ({ page }) => {
    const state = await mockPortal(page);
    state.guest = true;
    await page.goto('/login');
    const colours = await page.evaluate(() => {
      const styles = (selector: string) => getComputedStyle(document.querySelector(selector)!);
      return { page: styles('body').backgroundColor, surface: styles('.ui-surface').backgroundColor,
        muted: styles('.ui-helper').color, main: styles('body').color,
        primary: styles('button[type="submit"]').backgroundColor, onPrimary: styles('button[type="submit"]').color,
        fieldBorder: styles('#email').borderTopColor, font: styles('body').fontFamily };
    });
    expect(colours.page).toBe('rgb(247, 246, 242)');
    expect(colours.surface).toBe('rgb(255, 255, 255)');
    expect(colours.primary).toBe('rgb(29, 78, 216)');
    expect(colours.font).toContain('ui-sans-serif');
    expect(contrast(colours.muted, colours.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.muted, colours.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.main, colours.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.onPrimary, colours.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.fieldBorder, colours.surface)).toBeGreaterThanOrEqual(3);
    await page.locator('#email').focus();
    await expect(page.locator('#email')).toHaveCSS('outline-color', 'rgb(37, 99, 235)');
    await expect(page.locator('#email')).toHaveCSS('outline-width', '2px');
    await page.locator('#password').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('button[type="submit"]')).toBeFocused();
    await expect(page.locator('button[type="submit"]')).toHaveCSS('outline-style', 'solid');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('button[type="submit"]')).toHaveCSS('transition-duration', '0s');
  });

  test('Existing Home signed-in text must fit with a long username on small screens', async ({ page }) => {
    await mockPortal(page);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page.locator('main').getByText(/Signed in as/)).toBeVisible();
      await expect(page.locator('main')).toHaveCount(1);
      expect.soft(await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      })), `Home overflow at ${width}px`).toEqual({ viewport: width, content: width });
    }
  });

  for (const form of ['login', 'register']) {
    test(`${form}: field errors are associated, drafts survive, and general errors do not mark fields invalid`, async ({ page }, testInfo) => {
      const state = await mockPortal(page);
      state.guest = true;
      const fields = form === 'login' ? ['email', 'password'] : ['username', 'email', 'first_name', 'family_name', 'password'];
      let attempts = 0;
      await page.route(`**/api/v1/auth/${form}`, async (route) => {
        attempts++;
        return route.fulfill({ status: attempts === 1 ? 422 : 500, json: attempts === 1
          ? { detail: fields.map((field) => ({ loc: ['body', field], msg: 'Invalid value', type: 'value_error' })) }
          : { detail: 'Temporary server error' } });
      });
      await page.goto(`/${form}`);
      for (const field of fields) await page.locator(`#${field}`).fill(field === 'email' ? 'student@example.com' : 'student-fixture');
      await page.locator('button[type="submit"]').click();
      for (const field of fields) {
        await expect(page.locator(`#${field}`)).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator(`#${field}`)).toHaveAttribute('aria-describedby', `${form}-${field}-error`);
        await expect(page.locator(`#${form}-${field}-error`)).toHaveAttribute('role', 'alert');
        await expect(page.locator(`#${field}`)).toHaveCSS('border-top-color', 'rgb(185, 28, 28)');
        await expect(page.locator(`#${field}`)).toHaveValue(field === 'email' ? 'student@example.com' : 'student-fixture');
      }
      await page.screenshot({ path: testInfo.outputPath(`${form}-field-errors.png`), fullPage: true });
      await page.locator('button[type="submit"]').click();
      const feedback = page.locator('main').getByRole('alert');
      await expect(feedback).toContainText('Temporary server error');
      const errorColours = await feedback.evaluate((element) => {
        const style = getComputedStyle(element);
        return { text: style.color, background: style.backgroundColor };
      });
      expect(contrast(errorColours.text, errorColours.background)).toBeGreaterThanOrEqual(4.5);
      for (const field of fields) await expect(page.locator(`#${field}`)).toHaveAttribute('aria-invalid', 'false');
    });
  }

  test('Login pending and successful submission preserve payload, disabled state, and existing redirect', async ({ page }) => {
    const state = await mockPortal(page);
    state.guest = true;
    let release!: () => void;
    let payload: unknown;
    await page.route('**/api/v1/auth/login', async (route) => {
      payload = route.request().postDataJSON();
      await new Promise<void>((resolve) => { release = resolve; });
      state.guest = false;
      await route.fulfill({ json: { id: 'user-fixture', username: longUsername, email: 'student@example.com' } });
    });
    await page.goto('/login');
    await page.locator('#email').fill('student@example.com');
    await page.locator('#password').fill('student-fixture');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole('button', { name: 'Logging in...' })).toBeDisabled();
    await expect(page.locator('#email')).toBeDisabled();
    await expect(page.locator('#password')).toBeDisabled();
    expect(payload).toEqual({ email: 'student@example.com', password: 'student-fixture' });
    release();
    await expect(page).toHaveURL(/\/communities\/irm\/membership$/);
    await expect(page.locator('header').getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
  });

  test('Register pending and confirmed success preserve native disabled state and account flow', async ({ page }, testInfo) => {
    const state = await mockPortal(page);
    state.guest = true;
    let release!: () => void;
    await page.route('**/api/v1/auth/register', async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json: { id: 'fixture-created', username: 'student-fixture', email: 'student@example.com', first_name: 'Amina', family_name: 'Student' } });
    });
    await page.goto('/register');
    for (const field of ['username', 'email', 'first_name', 'family_name', 'password']) {
      await page.locator(`#${field}`).fill(field === 'email' ? 'student@example.com' : 'student-fixture');
    }
    await page.locator('button[type="submit"]').click();
    const pending = page.getByRole('button', { name: 'Creating account...' });
    await expect(pending).toBeDisabled();
    await expect(pending).toHaveCSS('background-color', 'rgb(232, 236, 241)');
    await expect(pending).toHaveCSS('color', 'rgb(82, 97, 118)');
    await expect(page.locator('#email')).toBeDisabled();
    release();
    await expect(page.getByRole('heading', { name: 'Your account was created successfully!' })).toBeVisible();
    const successColours = await page.locator('.bg-success-surface').evaluate((element) => {
      const style = getComputedStyle(element);
      return { text: style.color, background: style.backgroundColor };
    });
    expect(contrast(successColours.text, successColours.background)).toBeGreaterThanOrEqual(4.5);
    await expect(page.getByRole('link', { name: /Continue to Log In/ })).toHaveAttribute('href', '/login');
    await page.screenshot({ path: testInfo.outputPath('register-success.png'), fullPage: true });
  });

  test('Actual background membership revalidation retains enabled Logout without a pending logout label', async ({ page }) => {
    const state = await mockPortal(page);
    state.membershipFailure = true;
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Retry Verification' })).toBeVisible();
    let release!: () => void;
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json: { membership: { id: 'membership-fixture', status: 'ACTIVE', role: 'MEMBER' }, capabilities: {} } });
    });
    await page.getByRole('button', { name: 'Retry Verification' }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await expect(page.locator('header').getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
    release();
    await expect(page.locator('header').getByText('ACTIVE MEMBER')).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
  });

  test('Guidance preserves access distinctions, readable state colours, and touch-friendly actions', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 480 });
    const state = await mockPortal(page);
    state.guest = true;
    await page.goto('/communities/irm/posts/new');
    await expect(page.getByRole('heading', { name: 'Authentication Needed' })).toBeVisible();
    state.guest = false;
    for (const [status, heading] of [
      ['PENDING', 'Membership Under Review'], ['REJECTED', 'Membership Request Not Approved'],
      [null, 'Join the IRM Community'],
    ] as const) {
      state.membershipStatus = status;
      await page.goto('/communities/irm/posts/new');
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expectLayout(page);
      const guidance = page.locator('main .ui-surface');
      const badge = guidance.locator('.rounded-tag');
      const colours = await badge.evaluate((element) => {
        const style = getComputedStyle(element);
        return { text: style.color, background: style.backgroundColor };
      });
      expect(contrast(colours.text, colours.background)).toBeGreaterThanOrEqual(4.5);
      for (const action of await guidance.getByRole('link').all()) {
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    state.membershipFailure = true;
    await page.goto('/communities/irm/posts/new');
    await expect(page.locator('main').getByRole('alert')).toContainText('Membership could not be verified');
    await expect(page.getByRole('heading', { name: 'Join the IRM Community' })).toHaveCount(0);
    const retry = page.getByRole('button', { name: 'Retry Verification' });
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await retry.focus();
    await expect(retry).toHaveCSS('outline-width', '2px');
    await page.screenshot({ path: testInfo.outputPath('membership-unknown-320.png'), fullPage: true });

    state.membershipFailure = false;
    state.membershipStatus = 'ACTIVE';
    state.delegate = false;
    await page.goto('/communities/irm/membership/review');
    await expect(page.getByRole('heading', { name: 'Staff Authorization Required' })).toBeVisible();
    await expectLayout(page);
  });

  test('Short-height viewport and 200% text enlargement preserve reachable controls', async ({ page }, testInfo) => {
    const state = await mockPortal(page);
    state.guest = true;
    await page.setViewportSize({ width: 320, height: 480 });
    await page.goto('/register');
    await expectLayout(page);
    await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
    await expect(page.locator('button[type="submit"]')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('register-320-short.png'), fullPage: true });

    // Text-only enlargement, not DPR emulation or a claim of native browser zoom.
    await page.evaluate(() => {
      const elements = [...document.querySelectorAll<HTMLElement>('header, header *, main, main *')];
      const measurements = elements.map((element) => {
        const style = getComputedStyle(element);
        return { element, size: parseFloat(style.fontSize), height: parseFloat(style.lineHeight) };
      });
      for (const { element, size, height } of measurements) {
        element.style.fontSize = `${size * 2}px`;
        if (Number.isFinite(height)) element.style.lineHeight = `${height * 2}px`;
      }
    });
    await expectLayout(page);
    await expect(page.locator('#email')).toHaveCSS('font-size', '32px');
    await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
    await expect(page.locator('button[type="submit"]')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('register-200-percent-text.png'), fullPage: true });
  });
});
