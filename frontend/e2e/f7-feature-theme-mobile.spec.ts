import { test, expect, type Page } from './moderation-fixtures';

const root = '/communities/irm';
const noticeId = 'a0000000-0000-0000-0000-000000000001';
const notices = [
  { id: noticeId, title: 'An announcement with a long title that wraps comfortably across the featured panel', content: 'A complete community notice. '.repeat(24), created_at: '2026-10-11T12:00:00Z', updated_at: '2026-10-11T12:00:00Z' },
  { id: 'a0000000-0000-0000-0000-000000000002', title: 'An earlier announcement', content: 'Earlier published information.', author_username: 'actual_fixture_author', created_at: '2026-10-10T12:00:00Z' },
];
const modules = [
  { id: 'mod-1', community_id: 'irm', name: 'Algebra I', slug: 'algebra', created_at: '2026-01-01', updated_at: '2026-01-01' },
  { id: 'mod-2', community_id: 'irm', name: 'Computer networks', slug: 'networks', created_at: '2026-01-01', updated_at: '2026-01-01' },
];
const documentFixture = { id: 'doc-1', module_id: 'mod-1', uploader_id: 'fixture', title: 'A document title that needs room to wrap on a narrow screen without clipping its actions', type: 'TD', source: 'STUDENT', status: 'APPROVED', created_at: '2026-10-10', updated_at: '2026-10-10' };

async function mock(page: Page, status: string | null = 'ACTIVE', delegate = false) {
  const requests: string[] = [];
  const errors: string[] = [];
  const state = { status, noticeMode: 'normal', documentMode: 'normal', delegate, guest: false };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ status: state.guest ? 401 : 200, json: state.guest ? { detail: 'Not authenticated' } : { id: 'fixture', username: 'a_very_long_real_username_for_the_current_account', email: 'private@example.test', first_name: 'Test', family_name: 'User' } });
    if (url.pathname.endsWith('/membership/me')) return route.fulfill({ json: { membership: state.status ? { id: 'membership', status: state.status, role: state.delegate ? 'DELEGATE' : 'MEMBER' } : null, capabilities: { create_announcements: state.delegate, upload_official_documents: state.delegate, manage_document_voting: false } } });
    if (url.pathname.endsWith('/modules')) return route.fulfill({ json: modules });
    if (url.pathname === `${root.replace('/communities', '/api/v1/communities')}/announcements`) return state.noticeMode === 'error'
      ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } }) : route.fulfill({ json: state.noticeMode === 'empty' ? [] : notices });
    if (url.pathname.endsWith(`/announcements/${noticeId}`)) return route.fulfill({ json: notices[0] });
    if (url.pathname.endsWith('/replies')) return route.fulfill({ json: { items: [], next_cursor: null } });
    if (url.pathname.endsWith('/saved')) return route.fulfill({ json: { saved: false } });
    const mod = modules.find(item => url.pathname.endsWith(`/modules/${item.slug}`));
    if (mod) return route.fulfill({ json: mod });
    if (url.pathname.endsWith('/modules/algebra/documents')) return state.documentMode === 'error'
      ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } }) : route.fulfill({ json: state.documentMode === 'empty' ? [] : [documentFixture] });
    if (url.pathname.endsWith('/modules/networks/documents')) return route.fulfill({ json: [] });
    if (url.pathname.endsWith('/documents/doc-1')) return route.fulfill({ json: documentFixture });
    return route.fulfill({ status: 404, json: { detail: 'No fixture' } });
  });
  return { state, requests, errors };
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`F7 captures and layout: ${theme}, ${width}px`, async ({ page }, info) => {
      const { errors } = await mock(page);
      await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
      await page.setViewportSize({ width, height: 900 });
      for (const [name, route] of [['announcements', `${root}/announcements`], ['modules', `${root}/modules/algebra`], ['home', '/']]) {
        await page.goto(route);
        const main = page.locator('main');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        if (name === 'announcements') {
          await expect(main.getByRole('heading', { name: notices[0].title })).toBeVisible();
          await expect(main.getByRole('heading', { name: notices[0].title })).toHaveCount(1);
          await expect(main.getByText('Latest', { exact: true })).toBeVisible();
          await expect(main).not.toContainText('IRM admins');
          await expect(main).not.toContainText('caught up');
        } else if (name === 'modules') {
          await expect(main.getByRole('heading', { name: 'Algebra I', exact: true })).toBeVisible();
          await expect(main.getByRole('heading', { name: documentFixture.title })).toBeVisible();
          await expect(main.getByLabel('Search documents')).toBeVisible();
          await expect(main.getByLabel('Type', { exact: true })).toBeVisible();
          await expect(main.getByLabel('Source', { exact: true })).toBeVisible();
        } else {
          await expect(main.getByRole('heading', { name: /Your resources/ })).toBeVisible();
          const shortcuts = main.getByRole('navigation', { name: 'Home shortcuts' });
          const features = main.getByRole('region', { name: 'Useful next steps' });
          if (width < 1024) {
            await expect(shortcuts.getByRole('link')).toHaveCount(4);
            await expect(features).toBeHidden();
            const boxes = await Promise.all((await shortcuts.getByRole('link').all()).map(link => link.boundingBox()));
            expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
            expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
            await expect(main.getByRole('region', { name: 'Quick access' })).toBeVisible();
          } else { await expect(shortcuts).toBeHidden(); await expect(features).toBeVisible(); }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const bar = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
        if (width < 1280) {
          await expect(bar.getByRole('link')).toHaveCount(5);
          await main.locator('a').first().focus();
          await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const box = await main.boundingBox(); const barBox = await bar.boundingBox();
          expect(box!.y + box!.height).toBeLessThanOrEqual(barBox!.y);
        }
        await page.screenshot({ path: info.outputPath(`${name}-${theme}-${width}.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('F7 theme persistence, System recovery and drawer keyboard dismissal', async ({ page }) => {
  const { requests } = await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const drawer = page.locator('#mobile-navigation');
  await expect(drawer.getByRole('link', { name: 'Home', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close navigation menu' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: 'Logout' })).toBeFocused();
  const before = requests.length;
  await drawer.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('irm-theme'))).toBe('dark');
  expect(requests.length).toBe(before);
  await drawer.locator('[data-theme-control] summary').click();
  await drawer.getByRole('button', { name: 'Use system appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open navigation menu' })).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
});

for (const status of [null, 'PENDING', 'REJECTED', 'REMOVED', 'BANNED']) {
  test(`F7 four tiles and five guidance destinations for ${status ?? 'nonmember'}`, async ({ page }) => {
    await mock(page, status);
    await page.setViewportSize({ width: 320, height: 760 });
    await page.goto('/');
    const tiles = page.getByRole('navigation', { name: 'Home shortcuts' });
    await expect(tiles.getByRole('link')).toHaveCount(4);
    await expect(tiles.getByRole('link', { name: 'Modules', exact: true })).toHaveAttribute('href', `${root}/modules`);
    const guidance = status === 'BANNED' ? '/support' : `${root}/membership`;
    for (const label of ['Announcements', 'Posts', 'Discussion']) await expect(tiles.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('href', guidance);
    const bar = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
    await expect(bar.getByRole('link')).toHaveCount(5);
    for (const label of ['Posts', 'Discussion']) await expect(bar.getByRole('link', { name: new RegExp(`^${label}:`) })).toHaveAttribute('href', guidance);
    await expect(page.locator('main')).not.toContainText('Active member');
  });
}

test('F7 module index selection, filters Back/Forward, retry and reader round trip', async ({ page }) => {
  const { state, requests } = await mock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${root}/modules`);
  await expect(page.getByRole('heading', { name: 'Choose a module to get started' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Module choices' }).getByRole('link', { name: 'Algebra I' }).click();
  await expect(page.getByRole('heading', { name: documentFixture.title })).toBeVisible();
  await page.getByLabel('Search documents').fill('waves');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByLabel('Type', { exact: true }).selectOption('TD');
  await page.getByLabel('Source', { exact: true }).selectOption('STUDENT');
  await page.goBack();
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('');
  await page.goForward();
  await expect(page.getByLabel('Source', { exact: true })).toHaveValue('STUDENT');
  state.documentMode = 'error';
  await page.getByLabel('Type', { exact: true }).selectOption('COURSE');
  await expect(page.getByRole('alert')).toContainText('Failed to load documents');
  state.documentMode = 'normal';
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: documentFixture.title })).toBeVisible();
  expect(requests.at(-1)).toContain('q=waves&type=COURSE&source=STUDENT');
  await page.getByRole('link', { name: 'Read Document' }).click();
  await expect(page.getByRole('heading', { name: documentFixture.title })).toBeVisible();
  await page.getByRole('link', { name: 'Back to module documents' }).click();
  await expect(page.getByLabel('Search documents')).toHaveValue('waves');
  await page.getByRole('navigation', { name: 'Module choices' }).getByRole('link', { name: 'Computer networks' }).click();
  await expect(page.getByRole('heading', { name: 'Computer networks', exact: true })).toBeVisible();
  await expect(page.getByText('No documents found for this module yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: documentFixture.title })).toHaveCount(0);
});

test('F7 announcement request errors differ from empty and creation remains capability-gated', async ({ page }) => {
  const { state } = await mock(page, 'ACTIVE', true);
  state.noticeMode = 'error';
  await page.goto(`${root}/announcements`);
  await expect(page.getByRole('alert')).toContainText('Failed to load announcements');
  await expect(page.getByText('No announcements published yet.')).toHaveCount(0);
  state.noticeMode = 'empty';
  await page.getByRole('button', { name: 'Retry Loading' }).click();
  await expect(page.getByText('No announcements published yet.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Post Announcement' })).toBeVisible();
  state.noticeMode = 'normal';
  await page.reload();
  await expect(page.getByRole('heading', { name: notices[0].title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove announcement', exact: true })).toHaveCount(2);
});

test('F7 guest account and Home layouts have no signed-in bottom bar', async ({ page }) => {
  const { state } = await mock(page);
  state.guest = true;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/login', '/register']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation', includeHidden: true })).toHaveCount(0);
  }
});

for (const theme of ['light', 'dark']) {
  for (const width of [320, 1440]) {
    test(`F7 detail capture and reader-compatible shell: ${theme}, ${width}px`, async ({ page }, info) => {
      await mock(page);
      await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${root}/announcements/${noticeId}`);
      await expect(page.getByRole('heading', { name: notices[0].title })).toBeVisible();
      await expect(page.getByLabel('Leave a reply')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to Announcements' })).toHaveAttribute('href', `${root}/announcements`);
      await page.getByLabel('Leave a reply').focus();
      await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.getByLabel('Leave a reply').blur();
      await page.screenshot({ path: info.outputPath(`announcement-detail-${theme}-${width}.png`), fullPage: true });
    });
  }
}
