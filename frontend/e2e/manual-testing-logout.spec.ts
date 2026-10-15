import { test, expect } from '@playwright/test';

test.describe('Manual Testing Corrections — Defect 4: Header & Auth Logout State Lifecycle', () => {
  const mockUser = {
    id: 'u-logout-test',
    username: 'verified_user',
    email: 'verified@example.com',
    first_name: 'Verified',
    family_name: 'User',
  };

  const mockMembership = {
    membership: { id: 'm-verified', status: 'ACTIVE', role: 'MEMBER' },
    capabilities: {
      create_announcements: false,
      manage_document_voting: false,
      upload_official_documents: false,
    },
  };

  test('1. Ordinary authenticated state displays enabled Logout button on initial load, without "Logging out..."', async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockMembership });
    });

    await page.goto('/');

    const header = page.locator('aside, header');
    await expect(header.getByText('verified_user')).toBeVisible();

    const logoutBtn = header.getByRole('button', { name: 'Logout' });
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toBeEnabled();

    // Must never show "Logging out..." on initial load
    await expect(header.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
  });

  test('2. Navigation between pages preserves enabled Logout button and never triggers "Logging out..."', async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockMembership });
    });
    await page.route('**/api/v1/communities/irm/modules', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });

    await page.goto('/');
    const header = page.locator('aside, header');
    await expect(header.getByText('verified_user')).toBeVisible();

    // Navigate to Modules
    await header.getByRole('link', { name: 'Modules' }).click();
    await page.waitForURL('**/communities/irm/modules');

    let logoutBtn = header.getByRole('button', { name: 'Logout' });
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toBeEnabled();
    await expect(header.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);

    // Navigate to Support
    await header.getByRole('link', { name: 'Support' }).click();
    await page.waitForURL('**/support');

    logoutBtn = header.getByRole('button', { name: 'Logout' });
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toBeEnabled();
    await expect(header.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
  });

  test('3. Actual Home verification retry does not cause session flicker or trigger "Logging out..."', async ({
    page,
  }) => {
    let authReads = 0;
    let membershipReads = 0;
    let release!: () => void;
    const retryResponse = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/v1/auth/me', async (route) => {
      authReads++;
      await route.fulfill({ status: 200, json: mockUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      membershipReads++;
      if (membershipReads === 1) {
        await route.fulfill({ status: 500, json: { detail: 'Membership temporarily unavailable' } });
        return;
      }
      await retryResponse;
      await route.fulfill({ status: 200, json: mockMembership });
    });

    await page.goto('/');
    const header = page.locator('aside, header');
    await expect(header.getByText('verified_user')).toBeVisible();

    // Home invokes the real AuthProvider refresh. A focus event has no listener.
    await page.locator('main').getByRole('button', { name: 'Retry Verification' }).click();
    await expect.poll(() => membershipReads).toBe(2);
    expect(authReads).toBe(2);
    await expect(header.getByText('Checking membership…', { exact: true })).toBeVisible();

    // Check that button remains enabled "Logout" throughout
    const logoutBtn = header.getByRole('button', { name: 'Logout' });
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toBeEnabled();
    await expect(header.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
    await expect(header.getByText('verified_user', { exact: true })).toBeVisible();
    release();
    await expect(header.getByText('ACTIVE MEMBER', { exact: true })).toBeVisible();
    await expect(logoutBtn).toBeEnabled();
    await expect(header.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
  });

  test('4. Failed membership lookup preserves authenticated user and enabled Logout button', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockUser });
    });
    // Membership returns 500 server error
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 500, json: { detail: 'Membership service temporarily down' } });
    });

    await page.goto('/');
    const header = page.locator('aside, header');

    // Authenticated user is still shown
    await expect(header.getByText('verified_user')).toBeVisible();
    await expect(header.getByText('Membership unavailable')).toBeVisible();

    // Logout button is enabled
    const logoutBtn = header.getByRole('button', { name: 'Logout' });
    await expect(logoutBtn).toBeVisible();
    await expect(logoutBtn).toBeEnabled();
    await expect(header.getByRole('button', { name: 'Logging out...' })).toHaveCount(0);
  });

  test('5. Explicit logout: pending state shows disabled "Logging out...", failure preserves session and provides retry, success navigates to /login', async ({
    page,
  }) => {
    let logoutCallCount = 0;
    let resolveLogoutRequest: (() => void) | null = null;

    await page.route('**/api/v1/auth/me', async (route) => {
      if (logoutCallCount > 1) {
        // Logged out
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      } else {
        await route.fulfill({ status: 200, json: mockUser });
      }
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockMembership });
    });

    await page.route('**/api/v1/auth/logout', async (route) => {
      logoutCallCount++;
      if (logoutCallCount === 1) {
        // First logout: delay and fail with 500
        await new Promise<void>((resolve) => {
          resolveLogoutRequest = resolve;
        });
        await route.fulfill({ status: 500, json: { detail: 'Database error' } });
      } else {
        // Second logout: succeed
        await route.fulfill({ status: 200, json: {} });
      }
    });

    await page.goto('/');
    const header = page.locator('aside, header');
    const logoutBtn = header.getByRole('button', { name: 'Logout' });
    await expect(logoutBtn).toBeVisible();

    // Click logout
    await logoutBtn.click();

    // While request is pending, button shows "Logging out..." and is disabled
    const loggingOutBtn = header.getByRole('button', { name: 'Logging out...' });
    await expect(loggingOutBtn).toBeVisible();
    await expect(loggingOutBtn).toBeDisabled();

    // Attempt duplicate submission while pending
    await loggingOutBtn.click({ force: true });
    expect(logoutCallCount).toBe(1); // Duplicate call prevented

    // Resolve first request with failure
    resolveLogoutRequest!();

    // On failure: error alert shown, user still visible, button reverts to enabled "Logout" for retry
    await expect(header.getByRole('alert')).toHaveText('Logout failed. Please try again.');
    await expect(header.getByText('verified_user')).toBeVisible();

    const retryBtn = header.getByRole('button', { name: 'Logout' });
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn).toBeEnabled();

    // Retry logout: now succeeds
    await retryBtn.click();
    await page.waitForURL('**/login');

    // Confirmed success: session cleared, guest links visible
    await expect(header.getByRole('link', { name: 'Log In' })).toBeVisible();
    await expect(header.getByRole('link', { name: 'Register' })).toBeVisible();
  });
});
