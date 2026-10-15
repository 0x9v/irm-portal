import { test, expect } from '@playwright/test';

test.describe('Shared Navigation and Application Shell', () => {
  test('Guest navigation displays public links and login/register, without privileged controls', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });

    await page.goto('/');

    const nav = page.locator('aside, header');

    // Brand link
    const brand = nav.getByRole('link', { name: 'IRM Hub' });
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute('href', '/');

    // Main Navigation
    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    await expect(mainNav.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Modules' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Announcements' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Membership' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Support' })).toBeVisible();

    // Privileged links must be hidden
    await expect(mainNav.getByRole('link', { name: 'Pending Docs' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Manage Staff' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Voting Settings' })).toHaveCount(0);

    // Guest Account actions
    await expect(nav.getByRole('link', { name: 'Log In' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Register' })).toBeVisible();

    // Active state on Home
    const homeLink = mainNav.getByRole('link', { name: 'Home' });
    await expect(homeLink).toHaveAttribute('aria-current', 'page');
  });

  test('ACTIVE MEMBER sees Pending Docs but not delegate/moderator management links', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-1',
          username: 'student_member',
          email: 'student@example.com',
          first_name: 'Student',
          family_name: 'Member',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-1', status: 'ACTIVE', role: 'MEMBER' },
          capabilities: {
            create_announcements: false,
            manage_document_voting: false,
            upload_official_documents: false,
          },
        },
      });
    });

    await page.goto('/');

    const nav = page.locator('aside, header');
    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    await expect(mainNav.getByRole('link', { name: 'Pending Docs' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Manage Staff' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Voting Settings' })).toHaveCount(0);

    // Account displays username and membership
    await expect(nav.getByText('student_member')).toBeVisible();
    await expect(nav.getByText('ACTIVE MEMBER')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Logout' })).toBeVisible();
  });

  test('ACTIVE DELEGATE sees Review Applications and Manage Staff in Management navigation', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-2',
          username: 'delegate_user',
          email: 'delegate@example.com',
          first_name: 'Del',
          family_name: 'Egate',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-2', status: 'ACTIVE', role: 'DELEGATE' },
          capabilities: {
            create_announcements: true,
            manage_document_voting: false,
            upload_official_documents: true,
          },
        },
      });
    });

    await page.goto('/');

    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Manage Staff' })).toBeVisible();
    // Voting settings is not granted
    await expect(mainNav.getByRole('link', { name: 'Voting Settings' })).toHaveCount(0);
  });

  test('MODERATOR with manage_document_voting capability sees Voting Settings', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-3',
          username: 'voting_mod',
          email: 'mod@example.com',
          first_name: 'Voting',
          family_name: 'Mod',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-3', status: 'ACTIVE', role: 'MODERATOR' },
          capabilities: {
            create_announcements: false,
            manage_document_voting: true,
            upload_official_documents: false,
          },
        },
      });
    });

    await page.goto('/');

    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    await expect(mainNav.getByRole('link', { name: 'Voting Settings' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Manage Staff' })).toHaveCount(0);
  });

  test('MODERATOR without manage_document_voting capability does not see Management navigation', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-4',
          username: 'plain_mod',
          email: 'plainmod@example.com',
          first_name: 'Plain',
          family_name: 'Mod',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-4', status: 'ACTIVE', role: 'MODERATOR' },
          capabilities: {
            create_announcements: true,
            manage_document_voting: false,
            upload_official_documents: false,
          },
        },
      });
    });

    await page.goto('/');
    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Manage Staff' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Voting Settings' })).toHaveCount(0);
  });

  test('Mobile menu expands, provides accessible grouping, and closes on Escape and selection', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-5',
          username: 'mobile_user',
          email: 'mobile@example.com',
          first_name: 'Mobile',
          family_name: 'User',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-5', status: 'ACTIVE', role: 'MEMBER' },
          capabilities: {
            create_announcements: false,
            manage_document_voting: false,
            upload_official_documents: false,
          },
        },
      });
    });

    await page.goto('/');

    const header = page.locator('header');
    const toggle = header.locator('button[aria-controls="mobile-navigation"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-label', 'Open navigation menu');

    // Open menu
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveAttribute('aria-label', 'Close navigation menu');

    const mobileNav = header.locator('#mobile-navigation');
    await expect(mobileNav).toBeVisible();

    // Check grouped sections
    await expect(mobileNav.getByText('Study')).toBeVisible();
    await expect(mobileNav.getByText('Community')).toBeVisible();
    await expect(mobileNav.getByText('Account')).toBeVisible();
    await expect(mobileNav.getByText('mobile_user')).toBeVisible();

    // Escape closes menu and returns focus
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(mobileNav).toHaveCount(0);
    await expect(toggle).toBeFocused();

    // Reopen and click a link to navigate
    await toggle.click();
    await mobileNav.getByRole('link', { name: 'Support' }).click();
    await page.waitForURL('/support');
    await expect(mobileNav).toHaveCount(0);
  });

  test('Current-section highlighting correctly distinguishes nested and sibling routes', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-6',
          username: 'nav_tester',
          email: 'tester@example.com',
          first_name: 'Nav',
          family_name: 'Tester',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-6', status: 'ACTIVE', role: 'DELEGATE' },
          capabilities: {
            create_announcements: true,
            manage_document_voting: true,
            upload_official_documents: true,
          },
        },
      });
    });

    // 1. Visit Modules root
    await page.route('**/api/v1/communities/irm/modules', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.goto('/communities/irm/modules');

    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    await expect(mainNav.getByRole('link', { name: 'Modules' })).toHaveAttribute('aria-current', 'page');
    await expect(mainNav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');

    // 2. Visit Membership review queue: Review should be highlighted, Membership root must NOT be highlighted
    await page.route('**/api/v1/communities/irm/membership/pending', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.goto('/communities/irm/membership/review');

    await expect(mainNav.getByRole('link', { name: 'Membership' })).not.toHaveAttribute('aria-current', 'page');
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toHaveAttribute('aria-current', 'page');
    await expect(mainNav.getByRole('link', { name: 'Manage Staff' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('Logout success navigates to /login; logout failure displays inline error and keeps session', async ({ page }) => {
    let logoutCallCount = 0;

    await page.route('**/api/v1/auth/me', async (route) => {
      if (logoutCallCount > 0) {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      } else {
        await route.fulfill({
          status: 200,
          json: {
            id: 'u-7',
            username: 'logout_user',
            email: 'logout@example.com',
            first_name: 'Log',
            family_name: 'Out',
          },
        });
      }
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-7', status: 'ACTIVE', role: 'MEMBER' },
          capabilities: {
            create_announcements: false,
            manage_document_voting: false,
            upload_official_documents: false,
          },
        },
      });
    });

    // 1. First test failure: logout endpoint returns 500
    await page.route('**/api/v1/auth/logout', async (route) => {
      if (logoutCallCount === 0) {
        await route.fulfill({ status: 500, json: { detail: 'Server error' } });
      } else {
        await route.fulfill({ status: 200, json: {} });
      }
    });

    await page.goto('/');

    const nav = page.locator('aside, header');
    const logoutBtn = nav.getByRole('button', { name: 'Logout' });
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Verify error displayed, session not destroyed
    await expect(nav.getByRole('alert')).toHaveText('Logout failed. Please try again.');
    await expect(nav.getByText('logout_user')).toBeVisible();

    // 2. Retry succeeds
    logoutCallCount = 1;
    await logoutBtn.click();
    await page.waitForURL('/login');
  });

  test('Membership request failure does not make authenticated user appear logged out', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-8',
          username: 'resilient_user',
          email: 'resilient@example.com',
          first_name: 'Resilient',
          family_name: 'User',
        },
      });
    });

    // Membership endpoint fails with 500
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 500, json: { detail: 'Database error' } });
    });

    await page.goto('/');

    const nav = page.locator('aside, header');

    // User is still shown as authenticated
    await expect(nav.getByText('resilient_user')).toBeVisible();
    await expect(nav.getByText('Membership unavailable')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Logout' })).toBeVisible();

    // Privileged links remain hidden
    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    await expect(mainNav.getByRole('link', { name: 'Pending Docs' })).toHaveCount(0);
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toHaveCount(0);
  });

  test('No horizontal page-level overflow across responsive viewports (320px, 390px, 768px)', async ({ page }) => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    }
  });

  test('At 1280px, desktop sidebar navigation fits with long username and delegate management links', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 768 });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-long-delegate',
          username: 'very_long_delegate_username_fst',
          email: 'delegate@example.com',
          first_name: 'VeryLong',
          family_name: 'DelegateName',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-long-del', status: 'ACTIVE', role: 'DELEGATE' },
          capabilities: {
            create_announcements: true,
            manage_document_voting: true,
            upload_official_documents: true,
          },
        },
      });
    });

    await page.goto('/');

    const nav = page.locator('aside');
    const mainNav = nav.locator("nav[aria-label='Main Navigation']");

    // All primary, community, and management links visible
    await expect(mainNav.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Modules' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Announcements' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Posts' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Pending Docs' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Membership' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Support' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Manage Staff' })).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Voting Settings' })).toBeVisible();

    // Account controls visible
    await expect(nav.getByText('very_long_delegate_username_fst')).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Logout' })).toBeVisible();

    // No page-level horizontal overflow at 1280px
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Sidebar itself must have 248px width
    const asideBox = await nav.boundingBox();
    expect(asideBox).not.toBeNull();
    expect(asideBox!.width).toBe(248);

    // Single main landmark
    const mainLandmarks = page.locator('main');
    await expect(mainLandmarks).toHaveCount(1);
  });
});
