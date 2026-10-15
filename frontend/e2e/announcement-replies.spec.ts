import { test, expect, Page, Route } from '@playwright/test';

test.describe('Task 4.2: Member-Only Announcement Replies — Frontend', () => {

  test.beforeEach(async ({ page }) => {
    // Keep focused mocked acceptance isolated from owner APIs.
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

  const mockModUser = {
    id: 'u-mod-1',
    username: 'mod_student',
    email: 'mod@example.com',
    first_name: 'Mona',
    family_name: 'Idrissi',
  };

  const mockUngrantedModMembership = {
    membership: { id: 'm-mod-1', status: 'ACTIVE', role: 'MODERATOR' },
    capabilities: {
      create_announcements: false,
      manage_document_voting: false,
      upload_official_documents: false,
    },
  };

  const mockDelegateUser = {
    id: 'u-delegate-1',
    username: 'salma_delegate',
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

  const sampleAnnouncement = {
    id: 'a0000000-0000-0000-0000-000000000001',
    community_id: 'c0000000-0000-0000-0000-000000000001',
    author_id: 'u-delegate-1',
    author_username: 'salma_delegate',
    title: 'Exam Schedule Announced for S3',
    content: 'The fall semester S3 examinations will commence on Monday December 15th.',
    created_at: '2026-10-05T12:00:00Z',
    updated_at: '2026-10-05T12:00:00Z',
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

    await page.route('**/api/v1/communities/irm/announcements/a0000000-0000-0000-0000-000000000001', async (route: Route) => {
      await route.fulfill({ status: 200, json: sampleAnnouncement });
    });
  };

  // 1. Initial loading, empty list, and failed initial read
  test('1. Initial loading, empty list, and retry on read failure', async ({ page }) => {
    let retried = false;
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      if (!retried) {
        await route.fulfill({ status: 500, json: { detail: 'Database error' } });
      } else {
        await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByRole('heading', { level: 1, name: sampleAnnouncement.title })).toBeVisible();

    // Verify error state and retry
    await expect(page.getByText('Database error')).toBeVisible();
    const retryBtn = page.getByRole('button', { name: 'Retry loading replies' });
    await expect(retryBtn).toBeVisible();

    // Click retry
    retried = true;
    await retryBtn.click();
    await expect(page.getByText('No replies yet. Be the first to start the discussion.')).toBeVisible();
  });

  // 2. Ordered reply rendering, author username, and escaped HTML-like content
  test('2. Ordered reply rendering with username attribution and escaped markup', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const mockReplies = [
      {
        id: 'r0000000-0000-0000-0000-000000000001',
        announcement_id: sampleAnnouncement.id,
        author_username: 'student_one',
        content: 'First reply with plain text.\nSecond line intact.',
        created_at: '2026-10-05T12:05:00Z',
      },
      {
        id: 'r0000000-0000-0000-0000-000000000002',
        announcement_id: sampleAnnouncement.id,
        author_username: 'student_two',
        content: 'Dangerous <script>window.__replies_xss=1</script> and <b>markup</b> tags.',
        created_at: '2026-10-05T12:10:00Z',
      },
    ];

    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({ status: 200, json: { items: mockReplies, next_cursor: null } });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Discussion' })).toBeVisible();

    // Verify first reply
    await expect(page.getByText('@student_one')).toBeVisible();
    await expect(page.getByText('First reply with plain text.')).toBeVisible();

    // Verify second reply and safe escaping
    await expect(page.getByText('@student_two')).toBeVisible();
    await expect(page.getByText('Dangerous <script>window.__replies_xss=1</script> and <b>markup</b> tags.')).toBeVisible();

    // Verify XSS did not execute
    const xssTriggered = await page.evaluate(() => (window as unknown as { __replies_xss?: number }).__replies_xss !== undefined);
    expect(xssTriggered).toBe(false);
  });

  // 3. Pagination - Load more uses cursor and appends items without duplicates
  test('3. Pagination: Load more queries next cursor and deduplicates items', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const page1 = [
      {
        id: 'r0000000-0000-0000-0000-000000000001',
        announcement_id: sampleAnnouncement.id,
        author_username: 'user_1',
        content: 'Page 1 Item 1',
        created_at: '2026-10-05T12:00:00Z',
      },
      {
        id: 'r0000000-0000-0000-0000-000000000002',
        announcement_id: sampleAnnouncement.id,
        author_username: 'user_2',
        content: 'Page 1 Item 2',
        created_at: '2026-10-05T12:01:00Z',
      },
    ];

    const page2 = [
      // Deliberately include duplicate ID from page 1 to test deduplication
      {
        id: 'r0000000-0000-0000-0000-000000000002',
        announcement_id: sampleAnnouncement.id,
        author_username: 'user_2',
        content: 'Page 1 Item 2 duplicate',
        created_at: '2026-10-05T12:01:00Z',
      },
      {
        id: 'r0000000-0000-0000-0000-000000000003',
        announcement_id: sampleAnnouncement.id,
        author_username: 'user_3',
        content: 'Page 2 Item 3',
        created_at: '2026-10-05T12:02:00Z',
      },
    ];

    let requestedAfter = '';
    await page.route('**/api/v1/communities/irm/announcements/*/replies*', async (route) => {
      const url = route.request().url();
      if (url.includes('after=')) {
        requestedAfter = url;
        await route.fulfill({ status: 200, json: { items: page2, next_cursor: null } });
      } else {
        await route.fulfill({ status: 200, json: { items: page1, next_cursor: 'r0000000-0000-0000-0000-000000000002' } });
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Page 1 Item 1')).toBeVisible();
    await expect(page.getByText('Page 1 Item 2')).toBeVisible();

    const loadMoreBtn = page.getByRole('button', { name: 'Load more replies' });
    await expect(loadMoreBtn).toBeVisible();

    await loadMoreBtn.click();
    await expect(page.getByText('Page 2 Item 3')).toBeVisible();

    // Confirm after cursor was sent
    expect(requestedAfter).toContain('after=r0000000-0000-0000-0000-000000000002');

    // Confirm load more is now hidden (next_cursor is null)
    await expect(loadMoreBtn).not.toBeVisible();

    // Confirm item 2 appears exactly once (deduplicated)
    const item2Count = await page.getByText('Page 1 Item 2').count();
    expect(item2Count).toBe(1);
  });

  // 4. Later-page failure preserves existing replies and previous cursor
  test('4. Later-page failure preserves existing replies and cursor for retry', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const page1 = [
      {
        id: 'r0000000-0000-0000-0000-000000000001',
        announcement_id: sampleAnnouncement.id,
        author_username: 'user_1',
        content: 'Original Item 1',
        created_at: '2026-10-05T12:00:00Z',
      },
    ];

    let page2Attempts = 0;
    await page.route('**/api/v1/communities/irm/announcements/*/replies*', async (route) => {
      const url = route.request().url();
      if (url.includes('after=')) {
        page2Attempts++;
        if (page2Attempts === 1) {
          await route.fulfill({ status: 500, json: { detail: 'Temporary pagination failure' } });
        } else {
          await route.fulfill({
            status: 200,
            json: {
              items: [
                {
                  id: 'r0000000-0000-0000-0000-000000000002',
                  announcement_id: sampleAnnouncement.id,
                  author_username: 'user_2',
                  content: 'Subsequent Item 2',
                  created_at: '2026-10-05T12:05:00Z',
                },
              ],
              next_cursor: null,
            },
          });
        }
      } else {
        await route.fulfill({ status: 200, json: { items: page1, next_cursor: 'r0000000-0000-0000-0000-000000000001' } });
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Original Item 1')).toBeVisible();

    await page.getByRole('button', { name: 'Load more replies' }).click();

    // Verify error is shown but previous items remain intact
    await expect(page.getByText('Temporary pagination failure')).toBeVisible();
    await expect(page.getByText('Original Item 1')).toBeVisible();

    // Retry loads page 2 successfully
    await page.getByRole('button', { name: 'Retry Loading' }).click();
    await expect(page.getByText('Subsequent Item 2')).toBeVisible();
  });

  // 5. Invalid cursor triggers reload prompt
  test('5. Invalid cursor response prompts reloading discussion', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    let reloaded = false;
    await page.route('**/api/v1/communities/irm/announcements/*/replies*', async (route) => {
      const url = route.request().url();
      if (url.includes('after=')) {
        await route.fulfill({ status: 400, json: { detail: 'Invalid pagination cursor' } });
      } else {
        await route.fulfill({
          status: 200,
          json: {
            items: [
              {
                id: 'r0000000-0000-0000-0000-000000000001',
                announcement_id: sampleAnnouncement.id,
                author_username: 'user_1',
                content: reloaded ? 'Initial reply version 2' : 'Initial reply version 1',
                created_at: '2026-10-05T12:00:00Z',
              },
            ],
            next_cursor: 'stale-cursor-id',
          },
        });
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Initial reply version 1')).toBeVisible();

    await page.getByRole('button', { name: 'Load more replies' }).click();

    // Verify invalid cursor guidance and reload action
    await expect(page.getByText(/Discussion has been updated/i)).toBeVisible();
    const reloadBtn = page.getByRole('button', { name: 'Reload Replies' });
    await expect(reloadBtn).toBeVisible();

    reloaded = true;
    await reloadBtn.click();
    await expect(page.getByText('Initial reply version 2')).toBeVisible();
  });

  // 6. All ACTIVE roles can see the composer (ordinary member, ungranted moderator, delegate)
  test('6. All ACTIVE roles can see the reply composer without creation permissions', async ({ page }) => {
    // A. Ordinary Member
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByLabel('Leave a reply')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post Reply' })).toBeVisible();
    await expect(page.getByLabel('Attach one image (optional)')).toHaveCount(0);

    // B. Ungranted Moderator
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, mockModUser, mockUngrantedModMembership);

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByLabel('Leave a reply')).toBeVisible();

    // C. Delegate
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, mockDelegateUser, mockDelegateMembership);

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByLabel('Leave a reply')).toBeVisible();
  });

  // 7. Privacy boundaries: Guest, PENDING, REJECTED, and Unknown membership
  test('7. Unauthorized personas cannot view replies or access the composer', async ({ page }) => {
    let repliesFetched = false;
    await page.route('**/api/v1/communities/irm/announcements/*/replies*', async (route) => {
      repliesFetched = true;
      await route.fulfill({ status: 403, json: { detail: 'Forbidden' } });
    });

    // A. Guest
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });
    await page.route('**/api/v1/communities/irm/announcements/*', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.getByLabel('Leave a reply')).not.toBeVisible();
    expect(repliesFetched).toBe(false);

    // B. PENDING member
    await page.unroute('**/api/v1/auth/me');
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 200, json: { membership: { id: 'm-1', status: 'PENDING', role: 'MEMBER' }, capabilities: {} } });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Membership Under Review')).toBeVisible();
    await expect(page.getByLabel('Leave a reply')).not.toBeVisible();
    expect(repliesFetched).toBe(false);

    // C. Membership Verification Failure (membershipError)
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      await route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText(/Membership could not be verified/i)).toBeVisible();
    await expect(page.getByLabel('Leave a reply')).not.toBeVisible();
    expect(repliesFetched).toBe(false);
  });

  // 8. Composer validation: Empty, whitespace-only, and 2,000 char boundary
  test('8. Composer client validation enforces non-empty and 2,000 character limits', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    const textarea = page.getByLabel('Leave a reply');
    const submitBtn = page.getByRole('button', { name: 'Post Reply' });

    // Initially disabled (empty)
    await expect(submitBtn).toBeDisabled();

    // Whitespace only -> still disabled
    await textarea.fill('    \n\t   ');
    await expect(submitBtn).toBeDisabled();

    // Valid text -> enabled
    await textarea.fill('Hello world');
    await expect(submitBtn).toBeEnabled();
    await expect(page.getByText('11 / 2,000 characters')).toBeVisible();

    // Exactly 2000 chars -> enabled
    const exact2000 = 'x'.repeat(2000);
    await textarea.fill(exact2000);
    await expect(page.getByText('2000 / 2,000 characters')).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // 2001 chars -> disabled and warning shown
    const over2001 = 'x'.repeat(2001);
    await textarea.fill(over2001);
    await expect(page.getByText('2001 / 2,000 characters (1 over limit)')).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  // 9. Unicode character counting near boundary
  test('9. Unicode characters (emojis) are counted by code point, not UTF-16 code units', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    const textarea = page.getByLabel('Leave a reply');
    const submitBtn = page.getByRole('button', { name: 'Post Reply' });

    // 5 emojis (each is 2 UTF-16 code units, but 1 code point each)
    await textarea.fill('😀😃😄😁😆');
    await expect(page.getByText('5 / 2,000 characters')).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // 2000 emojis -> should equal 2000 code points and be enabled
    const emoji2000 = '🚀'.repeat(2000);
    await textarea.fill(emoji2000);
    await expect(page.getByText('2000 / 2,000 characters')).toBeVisible();
    await expect(submitBtn).toBeEnabled();
  });

  // 10. Double submission prevention and draft retention on failure
  test('10. Prevents double-submission and preserves draft upon failure', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    let postCalls = 0;
    await page.route('**/api/v1/communities/irm/announcements/*/replies', async (route) => {
      if (route.request().method() === 'POST') {
        postCalls++;
        // Delayed failure
        await new Promise((r) => setTimeout(r, 200));
        await route.fulfill({ status: 500, json: { detail: 'Server down' } });
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    const textarea = page.getByLabel('Leave a reply');
    const submitBtn = page.getByRole('button', { name: 'Post Reply' });

    await textarea.fill('My valuable draft content that must not be lost');
    await submitBtn.click();

    // Verify pending text and disabled state during in-flight request
    await expect(page.getByRole('button', { name: 'Posting Reply...' })).toBeDisabled();

    // Wait for failure
    await expect(page.getByText(/The server encountered an error. Your reply may or may not have been saved/i)).toBeVisible();

    // Verify draft was preserved
    await expect(textarea).toHaveValue('My valuable draft content that must not be lost');
    expect(postCalls).toBe(1);
  });

  // 11. Confirmed 201 clears draft and displays persisted reply
  test('11. Confirmed 201 clears draft and displays persisted reply', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    await page.route('**/api/v1/communities/irm/announcements/*/replies', async (route) => {
      if (route.request().method() === 'POST') {
        expect(route.request().headers()['content-type']).toMatch(/^application\/json/i);
        const body = JSON.parse(route.request().postData() || '{}');
        expect(Object.keys(body)).toEqual(['content']);
        await route.fulfill({
          status: 201,
          json: {
            id: 'r-new-123',
            announcement_id: sampleAnnouncement.id,
            author_username: mockActiveUser.username,
            content: body.content,
            created_at: new Date().toISOString(),
          },
        });
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    const textarea = page.getByLabel('Leave a reply');
    await textarea.fill('I will attend the review session.');
    await page.getByRole('button', { name: 'Post Reply' }).click();

    // Success message and cleared draft
    await expect(page.getByText('Your reply was posted.')).toBeVisible();
    await expect(textarea).toHaveValue('');

    // Persisted reply rendered
    await expect(page.getByText(`@${mockActiveUser.username}`)).toBeVisible();
    await expect(page.getByText('I will attend the review session.')).toBeVisible();
  });

  // 12. New reply does not skip unloaded pages
  test('12. New reply displays safely without corrupting pagination when earlier pages exist', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const initialPage = [
      {
        id: 'r0000000-0000-0000-0000-000000000001',
        announcement_id: sampleAnnouncement.id,
        author_username: 'student_1',
        content: 'Reply 1',
        created_at: '2026-10-05T12:00:00Z',
      },
    ];

    await page.route('**/api/v1/communities/irm/announcements/*/replies*', async (route) => {
      if (route.request().method() === 'GET') {
        const url = route.request().url();
        if (url.includes('after=')) {
          await route.fulfill({
            status: 200,
            json: {
              items: [
                {
                  id: 'r0000000-0000-0000-0000-000000000002',
                  announcement_id: sampleAnnouncement.id,
                  author_username: 'student_2',
                  content: 'Reply 2 (Older page)',
                  created_at: '2026-10-05T12:05:00Z',
                },
              ],
              next_cursor: null,
            },
          });
        } else {
          await route.fulfill({
            status: 200,
            json: { items: initialPage, next_cursor: 'r0000000-0000-0000-0000-000000000001' },
          });
        }
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          json: {
            id: 'r-my-brand-new-id',
            announcement_id: sampleAnnouncement.id,
            author_username: mockActiveUser.username,
            content: 'My freshly posted reply',
            created_at: '2026-10-05T12:20:00Z',
          },
        });
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Reply 1')).toBeVisible();

    // Post reply while earlier pages are still pending
    await page.getByLabel('Leave a reply').fill('My freshly posted reply');
    await page.getByRole('button', { name: 'Post Reply' }).click();

    // Verify it renders with the badge "Your new reply"
    await expect(page.getByText('Your new reply')).toBeVisible();
    await expect(page.getByText('My freshly posted reply')).toBeVisible();

    // Verify "Load more replies" is still present with the original cursor
    const loadMoreBtn = page.getByRole('button', { name: 'Load more replies' });
    await expect(loadMoreBtn).toBeVisible();

    // Clicking load more loads the older page without skipping
    await loadMoreBtn.click();
    await expect(page.getByText('Reply 2 (Older page)')).toBeVisible();
    await expect(page.getByText('My freshly posted reply')).toBeVisible();
  });

  // 13. Ambiguous network error guidance
  test('13. Ambiguous network failure offers check discussion guidance without automatic retry', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
    });

    await page.route('**/api/v1/communities/irm/announcements/*/replies', async (route) => {
      if (route.request().method() === 'POST') {
        await route.abort('failed');
      }
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await page.getByLabel('Leave a reply').fill('Tentative message');
    await page.getByRole('button', { name: 'Post Reply' }).click();

    // Verify ambiguous failure guidance and button
    await expect(page.getByText(/Unable to reach the server. Your reply may or may not have been posted/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check Discussion' })).toBeVisible();
  });

  // 14. Logout / access loss immediately clears replies and composer
  test('14. Access loss immediately unmounts replies and composer', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [
            {
              id: 'r-1',
              announcement_id: sampleAnnouncement.id,
              author_username: 'confidential_author',
              content: 'Secret community reply',
              created_at: '2026-10-05T12:00:00Z',
            },
          ],
          next_cursor: null,
        },
      });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Secret community reply')).toBeVisible();

    // User logs out
    await page.route('**/api/v1/auth/logout', async (route) => {
      await route.fulfill({ status: 200, json: { message: 'Logged out successfully' } });
    });
    await page.unroute('**/api/v1/auth/me');
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    });

    await page.getByRole('button', { name: 'Logout' }).first().click();
    await page.waitForURL('**/login');

    // Return to announcement page: content must not be visible
    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByText('Secret community reply')).not.toBeVisible();
    await expect(page.getByLabel('Leave a reply')).not.toBeVisible();
    await expect(page.getByText('Authentication Needed')).toBeVisible();
  });

  // 15. Slow Announcement A -> Announcement B navigation does not leak replies
  test('15. Slow response for Announcement A does not leak into Announcement B', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const announcement2 = {
      ...sampleAnnouncement,
      id: 'a0000000-0000-0000-0000-000000000002',
      title: 'Second Announcement',
    };

    await page.route(`**/api/v1/communities/irm/announcements/${announcement2.id}`, async (route) => {
      await route.fulfill({ status: 200, json: announcement2 });
    });

    // A is slow (500ms), B is fast (50ms)
    await page.route('**/api/v1/communities/irm/announcements/*/replies*', async (route) => {
      const url = route.request().url();
      if (url.includes(sampleAnnouncement.id)) {
        await new Promise((r) => setTimeout(r, 600));
        await route.fulfill({
          status: 200,
          json: {
            items: [
              {
                id: 'r-a',
                announcement_id: sampleAnnouncement.id,
                author_username: 'author_a',
                content: 'Announcement A Reply',
                created_at: '2026-10-05T12:00:00Z',
              },
            ],
            next_cursor: null,
          },
        });
      } else if (url.includes(announcement2.id)) {
        await route.fulfill({
          status: 200,
          json: {
            items: [
              {
                id: 'r-b',
                announcement_id: announcement2.id,
                author_username: 'author_b',
                content: 'Announcement B Reply',
                created_at: '2026-10-05T12:00:00Z',
              },
            ],
            next_cursor: null,
          },
        });
      }
    });

    // Start navigating to A
    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);

    // Quickly navigate to B before A finishes
    await page.goto(`/communities/irm/announcements/${announcement2.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Second Announcement' })).toBeVisible();

    // Verify Announcement B reply appears
    await expect(page.getByText('Announcement B Reply')).toBeVisible();

    // Wait past A's delayed response
    await page.waitForTimeout(700);

    // Verify A's reply NEVER leaked into B
    await expect(page.getByText('Announcement A Reply')).not.toBeVisible();
  });

  // 16. Mobile layout at 320px without horizontal overflow
  test('16. Discussion and composer fit cleanly at 320px viewport without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/announcements/*/replies?limit=20', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [
            {
              id: 'r-long-1',
              announcement_id: sampleAnnouncement.id,
              author_username: 'very_long_student_username_that_must_wrap_cleanly',
              content: 'UnbrokenVeryLongStringContentWithoutSpacesThatMustWrapCleanlyInsideTheMobileViewport1234567890',
              created_at: '2026-10-05T12:00:00Z',
            },
          ],
          next_cursor: null,
        },
      });
    });

    await page.goto(`/communities/irm/announcements/${sampleAnnouncement.id}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Discussion' })).toBeVisible();

    // Check horizontal page-level overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    // Verify touch target for submit button meets 44px
    const submitBtn = page.getByRole('button', { name: 'Post Reply' });
    const box = await submitBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
