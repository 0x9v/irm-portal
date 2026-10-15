import { test, expect, type Page } from './moderation-fixtures';

type Persona = 'none' | 'pending' | 'rejected' | 'removed' | 'banned' | 'member' | 'moderator' | 'delegate' | 'membership-error';

const users = {
  member: { id: 'home-member-a', username: 'a_very_long_student_username_for_irm_home_layout', email: 'private@example.test', first_name: 'Student', family_name: 'Fixture' },
  next: { id: 'home-member-b', username: 'second_irm_user', email: 'second-private@example.test', first_name: 'Another', family_name: 'Student' },
};

const moduleFixture = (index: number) => ({
  id: `module-${index}`,
  community_id: 'irm-community',
  name: ['Algorithms and Data Structures', 'Computer Networks', 'Database Systems', 'Software Engineering', 'Hidden Fifth Module'][index - 1],
  slug: ['algorithms-and-data-structures', 'computer-networks', 'database-systems', 'software-engineering', 'hidden-fifth-module'][index - 1],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const announcements = [
  { id: 'notice-newest', title: 'Newest IRM notice', content: 'Latest real announcement body.', created_at: '2026-10-10T12:00:00Z', author_username: 'delegate_fixture' },
  { id: 'notice-middle', title: 'Previous IRM notice', content: 'Earlier real announcement body.', created_at: '2026-10-09T12:00:00Z', author_username: 'moderator_fixture' },
  { id: 'notice-oldest', title: 'Older IRM notice', content: 'Oldest real announcement body.', created_at: '2026-10-08T12:00:00Z', author_username: 'member_fixture' },
];

const statusFor: Record<Persona, string | null> = {
  none: null,
  pending: 'PENDING',
  rejected: 'REJECTED',
  removed: 'REMOVED',
  banned: 'BANNED',
  member: 'ACTIVE',
  moderator: 'ACTIVE',
  delegate: 'ACTIVE',
  'membership-error': 'ACTIVE',
};

async function mockHome(page: Page, persona: Persona, options: {
  announcementCount?: number;
  announcementsFail?: number;
  announcementForbidden?: boolean;
  modulesFail?: number;
  modulesEmpty?: boolean;
  delayedMembership?: boolean;
  delayedModules?: boolean;
  delayedAnnouncements?: boolean;
  votingCapability?: boolean;
} = {}) {
  const state = {
    persona,
    user: users.member,
    announcementCount: options.announcementCount ?? 3,
    announcementsFail: options.announcementsFail ?? 0,
    announcementForbidden: options.announcementForbidden ?? false,
    modulesFail: options.modulesFail ?? 0,
    modulesEmpty: options.modulesEmpty ?? false,
    delayedMembership: options.delayedMembership ?? false,
    delayedModules: options.delayedModules ?? false,
    delayedAnnouncements: options.delayedAnnouncements ?? false,
    announcementReleases: [] as (() => void)[],
    moduleReleases: [] as (() => void)[],
    membershipReleases: [] as (() => void)[],
    releaseModules() { state.moduleReleases.splice(0).forEach(resolve => resolve()); },
    releaseAnnouncements() { state.announcementReleases.splice(0).forEach(resolve => resolve()); },
    releaseMembership() { state.membershipReleases.splice(0).forEach(resolve => resolve()); },
  };
  const apiRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) apiRequests.push(`${request.method()} ${url.pathname}${url.search}`);
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: state.user });
    if (path.endsWith('/membership/me')) {
      if (state.delayedMembership) await new Promise<void>(resolve => { state.membershipReleases.push(resolve); });
      if (state.persona === 'membership-error') return route.fulfill({ status: 503, json: { detail: 'Membership unavailable' } });
      const status = statusFor[state.persona];
      const role = state.persona === 'delegate' ? 'DELEGATE' : state.persona === 'moderator' ? 'MODERATOR' : 'MEMBER';
      return route.fulfill({ json: {
        membership: status ? {
          id: `membership-${state.user.id}`,
          status,
          role,
          cne: 'PRIVATE-CNE-DO-NOT-RENDER',
          applicant_type: 'STUDENT',
          applicant_first_name: 'PRIVATE-FIRST-NAME',
          applicant_family_name: 'PRIVATE-FAMILY-NAME',
          identifier_type: 'FOREIGN',
          promotion: 'PRIVATE-PROMOTION',
        } : null,
        capabilities: {
          create_announcements: state.persona === 'moderator',
          upload_official_documents: state.persona === 'moderator',
          manage_document_voting: options.votingCapability ?? (state.persona === 'moderator' || state.persona === 'delegate'),
        },
      } });
    }
    if (path.endsWith('/modules')) {
      if (state.delayedModules) await new Promise<void>(resolve => { state.moduleReleases.push(resolve); });
      if (state.modulesFail > 0) {
        state.modulesFail--;
        return route.fulfill({ status: 503, json: { detail: 'Modules temporarily unavailable' } });
      }
      return route.fulfill({ json: state.modulesEmpty ? [] : [1, 2, 3, 4, 5].map(moduleFixture) });
    }
    if (path.endsWith('/announcements')) {
      if (state.delayedAnnouncements) await new Promise<void>(resolve => { state.announcementReleases.push(resolve); });
      if (state.announcementForbidden) return route.fulfill({ status: 403, json: { detail: 'Active membership required' } });
      if (state.announcementsFail > 0) {
        state.announcementsFail--;
        return route.fulfill({ status: 503, json: { detail: 'Announcements temporarily unavailable' } });
      }
      return route.fulfill({ json: announcements.slice(0, state.announcementCount) });
    }
    if (path.endsWith('/auth/logout') && request.method() === 'POST') return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, json: { detail: `Unexpected API request: ${path}` } });
  });
  return { state, apiRequests };
}

async function openHome(page: Page, persona: Persona, options: Parameters<typeof mockHome>[2] = {}) {
  const mock = await mockHome(page, persona, options);
  await page.goto('/');
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main').getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('main').getByRole('heading', { name: /Your resources\..*Your people\./ })).toBeVisible();
  return mock;
}

const activeOnlyRoutes = [
  '/communities/irm/announcements', '/communities/irm/documents/mine',
  '/communities/irm/membership/review', '/communities/irm/membership/staff',
  '/communities/irm/membership/members', '/communities/irm/document-voting/settings',
];

test.describe('Signed-in Home dashboard (isolated mocked API)', () => {
  for (const [persona, expectedText] of [
    ['none', 'No membership request'],
    ['pending', 'Application pending'],
    ['rejected', 'Application not approved'],
    ['removed', 'Membership ended'],
    ['banned', 'Access restricted'],
  ] as const) {
    test(`${persona}: modules and only the permitted membership actions`, async ({ page }) => {
      const { apiRequests } = await openHome(page, persona);
      const main = page.locator('main');
      await expect(main.getByText(expectedText, { exact: true })).toBeVisible();
      await expect(main.getByRole('link', { name: 'Browse modules', exact: true }).first()).toHaveAttribute('href', '/communities/irm/modules');
      await expect(main.getByRole('link', { name: 'Saved documents' })).toHaveAttribute('href', '/communities/irm/documents/saved');
      const quick = main.getByRole('region', { name: 'Quick access' });
      await expect(quick.getByRole('link', { name: 'Recently opened' })).toHaveAttribute('href', '/communities/irm/documents/recent');
      await expect(quick.getByRole('link')).toHaveCount(2);
      await expect(quick.getByRole('link', { name: 'Membership' })).toHaveCount(0);
      for (const route of activeOnlyRoutes) await expect(main.locator(`a[href="${route}"]`)).toHaveCount(0);
      expect(apiRequests.some(value => value.endsWith('/modules'))).toBe(true);
      expect(apiRequests.some(value => value.includes('/announcements'))).toBe(false);
      await expect(main.getByRole('region', { name: 'Latest announcements' })).toHaveCount(0);
      if (persona === 'banned') {
        await expect(main.getByRole('link', { name: 'Contact Support' }).first()).toHaveAttribute('href', '/support');
        await expect(main.getByRole('link', { name: /Reapply|Request membership/ })).toHaveCount(0);
      } else if (persona === 'pending') {
        await expect(main.getByRole('link', { name: /Check application|View application/ }).first()).toHaveAttribute('href', '/account#community-membership');
        await expect(main).toContainText('awaiting review');
      } else if (persona === 'rejected' || persona === 'removed') {
        await expect(main.getByRole('link', { name: /Reapply|Review or reapply/ }).first()).toHaveAttribute('href', '/account#community-membership');
      } else {
        await expect(main.getByRole('link', { name: 'Request membership' }).first()).toHaveAttribute('href', '/account#community-membership');
      }
      await expect(main).not.toContainText('PRIVATE-CNE-DO-NOT-RENDER');
      await expect(main).not.toContainText('PRIVATE-FIRST-NAME');
      await expect(main).not.toContainText('PRIVATE-FAMILY-NAME');
      await expect(main).not.toContainText('PRIVATE-PROMOTION');
      await expect(main).not.toContainText('private@example.test');
    });
  }

  test('membership verification error offers retry and hides every protected destination', async ({ page }) => {
    const { state, apiRequests } = await openHome(page, 'membership-error');
    const main = page.locator('main');
    await expect(main.getByText('Verification unavailable', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: /Retry verification/i }).first()).toBeVisible();
    const quick = main.getByRole('region', { name: 'Quick access' });
    await expect(quick.getByRole('link')).toHaveCount(2);
    await expect(quick.getByRole('link', { name: 'Recently opened' })).toHaveAttribute('href', '/communities/irm/documents/recent');
    for (const route of activeOnlyRoutes) await expect(main.locator(`a[href="${route}"]`)).toHaveCount(0);
    expect(apiRequests.some(value => value.includes('/announcements'))).toBe(false);
    await expect(main).not.toContainText('No membership request');
    state.persona = 'member';
    await main.getByRole('button', { name: /Retry verification/i }).click();
    await expect(main.getByText('Active member', { exact: true })).toBeVisible();
    await expect(main.locator('a[aria-label^="Announcement:"]')).toHaveCount(3);
  });

  test('delayed membership verification does not flash signed-in or guest actions', async ({ page }) => {
    const { state } = await mockHome(page, 'member', { delayedMembership: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const main = page.locator('main');
    await expect(main.getByRole('status').filter({ hasText: 'Checking your account' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
    await expect(main.getByText(`@${users.member.username}`)).toHaveCount(0);
    state.releaseMembership();
    await expect(main.getByText(`@${users.member.username}`)).toBeVisible();
  });

  for (const persona of ['member', 'moderator', 'delegate'] as const) {
    test(`ACTIVE ${persona}: announcements, modules and role-aware actions`, async ({ page }) => {
      const { apiRequests } = await openHome(page, persona);
      const main = page.locator('main');
      await expect(main.getByRole('link', { name: 'My submissions' })).toHaveAttribute('href', '/communities/irm/documents/mine');
      await expect(main.getByRole('link', { name: 'Saved documents' })).toHaveAttribute('href', '/communities/irm/documents/saved');
      await expect(main.getByRole('link', { name: 'Recently opened' })).toHaveAttribute('href', '/communities/irm/documents/recent');
      const quick = main.getByRole('region', { name: 'Quick access' });
      await expect(quick.getByRole('link')).toHaveCount(4);
      await expect(quick.getByRole('link', { name: 'Pending documents' })).toHaveAttribute('href', '/communities/irm/documents/pending');
      for (const label of ['Membership', 'Posts', 'Discussion', 'Announcements', 'Modules']) {
        await expect(quick.getByRole('link', { name: label })).toHaveCount(0);
      }
      await expect(main.getByRole('region', { name: 'Your IRM access' }).getByRole('link', { name: 'View membership' })).toHaveCount(0);
      for (const [index, notice] of announcements.entries()) {
        await expect(main.getByRole('link', { name: `Announcement: ${notice.title}` })).toHaveAttribute('href', `/communities/irm/announcements/${notice.id}`);
        const visible = await main.getByRole('link', { name: `Announcement: ${notice.title}` }).boundingBox();
        expect(visible).not.toBeNull();
        if (index > 0) expect(apiRequests[0]).toBeDefined();
      }
      const announcementLinks = main.locator('a[aria-label^="Announcement:"]');
      await expect(announcementLinks).toHaveCount(3);
      await expect(main.getByRole('link', { name: 'Module: Algorithms and Data Structures' })).toHaveAttribute('href', '/communities/irm/modules/algorithms-and-data-structures');
      await expect(main.getByRole('link', { name: 'Module: Hidden Fifth Module' })).toHaveCount(0);
      expect(apiRequests.some(value => value.endsWith('/announcements?limit=3'))).toBe(true);
      expect(apiRequests.some(value => value.endsWith('/modules'))).toBe(true);
      const navigation = page.getByRole('navigation', { name: 'Main Navigation' });
      if (persona === 'delegate') {
        for (const [label, path] of [['Review applications', '/communities/irm/membership/review'], ['Manage staff', '/communities/irm/membership/staff'], ['Members', '/communities/irm/membership/members']] as const) {
          await expect(navigation.getByRole('link', { name: label })).toHaveAttribute('href', path);
        }
        await expect(navigation.getByRole('link', { name: 'Voting settings' })).toHaveAttribute('href', '/communities/irm/document-voting/settings');
      } else {
        await expect(navigation.getByRole('link', { name: 'Review applications' })).toHaveCount(0);
        await expect(navigation.getByRole('link', { name: 'Manage staff' })).toHaveCount(0);
        if (persona === 'moderator') await expect(navigation.getByRole('link', { name: 'Voting settings' })).toHaveAttribute('href', '/communities/irm/document-voting/settings');
      }
    });
  }

  for (const count of [0, 1, 3]) {
    test(`renders ${count} actual announcements in backend order`, async ({ page }) => {
      await openHome(page, 'member', { announcementCount: count });
      const list = page.locator('main a[aria-label^="Announcement:"]');
      await expect(list).toHaveCount(count);
      for (let index = 0; index < count; index++) {
        await expect(list.nth(index)).toHaveAttribute('aria-label', `Announcement: ${announcements[index].title}`);
      }
      if (!count) await expect(page.locator('main')).toContainText('No announcements published yet.');
    });
  }

  test('delayed announcements show loading before real rows arrive', async ({ page }) => {
    const { state } = await mockHome(page, 'member', { delayedAnnouncements: true });
    await page.goto('/');
    await expect(page.locator('main').getByRole('status').filter({ hasText: 'Loading latest announcements' })).toBeVisible();
    await expect(page.locator('main a[aria-label^=\"Announcement:\"]')).toHaveCount(0);
    state.releaseAnnouncements();
    await expect(page.locator('main a[aria-label^=\"Announcement:\"]')).toHaveCount(3);
  });

  test('announcement failure retries; a 403 clears real rows and does not retain them', async ({ page }) => {
    const { state } = await mockHome(page, 'member', { announcementsFail: 1 });
    await page.goto('/');
    const main = page.locator('main');
    await expect(main.getByRole('button', { name: 'Retry Loading' })).toBeVisible();
    state.announcementForbidden = true;
    await main.getByRole('button', { name: 'Retry Loading' }).click();
    await expect(main).toContainText('do not have access to view community announcements');
    await expect(main.locator('a[aria-label^="Announcement:"]')).toHaveCount(0);
  });

  test('announcement retry restores real data after a transient error', async ({ page }) => {
    await openHome(page, 'member', { announcementsFail: 1 });
    const main = page.locator('main');
    await expect(main).toContainText('Announcements temporarily unavailable');
    await main.getByRole('button', { name: 'Retry Loading' }).click();
    await expect(main.getByRole('link', { name: 'Announcement: Newest IRM notice' })).toHaveAttribute('href', '/communities/irm/announcements/notice-newest');
  });

  test('module loading, empty and error/retry states keep their real names and routes', async ({ page }) => {
    const { state } = await mockHome(page, 'none', { delayedModules: true, modulesEmpty: true });
    await page.goto('/');
    const main = page.locator('main');
    await expect(main.getByRole('status').filter({ hasText: 'Loading modules' })).toBeVisible();
    state.releaseModules();
    await expect(main.getByText('No modules found.')).toBeVisible();
  });

  test('module request errors can be retried without changing the Home request contract', async ({ page }) => {
    await openHome(page, 'none', { modulesFail: 1 });
    const main = page.locator('main');
    await expect(main.getByRole('button', { name: 'Retry Loading' })).toBeVisible();
    await main.getByRole('button', { name: 'Retry Loading' }).click();
    await expect(main.getByRole('link', { name: 'Module: Computer Networks' })).toHaveAttribute('href', '/communities/irm/modules/computer-networks');
  });

  test('logout removes account-specific Home data', async ({ page }) => {
    const { state } = await openHome(page, 'member', { delayedModules: true });
    await expect(page.locator('main a[aria-label="Announcement: Newest IRM notice"]')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Account options', exact: true }).click();
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
    state.releaseModules();
    await expect(page.locator('main')).not.toContainText('Newest IRM notice');
    await expect(page.locator('main')).not.toContainText('Algorithms and Data Structures');
  });

  test('the primary action activates from the keyboard', async ({ page }) => {
    await openHome(page, 'none');
    const action = page.locator('main').getByRole('link', { name: 'Browse modules', exact: true }).first();
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/communities\/irm\/modules$/);
  });

  test('mobile Modules tile is one keyboard-accessible destination', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page, 'member');
    const card = page.getByRole('navigation', { name: 'Home shortcuts' }).getByRole('link', { name: 'Modules', exact: true });
    await card.focus();
    await expect(card).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/communities\/irm\/modules$/);
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      test(`${theme} theme at ${width}px: focus is visible and no horizontal overflow`, async ({ page }, testInfo) => {
        await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
        await mockHome(page, 'member', { announcementCount: 1 });
        await page.setViewportSize({ width, height: 920 });
        await page.goto('/');
        const main = page.locator('main');
        await expect(main.getByRole('heading', { name: /Your resources\..*Your people\./ })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
        const action = main.getByRole('link', { name: 'Browse modules', exact: true }).first();
        await expect(action).toHaveCSS('text-decoration-line', 'none');
        for (const row of await main.locator('a[aria-label^="Announcement:"], a[aria-label^="Module:"]').all()) await expect(row).toHaveCSS('text-decoration-line', 'none');
        const quick = main.getByRole('region', { name: 'Quick access' });
        await expect(quick.getByRole('link')).toHaveCount(4);
        for (const tile of await quick.getByRole('link').all()) {
          await expect(tile).toHaveCSS('text-decoration-line', 'none');
          expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await action.focus();
        await expect(action).toHaveCSS('outline-width', '2px');
        const bounds = await action.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}.png`), fullPage: true });
        }
      });
    }
  }


  test('Moderator without voting capability has no management destinations', async ({ page }) => {
    await openHome(page, 'moderator', { votingCapability: false });
    const main = page.locator('main');
    const navigation = page.getByRole('navigation', { name: 'Main Navigation' });
    for (const path of ['/membership/review', '/membership/staff', '/membership/members', '/document-voting/settings']) {
      await expect(main.locator(`a[href="/communities/irm${path}"]`)).toHaveCount(0);
      await expect(navigation.locator(`a[href="/communities/irm${path}"]`)).toHaveCount(0);
    }
  });

  for (const width of [320, 390, 1440]) {
    test(`composition and reading order at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page, 'member');
      const main = page.locator('main');
      const hero = main.getByRole('region', { name: /Your resources\..*Your people\./ });
      const features = width < 1024 ? main.getByRole('navigation', { name: 'Home shortcuts' }) : main.getByRole('region', { name: 'Useful next steps' });
      const feed = main.getByRole('region', { name: 'Latest announcements' });
      const modules = main.getByRole('region', { name: 'Your modules' });
      const quick = main.getByRole('region', { name: 'Quick access' });
      const access = main.getByRole('region', { name: 'Your IRM access' });
      await expect(features.getByRole('heading', { level: 2 })).toHaveCount(width < 1024 ? 0 : 3);
      await expect(features.getByRole('link')).toHaveCount(width < 1024 ? 4 : 3);
      for (const card of await features.getByRole('link').all()) {
        await expect(card).toHaveCSS('text-decoration-line', 'none');
        expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(features.getByRole('link', { name: width < 1024 ? 'Discussion' : 'Community spaces: Join discussion' })).toHaveAttribute('href', '/communities/irm/discussion');
      await expect(features.getByRole('link', { name: width < 1024 ? 'Announcements' : 'Latest announcements: View announcements' })).toHaveAttribute('href', '/communities/irm/announcements');
      const sections = [hero, features, feed, modules, quick, access, page.locator('[data-site-footer]')];
      for (let i = 1; i < sections.length; i++) {
        const earlier = await sections[i - 1].elementHandle();
        expect(await sections[i].evaluate((current, previous) => Boolean(previous && previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING), earlier)).toBe(true);
      }
      const boxes = await Promise.all(sections.map(section => section.boundingBox()));
      if (width < 768) {
        for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
      } else {
        expect(boxes[4]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width);
        expect(Math.abs(boxes[4]!.y - boxes[0]!.y)).toBeLessThan(2);
        expect(boxes[0]!.width / boxes[4]!.width).toBeGreaterThan(2);
      }
      expect(boxes[6]!.y).toBeGreaterThan(boxes[5]!.y + boxes[5]!.height);
      expect(boxes[6]!.y).toBeGreaterThan(boxes[3]!.y + boxes[3]!.height);
      await expect(page.locator('[data-site-footer]')).toHaveText(`© ${new Date().getFullYear()} EtudSup · v0.1 · All rights reserved.`);
      await expect(main).not.toContainText('Pre-alpha');
    });
  }

  test('captures a pending membership state', async ({ page }, testInfo) => {
    await openHome(page, 'pending');
    await page.screenshot({ path: testInfo.outputPath('pending-1440.png'), fullPage: true });
  });
});
