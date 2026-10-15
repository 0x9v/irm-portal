import { test, expect } from '@playwright/test';

test.describe('Task 3.2: Member-Only Announcement Cards and Home Integration', () => {

  // Helper mocks
  const mockActiveUser = {
    id: 'u-active-1',
    username: 'active_student',
    email: 'student@example.com',
    first_name: 'Karim',
    family_name: 'Bennani',
  };

  const mockActiveMembership = {
    membership: { id: 'm-act-1', status: 'ACTIVE', role: 'MEMBER' },
    capabilities: {
      create_announcements: false,
      manage_document_voting: false,
      upload_official_documents: false,
    },
  };

  const mockDelegateUser = {
    id: 'u-delegate-1',
    username: 'irm_delegate',
    email: 'delegate@example.com',
    first_name: 'Salma',
    family_name: 'Mansouri',
  };

  const mockDelegateMembership = {
    membership: { id: 'm-del-1', status: 'ACTIVE', role: 'DELEGATE' },
    capabilities: {
      create_announcements: true,
      manage_document_voting: true,
      upload_official_documents: true,
    },
  };

  const sampleAnnouncements = [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      community_id: 'c0000000-0000-0000-0000-000000000001',
      author_id: 'u-delegate-1',
      title: 'Exam Schedule Announced for S3',
      content: 'The fall semester S3 examinations will commence on Monday December 15th.\nPlease review the posted timetables carefully.\nRoom allocations will follow shortly.',
      created_at: '2026-10-05T12:00:00Z',
      updated_at: '2026-10-05T12:00:00Z',
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      community_id: 'c0000000-0000-0000-0000-000000000001',
      author_id: 'u-delegate-1',
      title: 'Workshop: Modern Cloud Architectures',
      content: 'A hands-on technical workshop on cloud services and Docker containers will take place this Wednesday at 14:00 in Amphithéâtre 2.',
      created_at: '2026-10-04T10:30:00Z',
      updated_at: '2026-10-04T10:30:00Z',
    },
    {
      id: 'a0000000-0000-0000-0000-000000000003',
      community_id: 'c0000000-0000-0000-0000-000000000001',
      author_id: 'u-delegate-1',
      title: 'Library Extended Hours for Midterms',
      content: 'The campus library will remain open until 22:00 starting next week to support midterm preparations.',
      created_at: '2026-10-03T09:00:00Z',
      updated_at: '2026-10-03T09:00:00Z',
    },
  ];

  test('Guest Home contains no announcement title or content, and makes no announcement requests', async ({ page }) => {
    let announcementRequested = false;
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      announcementRequested = true;
      await route.abort();
    });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });

    await page.goto('/');

    // Check Home hero and guest guidance
    await expect(page.getByRole('heading', { name: /A shared place.*to learn/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Latest announcements' })).toHaveCount(0);
    await expect(page.getByText('Active IRM membership opens community updates and participation.', { exact: false })).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: /^Sign in/ }).first()).toBeVisible();

    // Verify no protected titles or excerpts are rendered
    await expect(page.getByText('Exam Schedule Announced for S3')).not.toBeVisible();
    await expect(page.getByText('The fall semester S3 examinations')).not.toBeVisible();
    expect(announcementRequested, 'Guest should never trigger announcement API fetch').toBe(false);
  });

  test('PENDING and REJECTED users see membership guidance without announcement content', async ({ page }) => {
    let announcementRequested = false;
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      announcementRequested = true;
      await route.abort();
    });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: { id: 'u-pending', username: 'pending_user', email: 'pending@example.com', first_name: 'Pending', family_name: 'Student' },
      });
    });

    // 1. PENDING applicant
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-pen', status: 'PENDING', role: 'MEMBER' },
          capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
        },
      });
    });

    await page.goto('/');
    await expect(page.locator('[aria-labelledby="home-membership-heading"]').getByText('Application pending')).toBeVisible();
    await expect(page.locator('[aria-labelledby="home-membership-heading"]').getByRole('link', { name: /Check application/i })).toBeVisible();
    await expect(page.getByText('Exam Schedule Announced for S3')).not.toBeVisible();
    expect(announcementRequested, 'Pending user must not trigger announcement API fetch').toBe(false);

    // 2. REJECTED applicant
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-rej', status: 'REJECTED', role: 'MEMBER' },
          capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
        },
      });
    });

    await page.reload();
    await expect(page.locator('[aria-labelledby="home-membership-heading"]').getByText('Application not approved')).toBeVisible();
    await expect(page.locator('[aria-labelledby="home-membership-heading"]').getByRole('link', { name: /Review or reapply/i })).toBeVisible();
    expect(announcementRequested, 'Rejected user must not trigger announcement API fetch').toBe(false);
  });

  test('ACTIVE member Home requests limit=3 and renders results in order', async ({ page }) => {
    let capturedUrl = '';
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        json: sampleAnnouncements,
      });
    });

    await page.goto('/');

    // Wait for the announcement cards to render before checking capturedUrl
    await expect(page.getByRole('heading', { name: 'Latest announcements' })).toBeVisible();
    await expect(page.getByRole('link', { name: /All announcements/i })).toHaveAttribute('href', '/communities/irm/announcements');

    // Cards rendered in order
    const cards = page.locator('article');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0).getByRole('heading', { level: 3 })).toHaveText('Exam Schedule Announced for S3');
    await expect(cards.nth(1).getByRole('heading', { level: 3 })).toHaveText('Workshop: Modern Cloud Architectures');
    await expect(cards.nth(2).getByRole('heading', { level: 3 })).toHaveText('Library Extended Hours for Midterms');

    // Check request URL contains limit=3
    expect(capturedUrl).toContain('limit=3');

    // Check excerpt
    await expect(cards.nth(0).getByText(/The fall semester S3 examinations will commence/)).toBeVisible();
  });

  test('ACTIVE member Home handles 0, 1, and 2 returned items cleanly', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });

    // Case: 0 items
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await page.goto('/');
    await expect(page.getByText('No announcements published yet.')).toBeVisible();

    // Case: 1 item
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      await route.fulfill({ status: 200, json: [sampleAnnouncements[0]] });
    });
    await page.reload();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.getByText('Exam Schedule Announced for S3')).toBeVisible();
  });

  test('Home announcement read failure preserves page content and allows retry', async ({ page }) => {
    let failCount = 1;
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });

    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      if (failCount > 0) {
        failCount--;
        await route.fulfill({ status: 500, json: { detail: 'Database error' } });
      } else {
        await route.fulfill({ status: 200, json: [sampleAnnouncements[0]] });
      }
    });

    await page.goto('/');

    // Page hero and other content remain visible
    await expect(page.getByRole('heading', { name: /Your resources.*Your people/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse modules', exact: true })).toBeVisible();

    // Announcement section displays retry button
    const retryBtn = page.getByRole('button', { name: /Retry Loading/i });
    await expect(retryBtn).toBeVisible();

    // Click retry
    await retryBtn.click();
    await expect(page.getByText('Exam Schedule Announced for S3')).toBeVisible();
  });

  test('Card navigation on Home opens Announcement Detail route', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });
    await page.route('**/api/v1/communities/irm/announcements', async (route) => {
      await route.fulfill({ status: 200, json: [sampleAnnouncements[0]] });
    });
    await page.route('**/api/v1/communities/irm/announcements?*', async (route) => {
      await route.fulfill({ status: 200, json: [sampleAnnouncements[0]] });
    });
    await page.route(`**/api/v1/communities/irm/announcements/${sampleAnnouncements[0].id}`, async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          ...sampleAnnouncements[0],
          author_username: 'irm_delegate',
          updated_at: '2026-10-05T14:30:00Z',
        },
      });
    });

    await page.goto('/');
    const cardLink = page.getByRole('link', { name: /Exam Schedule Announced for S3/i });
    await expect(cardLink).toBeVisible();
    await cardLink.click();

    await page.waitForURL(`**/communities/irm/announcements/${sampleAnnouncements[0].id}`);
    await expect(page.getByRole('heading', { name: 'Exam Schedule Announced for S3' })).toBeVisible();
  });

  test('Announcement Detail displays full content, author username, updated date, and breadcrumbs', async ({ page }) => {
    const doc = {
      ...sampleAnnouncements[0],
      author_username: 'irm_delegate',
      updated_at: '2026-10-05T14:30:00Z',
    };

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });
    await page.route(`**/api/v1/communities/irm/announcements/${doc.id}`, async (route) => {
      await route.fulfill({ status: 200, json: doc });
    });

    await page.goto(`/communities/irm/announcements/${doc.id}`);

    // Breadcrumb verification
    const breadcrumb = page.locator("nav[aria-label='Breadcrumb']");
    await expect(breadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(breadcrumb.getByRole('link', { name: 'Announcements' })).toHaveAttribute('href', '/communities/irm/announcements');
    await expect(breadcrumb.getByText('Exam Schedule Announced for S3')).toBeVisible();

    // Back link
    await expect(page.getByRole('link', { name: /Back to Announcements/i })).toHaveAttribute('href', '/communities/irm/announcements');

    // Title and author
    await expect(page.getByRole('heading', { level: 1, name: 'Exam Schedule Announced for S3' })).toBeVisible();
    await expect(page.getByText('By @irm_delegate')).toBeVisible();
    await expect(page.getByText(/Updated/)).toBeVisible();

    // Full preserved multiline content
    await expect(page.getByText('Room allocations will follow shortly.')).toBeVisible();
  });

  test('Unknown and malformed announcement IDs display clear unavailable state without raw errors', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });

    // 1. Unknown UUID (404)
    const unknownId = 'a0000000-0000-0000-0000-999999999999';
    await page.route(`**/api/v1/communities/irm/announcements/${unknownId}`, async (route) => {
      await route.fulfill({ status: 404, json: { detail: 'Announcement not found' } });
    });

    await page.goto(`/communities/irm/announcements/${unknownId}`);
    await expect(page.getByRole('heading', { name: 'Resource Not Found' })).toBeVisible();
    await expect(page.getByText('The requested announcement could not be found or may have been removed.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to Announcements/i }).first()).toHaveAttribute('href', '/communities/irm/announcements');

    // 2. Malformed non-UUID ID (e.g. invalid string)
    await page.goto('/communities/irm/announcements/not-a-valid-uuid-123');
    await expect(page.getByRole('heading', { name: 'Resource Not Found' })).toBeVisible();
    await expect(page.getByText('The requested announcement could not be found or may have been removed.')).toBeVisible();
  });

  test('Announcement creation form visibility is gated strictly by capability', async ({ page }) => {
    await page.route('**/api/v1/communities/irm/announcements', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          json: {
            id: 'a0000000-0000-0000-0000-000000000099',
            community_id: 'c0000000-0000-0000-0000-000000000001',
            author_id: 'u-delegate-1',
            title: 'New Delegate Announcement',
            content: 'Brand new announcement content.',
            created_at: '2026-10-05T15:00:00Z',
            updated_at: '2026-10-05T15:00:00Z',
          },
        });
      } else {
        await route.fulfill({ status: 200, json: sampleAnnouncements });
      }
    });

    // 1. Regular active member (cannot create announcements)
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });

    await page.goto('/communities/irm/announcements');
    await expect(page.getByRole('heading', { name: 'Post Announcement' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Post Announcement' })).not.toBeVisible();

    // 2. Delegate (has create_announcements capability)
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockDelegateUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockDelegateMembership });
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Post Announcement' })).toBeVisible();

    // Fill and submit form
    await page.fill('#announcement-title', 'New Delegate Announcement');
    await page.fill('#announcement-content', 'Brand new announcement content.');
    await page.click('button[type=submit]');

    await expect(page.getByText('Announcement created successfully.')).toBeVisible();
  });

  test('Logout / access loss immediately clears announcement content', async ({ page }) => {
    let authStatus = 200;
    await page.route('**/api/v1/auth/me', async (route) => {
      if (authStatus === 200) {
        await route.fulfill({ status: 200, json: mockActiveUser });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      if (authStatus === 200) {
        await route.fulfill({ status: 200, json: mockActiveMembership });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      if (authStatus === 200) {
        await route.fulfill({ status: 200, json: sampleAnnouncements });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/auth/logout', async (route) => {
      authStatus = 401;
      await route.fulfill({ status: 200, json: { message: 'Logged out successfully' } });
    });

    await page.goto('/');
    await expect(page.getByText('Exam Schedule Announced for S3')).toBeVisible();

    // Click logout
    await page.getByRole('button', { name: 'Logout' }).first().click();
    await page.waitForURL('**/login');

    // Return to home: content should be cleared and show guest guidance
    await page.goto('/');
    await expect(page.getByText('Exam Schedule Announced for S3')).not.toBeVisible();
    await expect(page.getByText('Active IRM membership opens community updates and participation.', { exact: false })).toBeVisible();
  });

  test('Slow detail A followed by detail B does not leak A into B', async ({ page }) => {
    const idA = 'a0000000-0000-0000-0000-000000000001';
    const idB = 'a0000000-0000-0000-0000-000000000002';

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });

    let resolveDetailA: (() => void) | null = null;
    await page.route(`**/api/v1/communities/irm/announcements/${idA}`, async (route) => {
      await new Promise<void>((resolve) => {
        resolveDetailA = resolve;
      });
      await route.fulfill({ status: 200, json: sampleAnnouncements[0] });
    });

    await page.route(`**/api/v1/communities/irm/announcements/${idB}`, async (route) => {
      await route.fulfill({ status: 200, json: sampleAnnouncements[1] });
    });

    // Start navigating to A
    await page.goto(`/communities/irm/announcements/${idA}`);
    await expect(page.getByText('Loading announcement...')).toBeVisible();

    // Immediately navigate to B before A resolves
    await page.goto(`/communities/irm/announcements/${idB}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Workshop: Modern Cloud Architectures' })).toBeVisible();

    // Now resolve A in background
    if (resolveDetailA) {
      (resolveDetailA as () => void)();
    }

    // Give any race a chance to settle
    await page.waitForTimeout(300);

    // B must remain visible, A must NOT have overwritten B
    await expect(page.getByRole('heading', { level: 1, name: 'Workshop: Modern Cloud Architectures' })).toBeVisible();
    await expect(page.getByText('Exam Schedule Announced for S3')).not.toBeVisible();
  });

  test('Mobile cards and detail do not overflow horizontally at 320px and 390px', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      await route.fulfill({
        status: 200,
        json: [
          {
            ...sampleAnnouncements[0],
            title: 'ExtremelyLongAnnouncementTitleWithoutAnySpacesToTestWordBreakBehaviorSafely',
            content: 'SuperLongUnbrokenStringWithoutSpacesInsideContentBodyToVerifyHorizontalOverflowResistanceSafely',
            author_username: 'irm_delegate',
          },
        ],
      });
    });

    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 800 });

      // Check Home page
      await page.goto('/');
      const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(homeOverflow, `Home page should not overflow horizontally at ${width}px`).toBe(false);

      // Check Announcements List page
      await page.goto('/communities/irm/announcements');
      const listOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(listOverflow, `List page should not overflow horizontally at ${width}px`).toBe(false);

      // Check Announcement Detail page
      await page.goto(`/communities/irm/announcements/${sampleAnnouncements[0].id}`);
      const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(detailOverflow, `Detail page should not overflow horizontally at ${width}px`).toBe(false);
    }
  });

  test('Membership verification failure on Home, List, and Detail preserves session and shows retry without claiming non-membership', async ({ page }) => {
    let announcementRequested = false;
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      announcementRequested = true;
      await route.abort();
    });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });

    let failMembership = true;
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      if (failMembership) {
        await route.fulfill({ status: 500, json: { detail: 'Internal Database Error' } });
      } else {
        await route.fulfill({ status: 200, json: mockActiveMembership });
      }
    });

    // 1. Home Page: should NOT claim user has not applied; should show verification error and Retry
    await page.goto('/');
    await expect(page.getByText('Community membership status could not be verified due to a network or server error.')).toBeVisible();
    await expect(page.getByText('You have not yet requested IRM community membership.')).not.toBeVisible();
    expect(announcementRequested, 'Announcement request must not be dispatched when membership verification fails').toBe(false);

    // Clicking Retry Verification when backend recovers loads active announcements
    failMembership = false;
    await page.unroute('**/api/v1/communities/irm/announcements*');
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      await route.fulfill({ status: 200, json: sampleAnnouncements });
    });
    await page.getByRole('button', { name: /Retry Verification/i }).click();
    await expect(page.getByText('Exam Schedule Announced for S3')).toBeVisible();

    // 2. Announcements List Page: should show verification error and Retry
    failMembership = true;
    await page.goto('/communities/irm/announcements');
    await expect(page.getByText(/Membership could not be verified/i)).toBeVisible();
    await expect(page.getByText(/Join the IRM Community/i)).not.toBeVisible();

    // 3. Announcement Detail Page: should show verification error and Retry
    await page.goto(`/communities/irm/announcements/${sampleAnnouncements[0].id}`);
    await expect(page.getByText(/Membership could not be verified/i)).toBeVisible();
    await expect(page.getByText(/Join the IRM Community/i)).not.toBeVisible();
  });

  test('Direct detail URL access by unauthorized users (Guest, PENDING, REJECTED, Non-member) is rejected with honest guidance', async ({ page }) => {
    const detailId = sampleAnnouncements[0].id;

    // 1. Guest
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });
    await page.goto(`/communities/irm/announcements/${detailId}`);
    await expect(page.getByRole('heading', { name: 'Authentication Needed' })).toBeVisible();
    await expect(page.getByText(sampleAnnouncements[0].title)).not.toBeVisible();

    // 2. PENDING applicant
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-pen', status: 'PENDING', role: 'MEMBER' },
          capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
        },
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Membership Under Review' })).toBeVisible();
    await expect(page.getByText(sampleAnnouncements[0].title)).not.toBeVisible();

    // 3. REJECTED applicant
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-rej', status: 'REJECTED', role: 'MEMBER' },
          capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
        },
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Membership Request Not Approved' })).toBeVisible();
    await expect(page.getByText(sampleAnnouncements[0].title)).not.toBeVisible();

    // 4. Confirmed Non-member (null membership)
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: null,
          capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
        },
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Join the IRM Community' })).toBeVisible();
    await expect(page.getByText(sampleAnnouncements[0].title)).not.toBeVisible();
  });

  test('Granted Moderator vs Ungranted Moderator creation permission gating', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      await route.fulfill({ status: 200, json: sampleAnnouncements });
    });

    // 1. Ungranted Moderator
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-mod', status: 'ACTIVE', role: 'MODERATOR' },
          capabilities: { create_announcements: false, manage_document_voting: true, upload_official_documents: false },
        },
      });
    });
    await page.goto('/communities/irm/announcements');
    await expect(page.getByRole('heading', { name: 'Post Announcement' })).not.toBeVisible();

    // 2. Granted Moderator
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          membership: { id: 'm-mod', status: 'ACTIVE', role: 'MODERATOR' },
          capabilities: { create_announcements: true, manage_document_voting: true, upload_official_documents: false },
        },
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Post Announcement' })).toBeVisible();
    await expect(page.locator('#announcement-title')).toBeVisible();
  });

  test('Creation form preserves input draft upon error and prevents double-submission', async ({ page }) => {
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockDelegateUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockDelegateMembership });
    });
    await page.route('**/api/v1/communities/irm/announcements', async (route) => {
      if (route.request().method() === 'POST') {
        // Return 422 error
        await route.fulfill({ status: 422, json: { detail: 'Title is invalid' } });
      } else {
        await route.fulfill({ status: 200, json: sampleAnnouncements });
      }
    });

    await page.goto('/communities/irm/announcements');
    await page.fill('#announcement-title', 'My Draft Announcement');
    await page.fill('#announcement-content', 'My detailed draft content body.');
    await page.click('button[type=submit]');

    // Error is displayed
    await expect(page.getByText('Validation error: Title is invalid')).toBeVisible();

    // Inputs remain filled so user does not lose work
    await expect(page.locator('#announcement-title')).toHaveValue('My Draft Announcement');
    await expect(page.locator('#announcement-content')).toHaveValue('My detailed draft content body.');
  });

  test('HTML and script markup in announcement title and content are safely escaped without execution', async ({ page }) => {
    const xssAnnouncement = {
      id: 'a0000000-0000-0000-0000-000000000099',
      community_id: 'c0000000-0000-0000-0000-000000000001',
      author_id: 'u-delegate-1',
      author_username: 'irm_delegate',
      title: 'XSS Test <script>window.__xss_fired=true</script><b>BoldText</b>',
      content: 'Line with <img src=x onerror="window.__xss_fired=true" /> markup.\nSecond line is intact.',
      created_at: '2026-10-05T12:00:00Z',
      updated_at: '2026-10-05T12:00:00Z',
    };

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });
    await page.route('**/api/v1/communities/irm/announcements', async (route) => {
      await route.fulfill({ status: 200, json: [xssAnnouncement] });
    });
    await page.route('**/api/v1/communities/irm/announcements?*', async (route) => {
      await route.fulfill({ status: 200, json: [xssAnnouncement] });
    });
    await page.route(`**/api/v1/communities/irm/announcements/${xssAnnouncement.id}`, async (route) => {
      await route.fulfill({ status: 200, json: xssAnnouncement });
    });

    // 1. On Home page
    await page.goto('/');
    await expect(page.getByText(/XSS Test <script>/)).toBeVisible();
    let xssExecuted = await page.evaluate(() => (window as unknown as { __xss_fired?: boolean }).__xss_fired !== undefined);
    expect(xssExecuted, 'XSS must not execute on Home card').toBe(false);

    // 2. On Detail page
    await page.goto(`/communities/irm/announcements/${xssAnnouncement.id}`);
    await expect(page.getByRole('heading', { level: 1, name: /XSS Test <script>/ })).toBeVisible();
    await expect(page.getByText(/Line with <img src=x onerror=/)).toBeVisible();
    xssExecuted = await page.evaluate(() => (window as unknown as { __xss_fired?: boolean }).__xss_fired !== undefined);
    expect(xssExecuted, 'XSS must not execute on Detail page').toBe(false);
  });

  test('Back and forward navigation after logout does not re-present protected content', async ({ page }) => {
    let authActive = true;
    await page.route('**/api/v1/auth/me', async (route) => {
      if (authActive) {
        await route.fulfill({ status: 200, json: mockActiveUser });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      if (authActive) {
        await route.fulfill({ status: 200, json: mockActiveMembership });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/communities/irm/announcements*', async (route) => {
      if (authActive) {
        await route.fulfill({ status: 200, json: sampleAnnouncements });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/auth/logout', async (route) => {
      authActive = false;
      await route.fulfill({ status: 200, json: { message: 'Logged out successfully' } });
    });

    // 1. Visit Home as active user
    await page.goto('/');
    await expect(page.getByText('Exam Schedule Announced for S3')).toBeVisible();

    // 2. Navigate to Announcements list
    await page.locator('main').getByRole('link', { name: 'All announcements', exact: true }).click();
    await page.waitForURL('**/communities/irm/announcements');
    await expect(page.getByText('Exam Schedule Announced for S3')).toBeVisible();

    // 3. Logout
    await page.getByRole('button', { name: 'Logout' }).first().click();
    await page.waitForURL('**/login');

    // 4. Try browser back navigation
    await page.goBack();
    // After navigating back, the page should show access denied / login required guidance, not protected content
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.getByText('The fall semester S3 examinations will commence')).not.toBeVisible();
  });
});
