import { test, expect, type Page } from '@playwright/test';

type State = 'guest' | 'nonmember' | 'pending' | 'rejected' | 'active' | 'failure';
const states: State[] = ['guest', 'nonmember', 'pending', 'rejected', 'active', 'failure'];
const items = ['Exam schedule announced for S3', 'Workshop: modern cloud architectures', 'Library extended hours for midterms'].map((title, index) => ({
  id: `a0000000-0000-0000-0000-00000000000${index + 1}`, title,
  content: 'Community notice for IRM students. Please review the details and contact the community Delegate if you have questions.',
  created_at: `2026-10-0${5 - index}T12:00:00Z`,
}));
const user = { id: 'home-fixture', username: 'amina_irm_mohammedia_2026_student', email: 'fixture@example.com', first_name: 'Amina', family_name: 'Student' };
const membership = (state: State) => ({
  membership: state === 'nonmember' ? null : { id: 'member-fixture', status: state === 'pending' ? 'PENDING' : state === 'rejected' ? 'REJECTED' : 'ACTIVE', role: 'MEMBER' },
  capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
});

async function mockHome(page: Page, state: State, count = 3, username = user.username) {
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/v1/')) requests.push(request.url()); });
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().method() !== 'GET') return route.abort();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ status: state === 'guest' ? 401 : 200,
      json: state === 'guest' ? { detail: 'Not authenticated' } : { ...user, username } });
    if (path.endsWith('/membership/me')) return route.fulfill({ status: state === 'failure' ? 500 : 200,
      json: state === 'failure' ? { detail: 'Membership lookup unavailable' } : membership(state) });
    if (path.endsWith('/announcements')) return route.fulfill({ json: items.slice(0, count) });
    if (path.endsWith('/replies')) return route.fulfill({ json: { items: [], next_cursor: null } });
    if (path.includes('/announcements/')) return route.fulfill({ json: { ...items[0], author_username: 'delegate_fixture' } });
    return route.fulfill({ status: 404, json: { detail: 'No mocked Home fixture' } });
  });
  return requests;
}

const feedRequests = (requests: string[]) => requests.filter((url) => new URL(url).pathname.endsWith('/announcements'));

async function layout(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth));
  await expect(page.locator('main').getByRole('link', { name: 'Browse Modules', exact: true })).toHaveCount(1);
  await expect(page.locator('main').getByText(user.email, { exact: true })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('&rarr;');
}

test.describe('Home composition — mocked API only', () => {
  for (const state of states) {
    test(`${state}: honest guidance, unique actions and protected-content boundaries`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const requests = await mockHome(page, state);
      await page.goto('/');
      const main = page.locator('main');
      await expect(main.getByRole('heading', { name: 'Welcome to IRM Hub' })).toHaveCSS('font-size', '28px');
      await expect(main.getByRole('link', { name: 'Browse Modules', exact: true })).toHaveAttribute('href', '/communities/irm/modules');
      const action = { nonmember: 'Request IRM Membership', pending: 'Check Application Status', rejected: 'Reapply for Membership', active: 'Membership status' };
      if (state === 'guest') {
        await expect(main.getByText('Announcements, Posts, and Discussion require active IRM membership.')).toBeVisible();
        await expect(main.getByRole('link', { name: 'Log In', exact: true })).toHaveAttribute('href', '/login');
        await expect(main.getByRole('link', { name: 'Create an Account', exact: true })).toHaveAttribute('href', '/register');
        await expect(main.getByText('Sign in to browse module resources and read approved documents.')).toBeVisible();
      } else if (state === 'failure') {
        await expect(main.getByRole('alert')).toContainText('could not be verified');
        await expect(main.getByRole('button', { name: 'Retry Verification' })).toBeEnabled();
        await expect(main).not.toContainText('NOT APPLIED');
        await expect(main).not.toContainText('You have not yet requested');
        await page.getByRole('button', { name: 'Open navigation menu' }).click();
        const nav = page.getByRole('navigation', { name: 'Mobile Navigation' });
        await expect(nav.getByText('Membership unavailable', { exact: true })).toBeVisible();
        await expect(nav.getByText('No membership', { exact: true })).toHaveCount(0);
        await expect(nav.getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
        await page.keyboard.press('Escape');
      } else {
        await expect(main.getByRole('link', { name: action[state], exact: true })).toHaveAttribute('href', '/account#community-membership');
        await expect(main.locator('a[href="/account#community-membership"]')).toHaveCount(1);
        if (state === 'pending') {
          await expect(main).toContainText('under review by the community Delegate');
          await expect(main.getByRole('link', { name: /Reapply|Request IRM Membership/ })).toHaveCount(0);
        } else if (state === 'rejected') {
          await expect(main).toContainText('You may submit a new application with your student CNE.');
        } else if (state === 'nonmember') {
          await expect(main).toContainText('You have not yet requested IRM community membership.');
        }
      }
      if (state === 'active') {
        await expect(main.locator('article')).toHaveCount(3);
        await expect(main.getByRole('link', { name: 'Posts', exact: true })).toHaveAttribute('href', '/communities/irm/posts');
        await expect(main.getByRole('link', { name: 'Discussion', exact: true })).toHaveAttribute('href', '/communities/irm/discussion');
        await expect(main.getByRole('link', { name: 'Review pending documents' })).toHaveAttribute('href', '/communities/irm/documents/pending');
        expect(feedRequests(requests).length).toBeGreaterThan(0);
        for (const url of feedRequests(requests)) expect(new URL(url).search).toBe('?limit=3');
        expect(requests.every((url) => /\/(auth\/me|membership\/me|announcements)$/.test(new URL(url).pathname))).toBe(true);
      } else {
        await expect(main.getByRole('heading', { name: 'Latest announcements', exact: true })).toHaveCount(0);
        await expect(main.locator('article')).toHaveCount(0);
        await expect(main.getByRole('link', { name: /^(Posts|Discussion|All announcements|Review pending documents)$/ })).toHaveCount(0);
        expect(feedRequests(requests)).toHaveLength(0);
      }
      await expect(main).toContainText('Pre-alpha');
      await expect(main).toContainText('Independent student initiative. Not officially affiliated with or endorsed by FST Mohammedia administration.');
      await expect(main).toContainText('verifies membership manually using your student CNE');
      await layout(page);
      await page.screenshot({ path: info.outputPath(`state-${state}-390.png`), fullPage: true });
    });
  }

  for (const state of ['failure', 'nonmember'] as const) {
    test(`Desktop Header distinguishes ${state} from membership absence`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await mockHome(page, state);
      await page.goto('/');
      const header = page.locator('header');
      await expect(header.getByText(state === 'failure' ? 'Membership unavailable' : 'No membership', { exact: true })).toBeVisible();
      await expect(header.getByText(state === 'failure' ? 'No membership' : 'Membership unavailable', { exact: true })).toHaveCount(0);
      await expect(header.getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
    });
  }

  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`Active composition at ${width}px: columns, tokens, focus and no overflow`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 320 ? 480 : 900 });
      await mockHome(page, 'active');
      await page.goto('/');
      const main = page.locator('main');
      await expect(main.locator('article')).toHaveCount(3);
      await layout(page);
      const study = main.getByRole('region', { name: 'Study resources', exact: true });
      const community = main.getByRole('region', { name: 'Community', exact: true });
      const a = (await study.boundingBox())!, b = (await community.boundingBox())!;
      if (width < 768) expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
      else {
        expect(a.y).toBeCloseTo(b.y, 0);
        expect(a.width / b.width).toBeCloseTo(width < 1024 ? 1 : 2, 1);
      }
      await expect(study).toHaveCSS('padding-left', width < 768 ? '16px' : '24px');
      await expect(main.getByRole('heading', { level: 1 })).toHaveCSS('font-size', width < 768 ? '28px' : '32px');
      const card = main.locator('a:has(article)').first();
      await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(card).toHaveCSS('border-radius', '12px');
      await expect(card).toHaveCSS('border-top-color', 'rgb(216, 222, 230)');
      await expect(card).toHaveCSS('box-shadow', 'none');
      await expect(card.locator('h3')).toHaveCSS('font-size', '18px');
      await expect(card.locator('h3')).toHaveCSS('font-weight', '600');
      await expect(card.locator('time')).toHaveCSS('font-size', '14px');
      await expect(card.locator('p')).toHaveCSS('font-size', '16px');
      await expect(card.locator('a, button, input')).toHaveCount(0);
      const primary = main.getByRole('link', { name: 'Browse Modules', exact: true });
      await primary.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      await expect(primary).toBeFocused();
      await expect(primary).toHaveCSS('outline-width', '2px');
      await card.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      await expect(card).toBeFocused();
      await expect(card).toHaveCSS('outline-width', '2px');
      // The foundation's white focus halo uses box-shadow; it is not a card shadow.
      await expect(card).toHaveCSS('box-shadow', 'rgb(255, 255, 255) 0px 0px 0px 2px');
      await page.keyboard.press('Tab');
      await expect(card).not.toBeFocused();
      await card.hover();
      await expect(card).toHaveCSS('box-shadow', 'none');
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({ path: info.outputPath(`active-${width}.png`), fullPage: true });
      const box = (await primary.boundingBox())!;
      info.annotations.push({ type: 'Modules action position', description: `At ${width}px width: top=${Math.round(box.y)}, bottom=${Math.round(box.y + box.height)} document pixels; not a universal fold guarantee.` });
    });
  }

  for (const count of [0, 1, 2, 3]) {
    for (const width of [390, 768, 1024]) {
      test(`${count} announcement items at ${width}px retain order and responsive allocation`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await mockHome(page, 'active', count);
        await page.goto('/');
        const main = page.locator('main');
        await expect(main.getByRole('link', { name: 'All announcements', exact: true })).toHaveAttribute('href', '/communities/irm/announcements');
        if (!count) await expect(main.getByText('No announcements published yet.')).toBeVisible();
        await expect(main.locator('article')).toHaveCount(count);
        const cards = await main.locator('a:has(article)').all();
        for (let i = 0; i < count; i++) await expect(cards[i].locator('h3')).toHaveText(items[i].title);
        if (count === 1) expect((await cards[0].boundingBox())!.width).toBeLessThanOrEqual(768);
        if (count > 1) {
          const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
          const columns = new Set(boxes.map((box) => Math.round(box!.x))).size;
          expect(columns).toBe(width < 768 ? 1 : count === 3 && width >= 1024 ? 3 : 2);
          if (count === 3 && width === 768) expect(boxes[2]!.x).toBeCloseTo(boxes[0]!.x, 0);
        }
        await layout(page);
        if (count === 0 || width === 768) await page.screenshot({ path: info.outputPath(`announcements-${count}-${width}.png`), fullPage: true });
      });
    }
  }

  test('Initial account lookup is neutral and keeps resources reachable without protected requests', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 480 });
    const requests = await mockHome(page, 'guest');
    let release!: () => void;
    await page.route('**/api/v1/auth/me', async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });
    await page.goto('/');
    await expect(page.locator('main').getByRole('status')).toHaveText('Checking account…');
    await expect(page.locator('main').getByRole('link', { name: /^(Log In|Create an Account|Request IRM Membership)$/ })).toHaveCount(0);
    expect(feedRequests(requests)).toHaveLength(0);
    await layout(page);
    await page.screenshot({ path: info.outputPath('initial-account-320-short.png'), fullPage: true });
    release();
    await expect(page.locator('main').getByRole('link', { name: 'Log In', exact: true })).toBeVisible();
    expect(feedRequests(requests)).toHaveLength(0);
  });

  test('Membership retry is honest while in flight and restores active spaces without false logout loading', async ({ page }, info) => {
    const requests = await mockHome(page, 'failure');
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Retry Verification' })).toBeVisible();
    let release!: () => void;
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json: membership('active') });
    });
    await page.getByRole('button', { name: 'Retry Verification' }).click();
    await expect(page.locator('main').getByRole('status')).toHaveText('Checking membership…');
    await expect(page.locator('header').getByText('Checking membership…', { exact: true })).toBeVisible();
    await expect(page.locator('header').getByText('No membership', { exact: true })).toHaveCount(0);
    await expect(page.locator('main').getByRole('link', { name: 'Request IRM Membership' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('NOT APPLIED');
    expect(feedRequests(requests)).toHaveLength(0);
    await expect(page.locator('header').getByRole('button', { name: 'Logout', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('checking-membership.png'), fullPage: true });
    release();
    await expect(page.locator('main article')).toHaveCount(3);
    for (const url of feedRequests(requests)) expect(new URL(url).searchParams.get('limit')).toBe('3');
  });

  test('Feed loading, error and retry stay isolated from usable resource and community links', async ({ page }, info) => {
    await mockHome(page, 'active');
    let release!: () => void;
    let fail = true;
    await page.route('**/api/v1/communities/irm/announcements?*', async (route) => {
      if (fail) {
        await new Promise<void>((resolve) => { release = resolve; });
        await route.fulfill({ status: 500, json: { detail: 'Announcements temporarily unavailable' } });
      } else await route.fulfill({ json: items });
    });
    await page.goto('/');
    await expect(page.locator('main').getByRole('status')).toHaveText('Loading latest announcements...');
    await page.screenshot({ path: info.outputPath('feed-loading.png'), fullPage: true });
    release();
    await expect(page.getByRole('button', { name: 'Retry Loading' })).toBeVisible();
    const main = page.locator('main');
    for (const name of ['Browse Modules', 'Posts', 'Discussion', 'All announcements']) {
      await expect(main.getByRole('link', { name, exact: true })).toBeVisible();
      await expect(main.getByRole('link', { name, exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    }
    await page.screenshot({ path: info.outputPath('feed-error.png'), fullPage: true });
    fail = false;
    await page.getByRole('button', { name: 'Retry Loading' }).click();
    await expect(main.locator('article')).toHaveCount(3);
    await expect(main.getByRole('alert')).toHaveCount(0);
  });

  for (const width of [320, 390]) {
    test(`Long complete identity and unbroken titles at ${width}px do not overflow or clamp`, async ({ page }, info) => {
      const username = 'a'.repeat(50), title = 'T'.repeat(255), content = 'C'.repeat(300);
      await page.setViewportSize({ width, height: 480 });
      await mockHome(page, 'active', 1, username);
      await page.route('**/api/v1/communities/irm/announcements?*', (route) => route.fulfill({ json: [{ ...items[0], title, content }] }));
      await page.goto('/');
      const main = page.locator('main');
      await expect(main.getByText(/Signed in as/)).toContainText(`Amina Student (@${username})`);
      await expect(main.locator('article h3')).toHaveText(title);
      await expect(main.locator('article p')).toHaveText('C'.repeat(160) + '…');
      await expect(main.locator('article h3')).toHaveCSS('-webkit-line-clamp', 'none');
      await layout(page);
      for (const name of ['Browse Modules', 'Membership status', 'Posts', 'Discussion']) {
        const link = main.getByRole('link', { name, exact: true });
        await link.scrollIntoViewIfNeeded(); await expect(link).toBeInViewport();
      }
      await page.screenshot({ path: info.outputPath(`long-identity-title-${width}.png`), fullPage: true });
    });
  }

  test('Plain text is escaped and absent author identity is not fabricated', async ({ page }) => {
    await mockHome(page, 'active', 1);
    const title = '<script>window.home_xss=1</script>', content = '<img src=x onerror="window.home_xss=1"> Plain text';
    await page.route('**/api/v1/communities/irm/announcements?*', (route) => route.fulfill({ json: [{ ...items[0], title, content, author_id: 'private-author-id' }] }));
    await page.goto('/');
    const card = page.locator('main article');
    await expect(card.locator('h3')).toHaveText(title);
    await expect(card.locator('p')).toHaveText(content);
    await expect(card.locator('img, script')).toHaveCount(0);
    await expect(card).not.toContainText('private-author-id');
    await expect(card).not.toContainText('By @');
    expect(await page.evaluate(() => 'home_xss' in window)).toBe(false);
  });

  test('Home preview navigates to the existing announcement detail route', async ({ page }) => {
    await mockHome(page, 'active', 1);
    await page.goto('/');
    const card = page.locator('main').getByRole('link', { name: `Announcement: ${items[0].title}`, exact: true });
    await expect(card).toHaveAttribute('href', `/communities/irm/announcements/${items[0].id}`);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/announcements/${items[0].id}$`));
    await expect(page.getByRole('heading', { level: 1, name: items[0].title })).toBeVisible();
  });

  test('Default list card keeps its original classes, typography, shadow and navigation', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHome(page, 'active', 1);
    await page.goto('/communities/irm/announcements');
    const card = page.locator('main a:has(article)').first();
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.className.trim())).toBe('group block p-5 sm:p-6 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500');
    await expect(card.locator('h2')).toHaveCSS('font-size', '20px');
    await expect(card.locator('h2')).toHaveCSS('font-weight', '700');
    await expect(card.locator('time')).toHaveCSS('font-size', '12px');
    await expect(card.locator('p')).toHaveCSS('font-size', '14px');
    await expect(card).not.toHaveCSS('box-shadow', 'none');
    await expect(card).toHaveAttribute('aria-label', `Announcement: ${items[0].title}`);
    await expect(card).toHaveAttribute('href', `/communities/irm/announcements/${items[0].id}`);
    await page.screenshot({ path: info.outputPath('unchanged-default-list-card.png'), fullPage: true });
  });

  test('320×480 short viewport with 200% text simulation keeps Home actions reachable', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await mockHome(page, 'active', 1);
    await page.goto('/');
    await expect(page.locator('main article')).toHaveCount(1);
    await page.evaluate(() => {
      const measurements = [...document.querySelectorAll<HTMLElement>('header, header *, main, main *')].map((el) => ({
        el, size: parseFloat(getComputedStyle(el).fontSize), height: parseFloat(getComputedStyle(el).lineHeight),
      }));
      for (const { el, size, height } of measurements) {
        el.style.fontSize = `${size * 2}px`;
        if (Number.isFinite(height)) el.style.lineHeight = `${height * 2}px`;
      }
    });
    await layout(page);
    await expect(page.locator('main h1')).toHaveCSS('font-size', '56px');
    for (const name of ['Browse Modules', 'Posts', 'Discussion', 'All announcements']) {
      const link = page.locator('main').getByRole('link', { name, exact: true });
      await link.scrollIntoViewIfNeeded(); await expect(link).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath('active-200-percent-text-320-short.png'), fullPage: true });
  });

  for (const status of [401, 403]) {
    test(`Feed ${status} stays an access error rather than an empty or public feed`, async ({ page }) => {
      await mockHome(page, 'active');
      await page.route('**/api/v1/communities/irm/announcements?*', (route) => route.fulfill({ status, json: { detail: 'Access denied' } }));
      await page.goto('/');
      await expect(page.locator('main').getByRole('alert')).toContainText('You do not have access to view community announcements.');
      await expect(page.locator('main article')).toHaveCount(0);
      await expect(page.getByText('No announcements published yet.')).toHaveCount(0);
    });
  }
});
