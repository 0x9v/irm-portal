import { test, expect } from '@playwright/test';

test.describe('Task 1.2: Page Layouts, Contextual Navigation & Responsiveness', () => {

  test('Breadcrumb hierarchy and parent links across nested routes', async ({ page }) => {
    // Mock user as delegate to access all pages
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          id: 'u-delegate',
          username: 'delegate_user',
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
          membership: { id: 'm-del', status: 'ACTIVE', role: 'DELEGATE' },
          capabilities: {
            create_announcements: true,
            manage_document_voting: true,
            upload_official_documents: true,
          },
        },
      });
    });

    // 1. Modules page
    await page.route('**/api/v1/communities/irm/modules', async (route) => {
      await route.fulfill({
        status: 200,
        json: [
          { id: 'mod-1', community_id: 'c-irm', name: 'Algèbre 1', slug: 'algebre-1', created_at: '2026-01-01', updated_at: '2026-01-01' },
        ],
      });
    });

    await page.goto('/communities/irm/modules');
    const modulesBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(modulesBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(modulesBreadcrumb.getByText('Modules')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to Home/i })).toHaveAttribute('href', '/');

    // 2. Module Detail page
    await page.route('**/api/v1/communities/irm/modules/algebre-1', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'mod-1', community_id: 'c-irm', name: 'Algèbre 1', slug: 'algebre-1', created_at: '2026-01-01', updated_at: '2026-01-01' },
      });
    });
    await page.route('**/api/v1/communities/irm/modules/algebre-1/documents', async (route) => {
      await route.fulfill({
        status: 200,
        json: [
          { id: 'doc-1', title: 'Cours Polynômes', module_id: 'mod-1', uploader_id: 'u-1', type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-01-01', updated_at: '2026-01-01' }
        ],
      });
    });

    await page.goto('/communities/irm/modules/algebre-1');
    const modDetailBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(modDetailBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(modDetailBreadcrumb.getByRole('link', { name: 'Modules' })).toHaveAttribute('href', '/communities/irm/modules');
    await expect(modDetailBreadcrumb.getByText('Algèbre 1')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to Modules/i })).toHaveAttribute('href', '/communities/irm/modules');

    // 3. Upload page
    await page.goto('/communities/irm/modules/algebre-1/upload');
    const uploadBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(uploadBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(uploadBreadcrumb.getByRole('link', { name: 'Modules' })).toHaveAttribute('href', '/communities/irm/modules');
    await expect(uploadBreadcrumb.getByRole('link', { name: 'Algèbre 1' })).toHaveAttribute('href', '/communities/irm/modules/algebre-1');
    await expect(uploadBreadcrumb.getByText('Upload')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to Algèbre 1/i })).toHaveAttribute('href', '/communities/irm/modules/algebre-1');

    // 4. Document Detail page
    await page.route('**/api/v1/communities/irm/modules/algebre-1/documents/doc-1', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'doc-1', title: 'Cours Polynômes', module_id: 'mod-1', uploader_id: 'u-1', type: 'COURSE', source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-01-01', updated_at: '2026-01-01' }
      });
    });

    await page.goto('/communities/irm/modules/algebre-1/documents/doc-1');
    const docDetailBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(docDetailBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(docDetailBreadcrumb.getByRole('link', { name: 'Modules' })).toHaveAttribute('href', '/communities/irm/modules');
    // Human-friendly module name, not slug
    await expect(docDetailBreadcrumb.getByRole('link', { name: 'Algèbre 1' })).toHaveAttribute('href', '/communities/irm/modules/algebre-1');
    await expect(docDetailBreadcrumb.getByText('Cours Polynômes')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to Algèbre 1/i })).toHaveAttribute('href', '/communities/irm/modules/algebre-1');

    // 5. Review Applications page
    await page.route('**/api/v1/communities/irm/membership/pending', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.goto('/communities/irm/membership/review');
    const reviewBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(reviewBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(reviewBreadcrumb.getByRole('link', { name: 'Membership' })).toHaveAttribute('href', '/account#community-membership');
    await expect(reviewBreadcrumb.getByText('Review Applications')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to Membership/i })).toHaveAttribute('href', '/account#community-membership');

    // 6. Staff Management page
    await page.route('**/api/v1/communities/irm/membership/active', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.goto('/communities/irm/membership/staff');
    const staffBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(staffBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(staffBreadcrumb.getByRole('link', { name: 'Membership' })).toHaveAttribute('href', '/account#community-membership');
    await expect(staffBreadcrumb.getByText('Manage Staff')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to Membership/i })).toHaveAttribute('href', '/account#community-membership');

    // 7. Voting Settings page
    await page.route('**/api/v1/communities/irm/document-voting/settings', async (route) => {
      await route.fulfill({ status: 200, json: { required_total_votes: 3 } });
    });
    await page.goto('/communities/irm/document-voting/settings');
    const votingBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(votingBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(votingBreadcrumb.getByRole('link', { name: 'Modules' })).toHaveAttribute('href', '/communities/irm/modules');
    await expect(votingBreadcrumb.getByText('Voting Settings')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Back to Modules/i })).toHaveAttribute('href', '/communities/irm/modules');

    // 8. Pending Docs page
    await page.route('**/api/v1/communities/irm/documents/pending', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.goto('/communities/irm/documents/pending');
    const pendingBreadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(pendingBreadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(pendingBreadcrumb.getByText('Pending Docs')).toHaveAttribute('aria-current', 'page');
  });

  test('No horizontal page-level overflow across representative pages at 320px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });

    // Mock authenticated delegate
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'u-1', username: 'amina_student_with_long_username', email: 'amina@example.com', first_name: 'Amina', family_name: 'El Idrissi' }
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-1', status: 'ACTIVE', role: 'DELEGATE' },
          capabilities: { create_announcements: true, manage_document_voting: true, upload_official_documents: true },
        },
      });
    });

    await page.route('**/api/v1/communities/irm/modules', async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 'm-1', name: 'Algèbre Avancée et Géométrie Algébrique Appliquée', slug: 'algebre-avancee', created_at: '2026-01-01', updated_at: '2026-01-01' }],
      });
    });

    await page.route('**/api/v1/communities/irm/modules/algebre-avancee', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'm-1', name: 'Algèbre Avancée et Géométrie Algébrique Appliquée', slug: 'algebre-avancee', created_at: '2026-01-01', updated_at: '2026-01-01' },
      });
    });

    await page.route('**/api/v1/communities/irm/modules/algebre-avancee/documents', async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 'doc-long', title: 'Examen Final Session Normale 2025/2026 Algèbre et Géométrie Différentielle avec Solutions Détaillées', type: 'EXAM', source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-01-01', updated_at: '2026-01-01' }],
      });
    });

    await page.route('**/api/v1/communities/irm/modules/algebre-avancee/documents/doc-long', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'doc-long', title: 'Examen Final Session Normale 2025/2026 Algèbre et Géométrie Différentielle avec Solutions Détaillées', type: 'EXAM', source: 'OFFICIAL', status: 'APPROVED', created_at: '2026-01-01', updated_at: '2026-01-01' },
      });
    });

    await page.route('**/api/v1/communities/irm/announcements', async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 'ann-1', title: 'Annonce très importante sur les rattrapages du semestre 3', content: 'Voici les détails concernant les dates...', author_id: 'u-1', created_at: '2026-01-01' }],
      });
    });

    await page.route('**/api/v1/communities/irm/membership/pending', async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 'p-1', status: 'PENDING', role: 'MEMBER', cne: 'R13000000000', created_at: '2026-01-01', updated_at: '2026-01-01', username: 'student_applicant_with_extra_long_identifier', first_name: 'Mohamed', family_name: 'Benjelloun' }],
      });
    });

    await page.route('**/api/v1/communities/irm/membership/active', async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 'a-1', status: 'ACTIVE', role: 'MODERATOR', created_at: '2026-01-01', updated_at: '2026-01-01', username: 'moderator_user', first_name: 'Fatima', family_name: 'Zahra' }],
      });
    });

    await page.route('**/api/v1/communities/irm/document-voting/settings', async (route) => {
      await route.fulfill({ status: 200, json: { required_total_votes: 5 } });
    });

    const routesToCheck = [
      '/',
      '/login',
      '/register',
      '/communities/irm/modules',
      '/communities/irm/modules/algebre-avancee',
      '/communities/irm/modules/algebre-avancee/upload',
      '/communities/irm/modules/algebre-avancee/documents/doc-long',
      '/communities/irm/announcements',
      '/account#community-membership',
      '/communities/irm/membership/review',
      '/communities/irm/membership/staff',
      '/communities/irm/document-voting/settings',
      '/support',
    ];

    for (const path of routesToCheck) {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');

      const isOverflowing = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(isOverflowing, `Route ${path} has horizontal overflow at 320px`).toBe(false);
    }
  });

  test('Interactive elements meet 44px touch target guidelines on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/login');
    const submitBtn = page.getByRole('button', { name: 'Log In' });
    const box = await submitBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await page.goto('/register');
    const regBtn = page.getByRole('button', { name: 'Create Account' });
    const regBox = await regBtn.boundingBox();
    expect(regBox).not.toBeNull();
    expect(regBox!.height).toBeGreaterThanOrEqual(44);
  });

  test('Review Applications: actions fit cleanly on mobile and preserve confirmation upon refresh failure', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'u-1', username: 'delegate', email: 'del@example.com', first_name: 'Imane', family_name: 'Delegate' }
      });
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-1', status: 'ACTIVE', role: 'DELEGATE' },
          capabilities: { create_announcements: true, manage_document_voting: true, upload_official_documents: true },
        },
      });
    });

    let queueFetchCount = 0;
    await page.route('**/api/v1/communities/irm/membership/pending', async (route) => {
      queueFetchCount++;
      if (queueFetchCount === 1) {
        await route.fulfill({
          status: 200,
          json: [{
            id: 'app-1',
            status: 'PENDING',
            role: 'MEMBER',
            cne: 'N123456789',
            created_at: '2026-02-01',
            updated_at: '2026-02-01',
            username: 'applicant_user',
            first_name: 'Youssef',
            family_name: 'Amrani',
          }],
        });
      } else {
        // Subsequent refresh fails to test error preservation
        await route.fulfill({ status: 500, json: { detail: 'Database error' } });
      }
    });

    await page.route('**/api/v1/communities/irm/membership/app-1/approve', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'app-1', status: 'ACTIVE', role: 'MEMBER' },
      });
    });

    await page.goto('/communities/irm/membership/review');

    // Approve button check
    const approveBtn = page.getByRole('button', { name: 'Approve' });
    await expect(approveBtn).toBeVisible();
    const btnBox = await approveBtn.boundingBox();
    expect(btnBox!.height).toBeGreaterThanOrEqual(44);

    // Perform approval
    await approveBtn.click();

    // Check success confirmation survives the failed queue refresh
    await expect(page.getByText('Application was successfully approved')).toBeVisible();
    await expect(page.getByText('The queue could not refresh; retry loading the queue')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry loading queue/i })).toBeVisible();
  });

  test('Pending Documents: vote confirmation survives subsequent queue refresh failure', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'u-1', username: 'voter', email: 'v@example.com', first_name: 'Voter', family_name: 'Member' }
      });
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

    let voteCast = false;
    await page.route('**/api/v1/communities/irm/documents/pending', async (route) => {
      if (!voteCast) {
        await route.fulfill({
          status: 200,
          json: [{
            id: 'doc-pending-1',
            title: 'TD 2 Algèbre Linéaire',
            type: 'TD',
            source: 'STUDENT',
            status: 'PENDING',
            created_at: '2026-02-01',
            module_id: 'm-1',
            module_slug: 'algebre-1',
            module_name: 'Algèbre 1',
            is_uploader: false,
            my_vote: null,
            can_vote: true,
            full_document_access: false,
          }],
        });
      } else {
        // Subsequent refresh fails
        await route.fulfill({ status: 500, json: { detail: 'Temporary server issue' } });
      }
    });

    // Mock preview image request
    await page.route('**/api/v1/documents/doc-pending-1/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
      });
    });

    await page.route('**/api/v1/documents/doc-pending-1/vote', async (route) => {
      voteCast = true;
      await route.fulfill({
        status: 200,
        json: { vote: 'YES', full_document_access: true },
      });
    });

    await page.goto('/communities/irm/documents/pending');

    // Click load preview to reveal vote buttons
    await page.getByRole('button', { name: 'Load Preview' }).click();

    // Vote buttons should appear and stack/fit
    const yesVoteBtn = page.getByRole('button', { name: /YES — relevant/i });
    await expect(yesVoteBtn).toBeVisible();
    const yesBox = await yesVoteBtn.boundingBox();
    expect(yesBox!.height).toBeGreaterThanOrEqual(44);

    // Cast vote
    await yesVoteBtn.click();

    // Confirmation must remain visible despite 500 on refresh
    await expect(page.getByText('Vote successfully recorded for "TD 2 Algèbre Linéaire"')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Original' })).toBeVisible();
    await expect(page.getByText('The queue could not refresh; retry loading the queue')).toBeVisible();
  });

  test('Loading, empty, and failed-loading states remain distinguishable', async ({ page }) => {
    // 1. Loading state & Error state with Retry on Modules
    let callCount = 0;
    await page.route('**/api/v1/communities/irm/modules', async (route) => {
      callCount++;
      if (callCount === 1) {
        await route.fulfill({ status: 503, json: { detail: 'Service unavailable' } });
      } else {
        await route.fulfill({ status: 200, json: [] }); // empty list
      }
    });

    await page.goto('/communities/irm/modules');

    // Should show error feedback with retry inside main
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    await expect(page.getByText(/Failed to load modules/i)).toBeVisible();
    const retryBtn = page.getByRole('button', { name: /Retry Loading/i });
    await expect(retryBtn).toBeVisible();

    // Click Retry, now returns empty list
    await retryBtn.click();

    // Should now show distinct empty list, not error
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('No modules found.')).toBeVisible();
  });
});
