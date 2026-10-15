import { test, expect } from '@playwright/test';

test.describe('Task 1.3: Navigation, Layout, Semantics & Adverse Lifecycles', () => {

  test('At 768px viewport, navigation fits without overflow for Guest, Member, and Delegate', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });

    // 1. Guest at 768px
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });
    await page.goto('/');
    let isOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(isOverflowing, 'Guest at 768px should not overflow').toBe(false);

    // 2. Active Delegate at 768px
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-del',
          username: 'delegate_user_with_full_role',
          email: 'delegate@example.com',
          first_name: 'Imane',
          family_name: 'Delegate',
        },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-1', status: 'ACTIVE', role: 'DELEGATE' },
          capabilities: {
            create_announcements: true,
            manage_document_voting: true,
            upload_official_documents: true,
          },
        },
      });
    });

    await page.goto('/');
    isOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(isOverflowing, 'Active Delegate at 768px should not overflow').toBe(false);

    // Verify mobile hamburger is accessible at 768px and opens without overflow
    const mobileToggle = page.getByRole('button', { name: /Open navigation menu/i });
    await expect(mobileToggle).toBeVisible();
    await mobileToggle.click();
    await expect(page.getByRole('button', { name: /Close navigation menu/i })).toBeVisible();

    isOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(isOverflowing, 'Expanded mobile menu at 768px should not overflow').toBe(false);

    // 3. Short mobile viewport at 320x480
    await page.setViewportSize({ width: 320, height: 480 });
    await page.goto('/');
    isOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(isOverflowing, '320x480 short viewport should not overflow').toBe(false);

    // 4. Desktop at 1280px width
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    isOverflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(isOverflowing, '1280px desktop should not overflow').toBe(false);
    // Desktop main nav should be visible, hamburger hidden
    await expect(page.locator("nav[aria-label='Main Navigation']")).toBeVisible();
    await expect(mobileToggle).toBeHidden();
  });

  test('Root destination matching does not falsely activate on prefix-similar paths', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });

    // 1. Visit /support -> Support must be active
    await page.goto('/support');
    const supportLink = page.locator("nav[aria-label='Main Navigation']").getByRole('link', { name: 'Support' });
    await expect(supportLink).toHaveAttribute('aria-current', 'page');

    // 2. Visit / -> Home must be active, Support must NOT be active
    await page.goto('/');
    const homeLink = page.locator("nav[aria-label='Main Navigation']").getByRole('link', { name: 'Home' });
    await expect(homeLink).toHaveAttribute('aria-current', 'page');
    await expect(supportLink).not.toHaveAttribute('aria-current', 'page');
  });

  test('Semantic structure: exactly one <main> landmark per page across application routes', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });

    const routes = [
      '/',
      '/login',
      '/register',
      '/support',
      '/communities/irm/modules',
      '/account#community-membership',
    ];

    for (const path of routes) {
      await page.goto(path);
      const mainLandmarks = page.locator('main');
      await expect(mainLandmarks, `Page ${path} should have exactly one main landmark`).toHaveCount(1);
    }
  });

  test('Adverse Session Lifecycle: in-flight request resolving after logout does not restore user', async ({ page }) => {
    let respondAuthPromise: () => void = () => {};
    let shouldDelay = false;

    await page.route('**/api/v1/auth/me', async (route) => {
      if (shouldDelay) {
        // Hold the response until signaled
        await new Promise<void>((resolve) => {
          respondAuthPromise = resolve;
        });
        await route.fulfill({
          status: 200,
          json: { id: 'u-1', username: 'stale_user', email: 's@test.com', first_name: 'Stale', family_name: 'User' },
        });
      } else {
        await route.fulfill({
          status: 200,
          json: { id: 'u-1', username: 'active_user', email: 'a@test.com', first_name: 'Active', family_name: 'User' },
        });
      }
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-1', status: 'ACTIVE', role: 'MEMBER' },
          capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
        },
      });
    });

    await page.route('**/api/v1/auth/logout', async (route) => {
      await route.fulfill({ status: 200, json: { detail: 'Logged out' } });
    });

    await page.goto('/');
    const header = page.locator('aside, header');
    await expect(header.getByText('active_user')).toBeVisible();

    // Now make next auth request slow, and trigger a refresh or action
    shouldDelay = true;
    
    // Click logout
    const logoutBtn = header.getByRole('button', { name: 'Logout' });
    await logoutBtn.click();

    // After logout, user should be cleared and guest links visible
    await expect(header.getByRole('link', { name: 'Log In' })).toBeVisible();
    await expect(header.getByText('active_user')).toHaveCount(0);

    // Now let the delayed in-flight request complete
    respondAuthPromise();
    await page.waitForTimeout(200);

    // The stale user must NOT be restored
    await expect(header.getByText('stale_user')).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Log In' })).toBeVisible();
  });

  test('Adverse Session Lifecycle: delegate losing role clears management controls on refresh', async ({ page }) => {
    let isDelegate = true;

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'u-1', username: 'test_user', email: 't@test.com', first_name: 'Test', family_name: 'User' },
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-1', status: 'ACTIVE', role: isDelegate ? 'DELEGATE' : 'MEMBER' },
          capabilities: {
            create_announcements: isDelegate,
            manage_document_voting: isDelegate,
            upload_official_documents: isDelegate,
          },
        },
      });
    });

    await page.goto('/');
    const mainNav = page.locator("nav[aria-label='Main Navigation']");
    // Initially delegate sees Review Applications management link
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toBeVisible();

    // Demote role in backend
    isDelegate = false;

    // Navigate to membership and trigger refresh or reload
    await page.goto('/account#community-membership');

    // Management link must now be removed
    await expect(mainNav.getByRole('link', { name: 'Review Applications' })).toHaveCount(0);
  });
});
