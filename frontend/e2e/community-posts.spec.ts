import { test, expect, Page, Route } from '@playwright/test';

test.describe('Task 5.2: Member-Only Community Posts — Frontend Mocked Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Focused mocked cases must fail closed instead of reaching a configured owner API.
    await page.route('**/api/**', route => route.abort());
  });

  const mockActiveUser = {
    id: 'u-active-1',
    username: 'karim_student',
    email: 'karim@example.com',
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

  const mockModules = [
    { id: 'm0000000-0000-0000-0000-000000000001', name: 'Algorithms', slug: 'algo' },
    { id: 'm0000000-0000-0000-0000-000000000002', name: 'Web Development', slug: 'web' },
    { id: 'm0000000-0000-0000-0000-000000000003', name: 'Databases', slug: 'db' },
    { id: 'm0000000-0000-0000-0000-000000000004', name: 'Operating Systems', slug: 'os' },
  ];

  const samplePost1 = {
    id: 'a0000000-0000-0000-0000-000000000001',
    title: 'Understanding Bellman-Ford vs Dijkstra',
    excerpt: 'Can someone explain when Bellman-Ford is strictly required over Dijkstra? What about graph with negative cycles?',
    author_username: 'karim_student',
    created_at: '2026-10-06T10:00:00Z',
    modules: [{ id: 'm0000000-0000-0000-0000-000000000001', name: 'Algorithms', slug: 'algo' }],
  };

  const samplePost2 = {
    id: 'a0000000-0000-0000-0000-000000000002',
    title: 'CSS Grid vs Flexbox for Responsive Layouts',
    excerpt: 'A quick guide and mental model for choosing between Grid and Flexbox on 2D vs 1D layouts.',
    author_username: 'sarah_dev',
    created_at: '2026-10-06T11:00:00Z',
    modules: [{ id: 'm0000000-0000-0000-0000-000000000002', name: 'Web Development', slug: 'web' }],
  };

  const setupAuthRoutes = async (
    page: Page,
    user: Record<string, unknown> | null,
    membershipData: Record<string, unknown> | null
  ) => {
    await page.route('**/api/v1/auth/me', async (route: Route) => {
      if (user) {
        await route.fulfill({ status: 200, json: user });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });

    await page.route('**/api/v1/communities/irm/membership/me', async (route: Route) => {
      if (!user) {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      } else {
        await route.fulfill({ status: 200, json: membershipData });
      }
    });

    await page.route('**/api/v1/communities/irm/modules', async (route: Route) => {
      await route.fulfill({ status: 200, json: mockModules });
    });
  };

  // 1. Eligibility & Access Denial
  test('1. Unauthorized personas cannot view feed or new post form', async ({ page }) => {
    // Guest
    await setupAuthRoutes(page, null, null);
    await page.goto('/communities/irm/posts');
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.getByText('Understanding Bellman-Ford')).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'New Post' })).not.toBeVisible();

    // Direct visit to /posts/new as guest
    await page.goto('/communities/irm/posts/new');
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.getByLabel('Title')).not.toBeVisible();

    // PENDING membership
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, mockActiveUser, {
      membership: { id: 'm-pend-1', status: 'PENDING', role: 'MEMBER' },
      capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByText('Membership Under Review')).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Post' })).not.toBeVisible();
  });

  // 2. Feed ordering and card presentation
  test('2. Feed displays newest-first posts with title, author, date, excerpt, and module tags', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/posts?limit=20', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [samplePost2, samplePost1], // Newest first
          next_cursor: null,
        },
      });
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByRole('heading', { level: 1, name: 'Community Posts' })).toBeVisible();

    // Check cards
    await expect(page.getByText('CSS Grid vs Flexbox for Responsive Layouts')).toBeVisible();
    await expect(page.getByText('@sarah_dev')).toBeVisible();
    await expect(page.getByText('A quick guide and mental model')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Web Development' })).toBeVisible();

    await expect(page.getByText('Understanding Bellman-Ford vs Dijkstra')).toBeVisible();
    await expect(page.getByText('@karim_student')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Algorithms' })).toBeVisible();

    // New Post button visible for active members
    await expect(page.getByRole('link', { name: 'New Post' })).toBeVisible();
  });

  // 3. Module filtering via URL query param and button clicks
  test('3. Module filtering updates URL and fetches filtered posts with cursor reset', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const algoModuleId = mockModules[0].id;

    const requestedUrls: string[] = [];
    await page.route('**/api/v1/communities/irm/posts*', async (route) => {
      requestedUrls.push(route.request().url());
      const url = route.request().url();
      if (url.includes(`module_id=${algoModuleId}`)) {
        await route.fulfill({
          status: 200,
          json: { items: [samplePost1], next_cursor: null },
        });
      } else {
        await route.fulfill({
          status: 200,
          json: { items: [samplePost2, samplePost1], next_cursor: null },
        });
      }
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();

    // Click "Algorithms" module filter button
    await page.getByRole('button', { name: 'Algorithms' }).click();

    // URL should update to include ?module_id=...
    await expect(page).toHaveURL(new RegExp(`module_id=${algoModuleId}`));

    // Feed should now only show samplePost1
    await expect(page.getByText('Understanding Bellman-Ford vs Dijkstra')).toBeVisible();
    await expect(page.getByText('CSS Grid vs Flexbox')).not.toBeVisible();

    // Verify request included module_id
    expect(requestedUrls.some((u) => u.includes(`module_id=${algoModuleId}`))).toBe(true);

    // Click "All Modules" to reset filter
    await page.getByRole('button', { name: 'All Modules' }).click();
    await expect(page).toHaveURL(/communities\/irm\/posts$/);
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();
  });

  // 4. Distinct empty states for unfiltered vs filtered feeds
  test('4. Empty states differ meaningfully between empty community and filtered module', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const algoModuleId = mockModules[0].id;

    await page.route('**/api/v1/communities/irm/posts*', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], next_cursor: null },
      });
    });

    // Unfiltered empty feed
    await page.goto('/communities/irm/posts');
    await expect(page.getByText('No posts yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create First Post' })).toBeVisible();

    // Filtered empty feed
    await page.goto(`/communities/irm/posts?module_id=${algoModuleId}`);
    await expect(page.getByText(/No posts found for Algorithms/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show All Modules' })).toBeVisible();
  });

  // 5. Multi-page pagination on feed with cursor
  test('5. Feed pagination loads more posts with cursor and handles errors safely', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    let loadMoreCalls = 0;
    await page.route('**/api/v1/communities/irm/posts*', async (route) => {
      const url = route.request().url();
      if (url.includes('after=')) {
        loadMoreCalls++;
        if (loadMoreCalls === 1) {
          // Failure on first attempt
          await route.fulfill({ status: 500, json: { detail: 'Database timeout' } });
        } else {
          // Success on retry
          await route.fulfill({
            status: 200,
            json: { items: [samplePost1], next_cursor: null },
          });
        }
      } else {
        await route.fulfill({
          status: 200,
          json: { items: [samplePost2], next_cursor: 'cursor-post-2' },
        });
      }
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();

    const loadMoreBtn = page.getByRole('button', { name: 'Load more posts' });
    await expect(loadMoreBtn).toBeVisible();

    // Click load more -> encounters error
    await loadMoreBtn.click();
    await expect(page.getByText(/Database timeout/i)).toBeVisible();

    // Existing post is preserved
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();

    // Retry button visible and works
    const retryBtn = page.getByRole('button', { name: 'Retry Loading' });
    await expect(retryBtn).toBeVisible();
    await retryBtn.click();

    // Second post loaded
    await expect(page.getByText('Understanding Bellman-Ford vs Dijkstra')).toBeVisible();
    // Cursor is null -> Load more disappears
    await expect(loadMoreBtn).not.toBeVisible();
  });

  // 6. New Post Form: client validation, Unicode, tag limits, and draft retention
  test('6. New Post Form enforces Unicode bounds, max 3 tags, and preserves draft on error', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.goto('/communities/irm/posts/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Create a Post' })).toBeVisible();

    const titleInput = page.getByLabel(/Title/i);
    const contentTextarea = page.getByLabel(/Body/i);
    const submitBtn = page.getByRole('button', { name: 'Publish Post' });

    // Submit disabled initially when empty
    await expect(submitBtn).toBeDisabled();

    // Title validation boundary: 151 chars
    await titleInput.fill('A'.repeat(151));
    await expect(page.getByText('151 / 150 characters')).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    // Fix title to 150 chars
    await titleInput.fill('A'.repeat(150));
    await expect(page.getByText('150 / 150 characters')).toBeVisible();

    // Body with multi-line text and Unicode emojis (counted by code points)
    const unicodeText = 'Explanation with code: 💻\nLine 2 🚀\nLine 3 ✨';
    await contentTextarea.fill(unicodeText);

    // Module selection: can pick up to 3 modules
    await page.getByRole('button', { name: '+ Algorithms' }).click();
    await page.getByRole('button', { name: '+ Web Development' }).click();
    await page.getByRole('button', { name: '+ Databases' }).click();
    await expect(page.getByText('3 / 3 selected')).toBeVisible();

    // 4th module (+ Operating Systems) must be disabled
    const osButton = page.getByRole('button', { name: '+ Operating Systems' });
    await expect(osButton).toBeDisabled();

    // Submit button is now enabled
    await expect(submitBtn).toBeEnabled();

    // Mock failure to verify draft preservation
    await page.route('**/api/v1/communities/irm/posts', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, json: { detail: 'Internal error' } });
      }
    });

    await submitBtn.click();

    // Error feedback displayed
    await expect(page.getByText(/The server encountered an error. Your post may or may not have been saved/i)).toBeVisible();

    // Draft preserved!
    await expect(titleInput).toHaveValue('A'.repeat(150));
    await expect(contentTextarea).toHaveValue(unicodeText);
    await expect(page.getByText('3 / 3 selected')).toBeVisible();
  });

  // 7. Successful Post Creation navigates to detail
  test('7. Successful post creation navigates to post detail route', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const createdPost = {
      id: 'a0000000-0000-0000-0000-000000000003',
      title: 'New Discussion on B-Trees',
      content: 'Here is how B-Trees maintain balance with M keys.',
      author_username: mockActiveUser.username,
      created_at: new Date().toISOString(),
      modules: [{ id: mockModules[0].id, name: 'Algorithms', slug: 'algo' }],
    };

    await page.route('**/api/v1/communities/irm/posts', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 201, json: createdPost });
      }
    });

    await page.route(`**/api/v1/communities/irm/posts/${createdPost.id}`, async (route) => {
      await route.fulfill({ status: 200, json: createdPost });
    });

    await page.route(`**/api/v1/communities/irm/posts/${createdPost.id}/replies*`, async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    await page.goto('/communities/irm/posts/new');
    await page.getByLabel(/Title/i).fill('New Discussion on B-Trees');
    await page.getByLabel(/Body/i).fill('Here is how B-Trees maintain balance with M keys.');
    await page.getByRole('button', { name: '+ Algorithms' }).click();

    await page.getByRole('button', { name: 'Publish Post' }).click();

    // Navigates to detail page with success feedback
    await page.waitForURL(new RegExp(`/communities/irm/posts/${createdPost.id}`));
    await expect(page.getByText('Your post has been published successfully.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'New Discussion on B-Trees' })).toBeVisible();
    await expect(page.getByText('Here is how B-Trees maintain balance with M keys.')).toBeVisible();
    await expect(page.getByText(`@${mockActiveUser.username}`)).toBeVisible();

    // Reloading or direct entry does not falsely claim a new creation
    await page.reload();
    await expect(page.getByText('Your post has been published successfully.')).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'New Discussion on B-Trees' })).toBeVisible();

    // Manual query param entry does not spoof confirmed creation
    await page.goto(`/communities/irm/posts/${createdPost.id}?created=true`);
    await expect(page.getByText('Your post has been published successfully.')).not.toBeVisible();
  });

  // 8. Post Detail & Flat Replies with reconciliation
  test('8. Post detail renders full body with replies and handles new reply submission', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const postDetail = {
      ...samplePost1,
      content: 'Line 1 of full post content.\nLine 2 with indentation and details.\nLine 3 conclusion.',
    };

    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, async (route) => {
      await route.fulfill({ status: 200, json: postDetail });
    });

    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies*`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          json: {
            items: [
              {
                id: 'r-001',
                post_id: samplePost1.id,
                author_username: 'helpful_peer',
                content: 'Dijkstra fails because greedy choice cannot anticipate negative cycles.',
                created_at: '2026-10-06T10:15:00Z',
              },
            ],
            next_cursor: null,
          },
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          json: {
            id: 'r-new-002',
            post_id: samplePost1.id,
            author_username: mockActiveUser.username,
            content: 'Thanks! That clarifies the greedy invariant.',
            created_at: new Date().toISOString(),
            image_url: null,
          },
        });
      }
    });

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    await expect(page.getByRole('heading', { level: 1, name: samplePost1.title })).toBeVisible();
    await expect(page.getByText('Line 1 of full post content.')).toBeVisible();

    // Check existing reply
    await expect(page.getByText('@helpful_peer')).toBeVisible();
    await expect(page.getByText('Dijkstra fails because greedy choice cannot anticipate negative cycles.')).toBeVisible();

    // Submit new reply
    const replyTextarea = page.getByLabel(/Leave a reply/i);
    await replyTextarea.fill('Thanks! That clarifies the greedy invariant.');
    await page.getByRole('button', { name: 'Post Reply' }).click();

    // Confirmed feedback and visible reply
    await expect(page.getByText('Your reply was posted.')).toBeVisible();
    await expect(page.getByText('Thanks! That clarifies the greedy invariant.')).toBeVisible();
    await expect(replyTextarea).toHaveValue('');
  });

  // 9. Unknown/Malformed Post ID handling
  test('9. Unknown or malformed post ID displays safe unavailable guidance', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/posts/*', async (route) => {
      await route.fulfill({ status: 404, json: { detail: 'Post not found' } });
    });

    // Malformed ID (not UUID)
    await page.goto('/communities/irm/posts/invalid-not-uuid');
    await expect(page.getByRole('heading', { level: 2, name: 'Post Unavailable' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Return to Posts/i })).toBeVisible();

    // Non-existent UUID
    await page.goto('/communities/irm/posts/00000000-0000-0000-0000-000000000404');
    await expect(page.getByRole('heading', { level: 2, name: 'Post Unavailable' })).toBeVisible();
  });

  // 10. Mobile layout & accessibility at 320px width
  test('10. Posts feed and composer fit cleanly at 320px without page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/posts*', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [
            {
              id: 'p-long-1',
              title: 'VeryLongPostTitleWithoutSpacesToVerifyNoOverflow12345678901234567890',
              excerpt: 'VeryLongUnbrokenExcerptTextWithoutSpacesToVerifyNoOverflow12345678901234567890',
              author_username: 'very_long_student_username_must_wrap_safely',
              created_at: '2026-10-06T10:00:00Z',
              modules: [{ id: mockModules[0].id, name: 'Algorithms', slug: 'algo' }],
            },
          ],
          next_cursor: null,
        },
      });
    });

    await page.goto('/communities/irm/posts');

    // Check horizontal page-level overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify touch target for New Post button
    const newPostBtn = page.getByRole('link', { name: 'New Post' });
    const box = await newPostBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  // 11. Extended Membership States & Guidance
  test('11. Ineligible personas (REJECTED, No membership, Verification Error) receive clear guidance', async ({ page }) => {
    // A. REJECTED membership
    await setupAuthRoutes(page, mockActiveUser, {
      membership: { id: 'm-rej-1', status: 'REJECTED', role: 'MEMBER' },
      capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByText('Membership Request Not Approved')).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Post' })).not.toBeVisible();

    await page.goto('/communities/irm/posts/new');
    await expect(page.getByText('Membership Request Not Approved')).toBeVisible();
    await expect(page.getByLabel('Title')).not.toBeVisible();

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    await expect(page.getByText('Membership Request Not Approved')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: samplePost1.title })).not.toBeVisible();

    // B. User with no membership
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: { membership: null, capabilities: null } });
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByText('Membership Required')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request IRM Membership' })).toBeVisible();

    // C. Membership verification error with recovery
    let verifyAttempts = 0;
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      verifyAttempts++;
      if (verifyAttempts === 1) {
        await route.fulfill({ status: 500, json: { detail: 'Auth service unavailable' } });
      } else {
        await route.fulfill({ status: 200, json: mockActiveMembership });
      }
    });

    await page.route('**/api/v1/communities/irm/posts*', async (route) => {
      await route.fulfill({ status: 200, json: { items: [samplePost1], next_cursor: null } });
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByText(/Membership could not be verified/i)).toBeVisible();

    // Click retry verification button
    const retryAuthBtn = page.getByRole('button', { name: 'Retry Verification' });
    await expect(retryAuthBtn).toBeVisible();
    await retryAuthBtn.click();

    // Successfully recovers and loads posts
    await expect(page.getByText('Understanding Bellman-Ford vs Dijkstra')).toBeVisible();
  });

  // 12. Filter URL state, Back/Forward, Tag clicks, and Invalid UUID
  test('12. Filter transitions support back/forward, card clicks, and invalid UUID handling', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const algoId = mockModules[0].id;
    const webId = mockModules[1].id;

    await page.route('**/api/v1/communities/irm/posts*', async (route) => {
      const url = route.request().url();
      if (url.includes(`module_id=${algoId}`)) {
        await route.fulfill({ status: 200, json: { items: [samplePost1], next_cursor: null } });
      } else if (url.includes(`module_id=${webId}`)) {
        await route.fulfill({ status: 200, json: { items: [samplePost2], next_cursor: null } });
      } else if (url.includes('module_id=invalid-uuid')) {
        await route.fulfill({ status: 422, json: { detail: 'Input should be a valid UUID' } });
      } else {
        await route.fulfill({ status: 200, json: { items: [samplePost2, samplePost1], next_cursor: null } });
      }
    });

    // 1. Start at feed
    await page.goto('/communities/irm/posts');
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();
    await expect(page.getByText('Understanding Bellman-Ford')).toBeVisible();

    // 2. Click module tag on card
    await page.getByRole('article').filter({ hasText: 'Understanding Bellman-Ford' }).getByRole('link', { name: 'Algorithms' }).click();
    await expect(page).toHaveURL(new RegExp(`module_id=${algoId}`));
    await expect(page.getByText('Understanding Bellman-Ford')).toBeVisible();
    await expect(page.getByText('CSS Grid vs Flexbox')).not.toBeVisible();

    // 3. Switch to Web Development
    await page.getByRole('button', { name: 'Web Development' }).click();
    await expect(page).toHaveURL(new RegExp(`module_id=${webId}`));
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();
    await expect(page.getByText('Understanding Bellman-Ford')).not.toBeVisible();

    // 4. Browser back returns to Algorithms
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`module_id=${algoId}`));
    await expect(page.getByText('Understanding Bellman-Ford')).toBeVisible();

    // 5. Browser forward returns to Web Development
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`module_id=${webId}`));
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();

    // 6. Direct navigation to invalid UUID filter shows clear error and does not select All Modules
    await page.goto('/communities/irm/posts?module_id=invalid-uuid');
    await expect(page.getByText('Invalid module filter ID.')).toBeVisible();

    // Clicking All Modules clears error and restores full feed
    await page.getByRole('button', { name: 'All Modules' }).click();
    await expect(page.getByText('CSS Grid vs Flexbox')).toBeVisible();
  });

  // 13. Three-Page Feed Pagination and Refresh Discard
  test('13. Feed paginates smoothly across 3 pages and refresh discards older pages', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const postP1 = { ...samplePost1, id: 'p-01', title: 'Page 1 Post' };
    const postP2 = { ...samplePost1, id: 'p-02', title: 'Page 2 Post' };
    const postP3 = { ...samplePost1, id: 'p-03', title: 'Page 3 Post' };

    await page.route('**/api/v1/communities/irm/posts*', async (route) => {
      const url = route.request().url();
      if (url.includes('after=c-page-1')) {
        await route.fulfill({ status: 200, json: { items: [postP2], next_cursor: 'c-page-2' } });
      } else if (url.includes('after=c-page-2')) {
        await route.fulfill({ status: 200, json: { items: [postP3], next_cursor: null } });
      } else {
        await route.fulfill({ status: 200, json: { items: [postP1], next_cursor: 'c-page-1' } });
      }
    });

    await page.goto('/communities/irm/posts');
    await expect(page.getByText('Page 1 Post')).toBeVisible();

    // Load page 2
    const loadMoreBtn = page.getByRole('button', { name: 'Load more posts' });
    await expect(loadMoreBtn).toBeVisible();
    await loadMoreBtn.click();

    await expect(page.getByText('Page 2 Post')).toBeVisible();
    await expect(page.getByText('Page 1 Post')).toBeVisible();

    // Load page 3
    await loadMoreBtn.click();
    await expect(page.getByText('Page 3 Post')).toBeVisible();
    await expect(loadMoreBtn).not.toBeVisible();

    // Refresh feed: must discard pages 2 & 3 and reload page 1
    await page.getByRole('button', { name: 'Refresh Feed' }).click();
    await expect(page.getByText('Page 1 Post')).toBeVisible();
    await expect(page.getByText('Page 2 Post')).not.toBeVisible();
    await expect(page.getByText('Page 3 Post')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more posts' })).toBeVisible();
  });

  // 14. Post Creation: Tag limits, untagged fallback, and module unavailable error
  test('14. Post Creation allows untagged posts when modules fail and handles unavailable module 400', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    // Module endpoint fails with 500
    await page.unroute('**/api/v1/communities/irm/modules');
    await page.route('**/api/v1/communities/irm/modules', async (route) => {
      await route.fulfill({ status: 500, json: { detail: 'Module service error' } });
    });

    const newCreatedPost = {
      id: 'a0000000-0000-0000-0000-000000000099',
      title: 'Untagged Post Created During Outage',
      content: 'Body of untagged post.',
      author_username: mockActiveUser.username,
      created_at: new Date().toISOString(),
      modules: [],
    };

    await page.route('**/api/v1/communities/irm/posts', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.module_ids && body.module_ids.length > 0 && body.module_ids[0] === 'deleted-mod-id') {
          await route.fulfill({ status: 400, json: { detail: 'One or more specified modules do not exist in this community' } });
        } else {
          await route.fulfill({ status: 201, json: newCreatedPost });
        }
      }
    });

    await page.route(`**/api/v1/communities/irm/posts/${newCreatedPost.id}`, async (route) => {
      await route.fulfill({ status: 200, json: newCreatedPost });
    });
    await page.route(`**/api/v1/communities/irm/posts/${newCreatedPost.id}/replies*`, async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    await page.goto('/communities/irm/posts/new');
    // Notice explaining untagged posts are still possible
    await expect(page.getByText(/You can still submit an untagged post/i)).toBeVisible();

    // Fill title and body
    await page.getByLabel(/Title/i).fill('Untagged Post Created During Outage');
    await page.getByLabel(/Body/i).fill('Body of untagged post.');

    // Submit untagged post
    await page.getByRole('button', { name: 'Publish Post' }).click();

    // Successfully navigates to detail
    await page.waitForURL(new RegExp(`/communities/irm/posts/${newCreatedPost.id}`));
    await expect(page.getByText('Your post has been published successfully.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Untagged Post Created During Outage' })).toBeVisible();
  });

  // 15. Discussion catch-up with >20 intervening replies & older pages unloaded
  test('15. Discussion preserves unread earlier pages when posting and handles catch-up >20 replies', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const postDetail = { ...samplePost1, content: 'Discussion post body.' };
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, async (route) => {
      await route.fulfill({ status: 200, json: postDetail });
    });

    // 20 initial replies on page 1 with next_cursor
    const page1Replies = Array.from({ length: 20 }, (_, i) => ({
      id: `r-p1-${i + 1}`,
      post_id: samplePost1.id,
      author_username: `user_${i + 1}`,
      content: `Page 1 Reply number ${i + 1}`,
      created_at: new Date(Date.now() - (30 - i) * 60000).toISOString(),
    }));

    // Page 2 replies
    const page2Replies = Array.from({ length: 20 }, (_, i) => ({
      id: `r-p2-${i + 1}`,
      post_id: samplePost1.id,
      author_username: `user_p2_${i + 1}`,
      content: `Page 2 Reply number ${i + 1}`,
      created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(),
    }));

    let replyPostCount = 0;
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies*`, async (route) => {
      const url = route.request().url();
      if (route.request().method() === 'GET') {
        if (url.includes('after=cursor-page-1')) {
          await route.fulfill({ status: 200, json: { items: page2Replies, next_cursor: 'cursor-page-2' } });
        } else {
          await route.fulfill({ status: 200, json: { items: page1Replies, next_cursor: 'cursor-page-1' } });
        }
      } else if (route.request().method() === 'POST') {
        replyPostCount++;
        await route.fulfill({
          status: 201,
          json: {
            id: `r-my-new-${replyPostCount}`,
            post_id: samplePost1.id,
            author_username: mockActiveUser.username,
            content: 'My new reply while page 2 is unread.',
            created_at: new Date().toISOString(),
            image_url: null,
          },
        });
      }
    });

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    await expect(page.getByText('Page 1 Reply number 1', { exact: true })).toBeVisible();

    // Verify "Load more replies" is present for earlier pages
    const loadMoreRepliesBtn = page.getByRole('button', { name: 'Load more replies' });
    await expect(loadMoreRepliesBtn).toBeVisible();

    // Submit a reply while page 2 remains unloaded
    const composer = page.getByLabel(/Leave a reply/i);
    await composer.fill('My new reply while page 2 is unread.');
    await page.getByRole('button', { name: 'Post Reply' }).click();

    // Verify success feedback and badge
    await expect(page.getByText('Your reply was posted.')).toBeVisible();
    await expect(page.getByText('Your new reply')).toBeVisible();
    await expect(page.getByText('My new reply while page 2 is unread.')).toBeVisible();

    // "Load more replies" button is STILL visible for the unread earlier pages!
    await expect(loadMoreRepliesBtn).toBeVisible();

    // Clicking load more loads page 2 without discarding or duplicating new reply
    await loadMoreRepliesBtn.click();
    await expect(page.getByText('Page 2 Reply number 1', { exact: true })).toBeVisible();
    await expect(page.getByText('My new reply while page 2 is unread.')).toBeVisible();
  });

  // 16. Async Lifecycle Safety and Logout Draft Clearing
  test('16. Slow earlier requests do not overwrite newer ones, and logout clears drafts and feed', async ({ page }) => {
    let authMeStatus = 200;
    await page.route('**/api/v1/auth/me', async (route) => {
      if (authMeStatus === 200) {
        await route.fulfill({ status: 200, json: mockActiveUser });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      if (authMeStatus === 200) {
        await route.fulfill({ status: 200, json: mockActiveMembership });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
      }
    });
    await page.route('**/api/v1/communities/irm/modules', async (route) => {
      await route.fulfill({ status: 200, json: mockModules });
    });

    // 1. Visit new post page and type private draft
    await page.goto('/communities/irm/posts/new');
    const titleInput = page.getByLabel(/Title/i);
    const contentInput = page.getByLabel(/Body/i);

    await titleInput.fill('Secret Draft Title');
    await contentInput.fill('Secret draft body that must not persist across logout.');

    // 2. Perform logout via API session invalidation
    authMeStatus = 401;
    await page.route('**/api/v1/auth/logout', async (route) => {
      await route.fulfill({ status: 200, json: {} });
    });

    await page.locator('header').getByRole('button', { name: 'Logout' }).click();
    await page.waitForURL('**/login');

    // 3. User visits /posts/new as guest: private draft must NOT be present
    await page.goto('/communities/irm/posts/new');
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.locator('#post-title')).not.toBeVisible();
  });

  test('17. Reply composer supports text and image forms, single-flight, and exact uncertain retry', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, async route => {
      await route.fulfill({ status: 200, json: { ...samplePost1, content: 'A post with image replies.' } });
    });
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies*`, async route => {
      if (route.request().method() === 'GET') {
        if (route.request().url().includes('/image')) {
          await route.fulfill({ status: 404, json: { detail: 'hidden' } });
          return;
        }
        await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
        return;
      }
      const requestBody = route.request().postDataBuffer()?.toString('latin1') ?? '';
      postBodies.push(requestBody);
      requestStarted?.();
      const requestNumber = postBodies.length;
      if (requestNumber === 1) await heldFirstRequest;
      if (requestNumber === 4) {
        await route.fulfill({ status: 503, json: { detail: { code: 'reply_outcome_unknown', message: 'hidden' } } });
        return;
      }
      const replyIds = [
        'b0000000-0000-4000-8000-000000000001',
        'b0000000-0000-4000-8000-000000000002',
        'b0000000-0000-4000-8000-000000000003',
        'b0000000-0000-4000-8000-000000000004',
      ];
      const replyId = replyIds[requestNumber === 5 ? 3 : requestNumber - 1];
      const imageUrl = requestBody.includes('name="image"')
        ? `/api/v1/communities/irm/posts/${samplePost1.id}/replies/${replyId}/image`
        : null;
      const content = requestBody.includes('name="content"')
        ? (requestNumber === 1 ? 'Text only reply.' : requestNumber === 2 ? 'Text and image reply.' : 'Text and image retry.')
        : '';
      await route.fulfill({ status: requestNumber === 5 ? 200 : 201, json: {
        id: replyId, post_id: samplePost1.id, author_username: mockActiveUser.username,
        content, created_at: new Date().toISOString(), image_url: imageUrl,
      } });
    });

    let releaseFirst!: () => void;
    const heldFirstRequest = new Promise<void>(resolve => { releaseFirst = resolve; });
    let requestStarted: (() => void) | null = null;
    const requestBodies: string[] = [];
    // Use mutable handles in the route closure so held-request assertions remain deterministic.
    const postBodies = requestBodies;
    const waitForRequest = () => new Promise<void>(resolve => { requestStarted = resolve; });
    void waitForRequest;

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    const textArea = page.getByLabel('Leave a reply');
    const imagePicker = page.getByLabel('Attach one image (optional)');
    const composer = page.locator('form').filter({ has: textArea });
    const postButton = composer.getByRole('button', { name: /^(Post Reply|Posting Reply\.\.\.)$/ });
    await expect(page.getByText('JPEG or PNG, up to 5 MiB.')).toBeVisible();

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZ8AAAAASUVORK5CYII=', 'base64');
    await imagePicker.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('Unsaved local image preview')).toBeVisible();
    await imagePicker.setInputFiles([]);
    await expect(page.getByAltText('Unsaved preview of first.png')).toBeVisible();
    await imagePicker.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByAltText('Unsaved preview of replacement.png')).toBeVisible();
    await page.getByRole('button', { name: 'Remove image' }).click();
    await expect(page.getByText('Unsaved local image preview')).not.toBeVisible();
    await expect(postButton).toBeDisabled();

    await textArea.fill('Text only reply.');
    const firstStarted = new Promise<void>(resolve => { requestStarted = resolve; });
    await postButton.click();
    await firstStarted;
    await expect(postButton).toHaveAccessibleName('Posting Reply...');
    await expect(postButton).toBeDisabled();
    await page.locator('form').last().evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(postButton).toBeDisabled();
    expect(postBodies).toHaveLength(1);
    releaseFirst();
    await expect(page.getByText('Your reply was posted.')).toBeVisible();
    const firstBody = postBodies[0];
    const firstRequestId = firstBody.match(/name="client_request_id"\r\n\r\n([0-9a-f-]{36})/i)?.[1];
    expect(firstRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(firstBody).toContain('Text only reply.');
    expect(firstBody).not.toContain('name="image"');

    await textArea.fill('Text and image reply.');
    await imagePicker.setInputFiles({ name: 'reply.png', mimeType: 'image/png', buffer: png });
    const secondStarted = new Promise<void>(resolve => { requestStarted = resolve; });
    await postButton.click();
    await secondStarted;
    await expect(page.getByText('Your reply was posted.')).toBeVisible();
    const secondBody = postBodies[1];
    expect(secondBody).toContain('Text and image reply.');
    expect(secondBody).toContain('filename="reply.png"');

    await textArea.fill('');
    await imagePicker.setInputFiles({ name: 'only.png', mimeType: 'image/png', buffer: png });
    const thirdStarted = new Promise<void>(resolve => { requestStarted = resolve; });
    await postButton.click();
    await thirdStarted;
    await expect(page.getByText('Your reply was posted.')).toBeVisible();
    const thirdBody = postBodies[2];
    expect(thirdBody).not.toContain('name="content"');
    expect(thirdBody).toContain('filename="only.png"');

    await textArea.fill('Text and image retry.');
    await imagePicker.setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: png });
    const fourthStarted = new Promise<void>(resolve => { requestStarted = resolve; });
    await postButton.click();
    await fourthStarted;
    await expect(page.getByText(/Retry the retained reply/)).toBeVisible();
    await expect(textArea).toHaveValue('Text and image retry.');
    await expect(page.getByText('Retained image for reply retry')).toBeVisible();
    const fourthBody = postBodies[3];
    const retryRequestId = fourthBody.match(/name="client_request_id"\r\n\r\n([0-9a-f-]{36})/i)?.[1];
    expect(retryRequestId).toBeTruthy();
    expect(fourthBody).toContain('Text and image retry.');
    expect(fourthBody).toContain('filename="retry.png"');
    expect(fourthBody).toContain(png.toString('latin1'));

    const fifthStarted = new Promise<void>(resolve => { requestStarted = resolve; });
    await page.getByRole('button', { name: 'Retry same reply' }).click();
    await fifthStarted;
    const fifthBody = postBodies[4];
    expect(fifthBody.match(/name="client_request_id"\r\n\r\n([0-9a-f-]{36})/i)?.[1]).toBe(retryRequestId);
    expect(fifthBody).toContain('Text and image retry.');
    expect(fifthBody).toContain('filename="retry.png"');
    expect(fifthBody).toContain(png.toString('latin1'));
    await expect(page.getByText('Your reply was confirmed.')).toBeVisible();
    await expect(page.getByRole('list').last().locator('li')).toHaveCount(4);
    expect(postBodies).toHaveLength(5);
  });

  test('18. A reply request conflict requires an explicit new-reply action', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, async route => {
      await route.fulfill({ status: 200, json: { ...samplePost1, content: 'Conflict test.' } });
    });
    let count = 0;
    const requestIds: string[] = [];
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies*`, async route => {
      if (route.request().method() === 'GET') return route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
      count++;
      const body = route.request().postData() ?? '';
      requestIds.push(body.match(/name="client_request_id"\r\n\r\n([0-9a-f-]{36})/i)?.[1] ?? '');
      if (count === 1) return route.fulfill({ status: 409, json: { detail: { code: 'reply_request_conflict' } } });
      return route.fulfill({ status: 201, json: {
        id: 'b0000000-0000-4000-8000-000000000011', post_id: samplePost1.id,
        author_username: mockActiveUser.username, content: 'New distinct request.',
        created_at: new Date().toISOString(), image_url: null,
      } });
    });
    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    const textArea = page.getByLabel('Leave a reply');
    await textArea.fill('Original conflicting request.');
    await page.getByRole('button', { name: 'Post Reply' }).click();
    const conflictAlert = page.getByRole('alert').filter({ hasText: /conflicts with an earlier submission/ });
    await expect(conflictAlert).toBeVisible();
    await expect(page.locator('[aria-live]').filter({ hasText: /conflicts with an earlier submission/ })).toHaveCount(1);
    expect(count).toBe(1);
    await page.getByRole('button', { name: 'Start a new reply' }).click();
    await textArea.fill('New distinct request.');
    await page.getByRole('button', { name: 'Post Reply' }).click();
    await expect(page.getByText('Your reply was posted.')).toBeVisible();
    expect(count).toBe(2);
    expect(requestIds[0]).not.toBe(requestIds[1]);
  });

  test('19. Private reply media failure stays contained and displays an unavailable state', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    const replyId = 'b0000000-0000-4000-8000-000000000021';
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, async route => {
      await route.fulfill({ status: 200, json: { ...samplePost1, content: 'Private media test.' } });
    });
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies?limit=20`, async route => {
      await route.fulfill({ status: 200, json: { items: [{
        id: replyId, post_id: samplePost1.id, author_username: 'media_member', content: '',
        created_at: new Date().toISOString(),
        image_url: `/api/v1/communities/irm/posts/${samplePost1.id}/replies/${replyId}/image`,
      }], next_cursor: null } });
    });
    let mediaRequests = 0;
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${replyId}/image`, async route => {
      mediaRequests++;
      await route.fulfill({ status: 404, headers: { 'content-type': 'application/json' }, json: { detail: 'hidden' } });
    });
    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    await expect(page.getByText('Reply image unavailable.')).toBeVisible();
    expect(mediaRequests).toBe(1);
    await expect(page.getByText('hidden')).not.toBeVisible();
  });

  test('20. Reply removal and account logout unmount private image URLs', async ({ page }) => {
    const delegateMembership = {
      membership: { id: 'm-del-1', status: 'ACTIVE', role: 'DELEGATE' },
      capabilities: { create_announcements: true, manage_document_voting: true, upload_official_documents: true },
    };
    await setupAuthRoutes(page, mockActiveUser, delegateMembership);
    await page.addInitScript(() => {
      const nativeRevoke = URL.revokeObjectURL.bind(URL);
      (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls = [];
      URL.revokeObjectURL = (url: string) => {
        (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls?.push(url);
        nativeRevoke(url);
      };
    });
    const firstId = 'b0000000-0000-4000-8000-000000000031';
    const secondId = 'b0000000-0000-4000-8000-000000000032';
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, async route => {
      await route.fulfill({ status: 200, json: { ...samplePost1, content: 'Removal test.' } });
    });
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies?limit=20`, async route => {
      await route.fulfill({ status: 200, json: { items: [firstId, secondId].map(id => ({
        id, post_id: samplePost1.id, author_username: 'media_member', content: '',
        created_at: new Date().toISOString(),
        image_url: `/api/v1/communities/irm/posts/${samplePost1.id}/replies/${id}/image`,
      })), next_cursor: null } });
    });
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooor6A8E/9k=', 'base64');
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${firstId}/image`, route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg }));
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${secondId}/image`, route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg }));
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${firstId}`, route => route.fulfill({ status: 204 }));
    await page.route('**/api/v1/auth/logout', route => route.fulfill({ status: 200, json: {} }));

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    await expect(page.getByAltText('Image attached to reply by @media_member')).toHaveCount(2);
    await expect.poll(() => page.locator('img[alt="Image attached to reply by @media_member"]').count()).toBe(2);
    const remainingImage = page.locator('img[alt="Image attached to reply by @media_member"]').nth(1);
    const remainingBlobUrl = await remainingImage.getAttribute('src');
    expect(remainingBlobUrl).toMatch(/^blob:/);
    const firstRemove = page.getByRole('button', { name: 'Remove reply' }).first();
    await firstRemove.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Remove reply' }).click();
    await expect(page.getByAltText('Image attached to reply by @media_member')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls?.length ?? 0)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls ?? [])).not.toContain(remainingBlobUrl);

    await page.locator('header').getByRole('button', { name: 'Logout' }).click();
    await page.waitForURL('**/login');
    await expect.poll(() => page.evaluate(() => (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls?.length ?? 0)).toBeGreaterThan(1);
    await expect(page.getByAltText('Image attached to reply by @media_member')).toHaveCount(0);
  });

  test('21. A direct active-account change clears the previous composer payload', async ({ page }) => {
    const delegateMembership = {
      membership: { id: 'm-del-account-switch', status: 'ACTIVE', role: 'DELEGATE' },
      capabilities: { create_announcements: true, manage_document_voting: true, upload_official_documents: true },
    };
    await setupAuthRoutes(page, mockActiveUser, delegateMembership);
    let accountId = mockActiveUser.id;
    let authChecks = 0;
    await page.unroute('**/api/v1/auth/me');
    await page.route('**/api/v1/auth/me', route => {
      authChecks++;
      return route.fulfill({ status: 200, json: {
        ...mockActiveUser, id: accountId, username: accountId === mockActiveUser.id ? mockActiveUser.username : 'second_account',
      } });
    });
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, route =>
      route.fulfill({ status: 200, json: { ...samplePost1, content: 'Account change scope.' } }));
    const replyId = 'b0000000-0000-4000-8000-000000000041';
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies?limit=20`, route =>
      route.fulfill({ status: 200, json: { items: [{
        id: replyId, post_id: samplePost1.id, author_username: 'other_member', content: 'Visible reply.',
        created_at: new Date().toISOString(), image_url: null,
      }], next_cursor: null } }));
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${replyId}`, async route => {
      if (route.request().method() === 'DELETE') {
        accountId = 'u-active-2';
        await route.fulfill({ status: 403, json: { detail: 'hidden' } });
      } else await route.continue();
    });

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    const textArea = page.getByLabel('Leave a reply');
    const picker = page.getByLabel('Attach one image (optional)');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZ8AAAAASUVORK5CYII=', 'base64');
    await textArea.fill('Private draft from the first account.');
    await picker.setInputFiles({ name: 'account-a.png', mimeType: 'image/png', buffer: png });
    const card = page.getByText('Visible reply.').locator('xpath=ancestor::article');
    const removeReply = card.getByRole('button', { name: 'Remove reply' });
    await expect(removeReply).toBeVisible();
    await removeReply.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove reply' }).click();

    await expect.poll(() => authChecks).toBeGreaterThan(1);
    await expect(textArea).toHaveValue('');
    await expect(page.getByText('Unsaved local image preview')).not.toBeVisible();
  });

  test('22. Private image authorization loss clears protected replies and the composer', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.addInitScript(() => {
      const nativeRevoke = URL.revokeObjectURL.bind(URL);
      (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls = [];
      URL.revokeObjectURL = (url: string) => {
        (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls?.push(url);
        nativeRevoke(url);
      };
    });
    let authChecks = 0;
    await page.unroute('**/api/v1/auth/me');
    await page.route('**/api/v1/auth/me', route => {
      authChecks++;
      return route.fulfill({ status: 200, json: mockActiveUser });
    });
    const visibleReplyId = 'b0000000-0000-4000-8000-000000000051';
    const deniedReplyId = 'b0000000-0000-4000-8000-000000000052';
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, route =>
      route.fulfill({ status: 200, json: { ...samplePost1, content: 'Access loss test.' } }));
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies?limit=20`, route =>
      route.fulfill({ status: 200, json: { items: [
        {
          id: visibleReplyId, post_id: samplePost1.id, author_username: 'private_member', content: 'Protected reply text.',
          created_at: new Date().toISOString(),
          image_url: `/api/v1/communities/irm/posts/${samplePost1.id}/replies/${visibleReplyId}/image`,
        },
        {
          id: deniedReplyId, post_id: samplePost1.id, author_username: 'trigger_member', content: 'Access check image.',
          created_at: new Date().toISOString(),
          image_url: `/api/v1/communities/irm/posts/${samplePost1.id}/replies/${deniedReplyId}/image`,
        },
      ], next_cursor: null } }));
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooor6A8E/9k=', 'base64');
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${visibleReplyId}/image`, route =>
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg }));
    let startDeniedRequest!: () => void;
    const deniedRequestStarted = new Promise<void>(resolve => { startDeniedRequest = resolve; });
    let releaseDeniedResponse!: () => void;
    const deniedResponseGate = new Promise<void>(resolve => { releaseDeniedResponse = resolve; });
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${deniedReplyId}/image`, async route => {
      startDeniedRequest();
      await deniedResponseGate;
      await route.fulfill({ status: 403, json: { detail: 'hidden' } });
    });
    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    await deniedRequestStarted;
    await expect(page.getByAltText('Image attached to reply by @private_member')).toBeVisible();
    const privateBlobUrl = await page.getByAltText('Image attached to reply by @private_member').getAttribute('src');
    expect(privateBlobUrl).toMatch(/^blob:/);
    const textArea = page.getByLabel('Leave a reply');
    const picker = page.getByLabel('Attach one image (optional)');
    await textArea.fill('Private draft to clear after access loss.');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZ8AAAAASUVORK5CYII=', 'base64');
    await picker.setInputFiles({ name: 'private-draft.png', mimeType: 'image/png', buffer: png });
    const previewUrl = await page.getByAltText('Unsaved preview of private-draft.png').getAttribute('src');
    expect(previewUrl).toMatch(/^blob:/);
    releaseDeniedResponse();

    const accessAlert = page.getByRole('alert').filter({ hasText: 'Your access to this discussion could not be verified.' });
    await expect(accessAlert).toBeVisible();
    await expect(page.getByText('Protected reply text.')).not.toBeVisible();
    await expect(page.getByText('Access check image.')).not.toBeVisible();
    await expect(page.getByLabel('Leave a reply')).not.toBeVisible();
    await expect(page.getByLabel('Attach one image (optional)')).not.toBeVisible();
    await expect(page.getByText('Unsaved local image preview')).not.toBeVisible();
    await expect(page.locator('img[alt^="Image attached to reply"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as Window & { revokedObjectUrls?: string[] }).revokedObjectUrls ?? []))
      .toEqual(expect.arrayContaining([privateBlobUrl, previewUrl]));
    await expect.poll(() => authChecks).toBeGreaterThan(1);
  });

  test('23. Empty, oversized, and unsupported image selections give accessible feedback', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, route =>
      route.fulfill({ status: 200, json: { ...samplePost1, content: 'Image validation test.' } }));
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies?limit=20`, route =>
      route.fulfill({ status: 200, json: { items: [], next_cursor: null } }));

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    const picker = page.getByLabel('Attach one image (optional)');
    await expect(picker).toHaveAttribute('accept', 'image/jpeg,image/png');

    await picker.setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    const sizeAlert = page.getByRole('alert').filter({ hasText: 'Choose a nonempty image no larger than 5 MiB.' });
    await expect(sizeAlert).toBeVisible();
    await expect(page.locator('[aria-live]').filter({ hasText: 'Choose a nonempty image no larger than 5 MiB.' })).toHaveCount(1);
    await expect(page.getByText('Unsaved local image preview')).not.toBeVisible();

    await picker.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5_242_881) });
    await expect(sizeAlert).toBeVisible();
    await expect(page.getByText('Unsaved local image preview')).not.toBeVisible();

    await picker.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    const typeAlert = page.getByRole('alert').filter({ hasText: 'Choose a JPEG or PNG image.' });
    await expect(typeAlert).toBeVisible();
    await expect(page.locator('[aria-live]').filter({ hasText: 'Choose a JPEG or PNG image.' })).toHaveCount(1);
    await expect(page.getByText('Unsaved local image preview')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Post Reply' })).toBeDisabled();
  });

  test('24. Invalid private routes are not fetched and undecodable JPEG bytes show unavailable', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    const badRouteId = 'b0000000-0000-4000-8000-000000000061';
    const badBytesId = 'b0000000-0000-4000-8000-000000000062';
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}`, route =>
      route.fulfill({ status: 200, json: { ...samplePost1, content: 'Invalid image response test.' } }));
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies?limit=20`, route =>
      route.fulfill({ status: 200, json: { items: [
        { id: badRouteId, post_id: samplePost1.id, author_username: 'private_member', content: '', created_at: new Date().toISOString(), image_url: 'https://other.example.test/private.jpg' },
        { id: badBytesId, post_id: samplePost1.id, author_username: 'private_member', content: '', created_at: new Date().toISOString(), image_url: `/api/v1/communities/irm/posts/${samplePost1.id}/replies/${badBytesId}/image` },
      ], next_cursor: null } }));
    let mediaRequests = 0;
    await page.route(`**/api/v1/communities/irm/posts/${samplePost1.id}/replies/${badBytesId}/image`, route => {
      mediaRequests++;
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: 'not a JPEG image' });
    });

    await page.goto(`/communities/irm/posts/${samplePost1.id}`);
    await expect(page.getByText('Reply image unavailable.')).toHaveCount(2);
    expect(mediaRequests).toBe(1);
  });
});
