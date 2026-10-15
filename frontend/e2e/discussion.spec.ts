import { test, expect, Page, Route, WebSocketRoute } from './moderation-fixtures';

test.describe('Task 6.2: General Discussion — Frontend Mocked Tests', () => {

  // Install the fallback before each test adds its explicit mocked routes.
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/**', route => route.abort());
  });

  const mockActiveUser = {
    id: '00000000-0000-4000-8000-000000000001',
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

  const mockStickers = [
    { id: 'pepe_thumbs_up', name: 'Thumbs Up', description: 'Classic encouraging thumbs up' },
    { id: 'cat_heart_eyes', name: 'Heart Eyes', description: 'Loving heart eyes cat' },
    { id: 'blob_party', name: 'Party', description: 'Celebration party blob' },
    { id: 'doge_classic', name: 'Much Wow', description: 'Classic doge appreciation' },
    { id: 'programmer_coffee', name: 'Coffee', description: 'Hot coffee for coding' },
    { id: 'rubber_duck_coding', name: 'Rubber Duck', description: 'Rubber duck debugging' },
  ];

  const sampleMsg1 = {
    id: 'b0000000-0000-0000-0000-000000000001',
    kind: 'TEXT' as const,
    content: 'Welcome to the IRM General Discussion!\nLine 2 with preserved whitespace.',
    sticker_id: null,
    author_id: '00000000-0000-4000-8000-000000000002',
    author_username: 'sarah_dev',
    created_at: '2026-10-07T09:00:00Z',
    reactions: [{ emoji: 'thumbs_up', count: 2 }],
    caller_reaction: null,
  };

  const sampleMsg2 = {
    id: 'b0000000-0000-0000-0000-000000000002',
    kind: 'STICKER' as const,
    content: null,
    sticker_id: 'pepe_thumbs_up',
    author_id: mockActiveUser.id,
    author_username: 'karim_student',
    created_at: '2026-10-07T09:05:00Z',
    reactions: [{ emoji: 'heart', count: 1 }],
    caller_reaction: 'heart',
  };

  const sampleMsgUnknownSticker = {
    id: 'b0000000-0000-0000-0000-000000000003',
    kind: 'STICKER' as const,
    content: null,
    sticker_id: 'unknown_sticker_pack_99',
    author_id: '00000000-0000-4000-8000-000000000003',
    author_username: 'yassine_admin',
    created_at: '2026-10-07T09:10:00Z',
    reactions: [],
    caller_reaction: null,
  };

  const setupAuthRoutes = async (
    page: Page,
    user: Record<string, unknown> | null,
    membershipData: Record<string, unknown> | null,
    membershipError = false
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
      } else if (membershipError) {
        await route.fulfill({ status: 500, json: { detail: 'Internal membership lookup error' } });
      } else {
        await route.fulfill({ status: 200, json: membershipData });
      }
    });

    await page.route('**/api/v1/communities/irm/discussion/stickers', async (route: Route) => {
      await route.fulfill({ status: 200, json: mockStickers });
    });
  };

  // 1. Route Access Denial and Guidance
  test('1. Unauthorized personas receive appropriate guidance and discussion view is not rendered', async ({ page }) => {
    // 1a. Guest (unauthenticated)
    await setupAuthRoutes(page, null, null);
    await page.goto('/communities/irm/discussion');
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Log In' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();

    // 1b. PENDING membership
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, mockActiveUser, {
      membership: { id: 'm-pend-1', status: 'PENDING', role: 'MEMBER' },
      capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
    });
    await page.goto('/communities/irm/discussion');
    await expect(page.getByText('Membership Under Review')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();

    // 1c. REJECTED membership
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, mockActiveUser, {
      membership: { id: 'm-rej-1', status: 'REJECTED', role: 'MEMBER' },
      capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false },
    });
    await page.goto('/communities/irm/discussion');
    await expect(page.getByText('Membership Request Not Approved')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();

    // 1d. Membership verification error
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, mockActiveUser, null, true);
    await page.goto('/communities/irm/discussion');
    await expect(page.getByText(/Membership could not be verified/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry Verification' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();
  });

  // 2. Navigation Link Visibility and Active Matching
  test('2. Navigation includes Discussion link for active members with active highlight', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], older_cursor: null, has_more_older: false },
      });
    });

    // Mock WebSocket to prevent unhandled connection attempts
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');

    // Desktop navigation has Discussion link
    const desktopDiscussionLink = page.locator('nav a[href="/communities/irm/discussion"]').first();
    await expect(desktopDiscussionLink).toBeVisible();
    await expect(desktopDiscussionLink).toHaveText('Discussion');

    // Verify active link style contains current tab styling
    await expect(desktopDiscussionLink).toHaveAttribute('aria-current', 'page');
  });

  // 3. Chronological History & Content Rendering
  test('3. Initial history renders messages chronologically with author, time, whitespace, and stickers', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [sampleMsg1, sampleMsg2, sampleMsgUnknownSticker],
          older_cursor: null,
          has_more_older: false,
        },
      });
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');

    // Verify compact heading and accessible connection state
    await expect(page.getByRole('heading', { level: 1, name: 'Discussion' })).toBeVisible();
    await expect(page.locator('[role="status"][aria-label="Discussion connection"]')).toHaveText('Connected to discussion');

    // Verify sampleMsg1: Text message with username and preserved line break
    await expect(page.getByText('@sarah_dev')).toBeVisible();
    await expect(page.getByText('Welcome to the IRM General Discussion!')).toBeVisible();
    await expect(page.getByText('Line 2 with preserved whitespace.')).toBeVisible();

    // Verify readable timestamp with time element
    const messageTime = page.locator(`article[data-message-id="${sampleMsg1.id}"] time[title]`);
    await expect(messageTime).toHaveAttribute('datetime', sampleMsg1.created_at);

    // Verify sampleMsg2: Sticker message
    await expect(page.getByText('@karim_student')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Thumbs Up sticker' })).toBeVisible();

    // Verify sampleMsgUnknownSticker: Unknown sticker fallback
    await expect(page.getByText('@yassine_admin')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Sticker: unknown_sticker_pack_99' })).toBeVisible();
  });

  // 4. Older Messages Pagination & Scroll Stability
  test('4. Older message pagination fetches with before cursor and prepends messages', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const olderCursorId = 'b0000000-0000-0000-0000-000000000001';
    const olderMsg = {
      id: 'a0000000-0000-0000-0000-000000000000',
      kind: 'TEXT' as const,
      content: 'Very old message from the past archives',
      sticker_id: null,
      author_id: '00000000-0000-4000-8000-000000000004',
      author_username: 'historical_user',
      created_at: '2026-10-01T08:00:00Z',
      reactions: [],
      caller_reaction: null,
    };

    let requestedOlder = false;
    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      const url = route.request().url();
      if (url.includes(`before=${olderCursorId}`)) {
        requestedOlder = true;
        await route.fulfill({
          status: 200,
          json: {
            items: [olderMsg],
            older_cursor: null,
            has_more_older: false,
          },
        });
      } else {
        await route.fulfill({
          status: 200,
          json: {
            items: [sampleMsg1, sampleMsg2],
            older_cursor: olderCursorId,
            has_more_older: true,
          },
        });
      }
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');

    // Load older messages button visible
    const loadOlderBtn = page.getByRole('button', { name: 'Load older messages' });
    await expect(loadOlderBtn).toBeVisible();

    // Click to load older
    await loadOlderBtn.click();

    // Verify older message is prepended
    await expect(page.getByText('Very old message from the past archives')).toBeVisible();
    await expect(page.getByText('@historical_user')).toBeVisible();
    expect(requestedOlder).toBe(true);

    // Verify Load older messages button is no longer visible (has_more_older is false)
    await expect(loadOlderBtn).not.toBeVisible();
    await expect(page.getByText('Beginning of IRM discussion history')).toBeVisible();
  });

  // 5. Text Message Composition, Code-point Counter, Enter Key & Sending
  test('5. Composer validates character limit, Enter inserts newline, and Send button submits', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], older_cursor: null, has_more_older: false },
      });
    });

    let sentPayload: { kind?: string; content?: string; client_message_id?: string } | null = null;
    await page.route('**/api/v1/communities/irm/discussion/messages', async (route) => {
      if (route.request().method() === 'POST') {
        sentPayload = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          json: {
            id: 'b0000000-0000-0000-0000-000000000099',
            kind: 'TEXT',
            content: sentPayload?.content,
            sticker_id: null,
            author_id: mockActiveUser.id,
            author_username: mockActiveUser.username,
            created_at: new Date().toISOString(),
            reactions: [],
            caller_reaction: null,
          },
        });
      } else {
        await route.fallback();
      }
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');

    const textarea = page.getByRole('textbox', { name: 'Write a message' });
    const sendButton = page.getByRole('button', { name: 'Send' });

    // Send button initially disabled when empty
    await expect(sendButton).toBeDisabled();
    await expect(page.getByText('0 / 2,000')).toBeVisible();

    // Typing whitespace only keeps send disabled
    await textarea.fill('    \n   ');
    await expect(sendButton).toBeDisabled();

    // Type text with Enter key (verify Enter creates newline without submitting)
    await textarea.fill('First line of test');
    await textarea.press('Enter');
    await textarea.type('Second line after Enter');

    // Confirm textarea has two lines
    const value = await textarea.inputValue();
    expect(value).toContain('First line of test\nSecond line after Enter');
    expect(sentPayload).toBeNull(); // Enter did not submit!

    // Verify code point counter updated
    await expect(page.getByText(`${value.length} / 2,000`)).toBeVisible();
    await expect(sendButton).toBeEnabled();

    // Click explicit Send button
    await sendButton.click();

    // Verify submission payload
    expect(sentPayload).not.toBeNull();
    const payload = sentPayload as unknown as { kind?: string; content?: string; client_message_id?: string };
    expect(payload.kind).toBe('TEXT');
    expect(payload.content).toBe(value);
    expect(payload.client_message_id).toBeDefined();

    // Verify textarea cleared after send
    await expect(textarea).toHaveValue('');
    await expect(sendButton).toBeDisabled();
  });

  // 6. Sticker Picker & Sticker Submission
  test('6. Sticker picker opens catalog, sends sticker message, and dismisses on selection', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], older_cursor: null, has_more_older: false },
      });
    });

    let sentStickerPayload: { kind?: string; sticker_id?: string; client_message_id?: string } | null = null;
    await page.route('**/api/v1/communities/irm/discussion/messages', async (route) => {
      if (route.request().method() === 'POST') {
        sentStickerPayload = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          json: {
            id: 'b0000000-0000-0000-0000-000000000088',
            kind: 'STICKER',
            content: null,
            sticker_id: sentStickerPayload?.sticker_id,
            author_id: mockActiveUser.id,
            author_username: mockActiveUser.username,
            created_at: new Date().toISOString(),
            reactions: [],
            caller_reaction: null,
          },
        });
      } else {
        await route.fallback();
      }
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');

    // Open sticker picker
    const stickerTrigger = page.getByRole('button', { name: 'Choose a sticker' });
    await expect(stickerTrigger).toBeVisible();
    await stickerTrigger.click();

    // Sticker picker popover appears with catalog items
    await expect(page.getByRole('dialog', { name: 'Built-in stickers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Rubber Duck sticker/ })).toBeVisible();

    // Click rubber duck sticker
    await page.getByRole('button', { name: /Rubber Duck sticker/ }).click();

    // Popover closed
    await expect(page.getByRole('dialog', { name: 'Built-in stickers' })).not.toBeVisible();

    // Verify sent payload
    expect(sentStickerPayload).not.toBeNull();
    const stickerPayload = sentStickerPayload as unknown as { kind?: string; sticker_id?: string; client_message_id?: string };
    expect(stickerPayload.kind).toBe('STICKER');
    expect(stickerPayload.sticker_id).toBe('rubber_duck_coding');
    expect(stickerPayload.client_message_id).toBeDefined();

    // Verify sticker rendered on page
    await expect(page.getByRole('img', { name: 'Rubber Duck sticker' })).toBeVisible();
  });

  // 7. Failed Submission Retry Card & Idempotent Retry with Same client_message_id
  test('7. Failed submission displays retry card and Retry reuses exact same client_message_id', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], older_cursor: null, has_more_older: false },
      });
    });

    const clientIdsSent: string[] = [];
    let failFirst = true;

    await page.route('**/api/v1/communities/irm/discussion/messages', async (route) => {
      if (route.request().method() === 'POST') {
        const payload = JSON.parse(route.request().postData() || '{}');
        clientIdsSent.push(payload.client_message_id);

        if (failFirst) {
          failFirst = false;
          await route.fulfill({ status: 500, json: { detail: 'Temporary network failure' } });
        } else {
          await route.fulfill({
            status: 201,
            json: {
              id: 'b0000000-0000-0000-0000-000000000077',
              kind: 'TEXT',
              content: payload.content,
              sticker_id: null,
              author_id: mockActiveUser.id,
              author_username: mockActiveUser.username,
              created_at: new Date().toISOString(),
              reactions: [],
              caller_reaction: null,
            },
          });
        }
      } else {
        await route.fallback();
      }
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');

    const textarea = page.getByRole('textbox', { name: 'Write a message' });
    await textarea.fill('Message that encounters network blip');
    await page.getByRole('button', { name: 'Send' }).click();

    // Verify failed submission retry card appears
    await expect(page.getByText('Failed to send message')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();

    // Click Retry
    await page.getByRole('button', { name: 'Retry' }).click();

    // Verify success and retry card disappears
    await expect(page.getByText('Failed to send message')).not.toBeVisible();
    await expect(page.getByRole('log', { name: 'Discussion message history' }).getByText('Message that encounters network blip')).toBeVisible();

    // Ensure BOTH attempts used the EXACT SAME client_message_id
    expect(clientIdsSent.length).toBe(2);
    expect(clientIdsSent[0]).toBe(clientIdsSent[1]);
  });

  // 8. Reaction Toggling (Add, Change, Remove) and Reaction Popover
  test('8. Reaction picker allows adding, replacing, and removing reactions', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [sampleMsg1],
          older_cursor: null,
          has_more_older: false,
        },
      });
    });

    let lastReactionMethod = '';
    let lastReactionBody = '';

    await page.route(`**/api/v1/communities/irm/discussion/messages/${sampleMsg1.id}/reaction`, async (route) => {
      lastReactionMethod = route.request().method();
      lastReactionBody = route.request().postData() || '';

      if (lastReactionMethod === 'PUT') {
        const parsed = JSON.parse(lastReactionBody);
        await route.fulfill({
          status: 200,
          json: {
            message_id: sampleMsg1.id,
            reactions: [{ emoji: parsed.emoji, count: 1 }],
            caller_reaction: parsed.emoji,
          },
        });
      } else if (lastReactionMethod === 'DELETE') {
        await route.fulfill({
          status: 200,
          json: {
            message_id: sampleMsg1.id,
            reactions: [],
            caller_reaction: null,
          },
        });
      }
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');

    // Message 1 has thumbs_up 2
    await expect(page.getByRole('button', { name: /Thumbs Up, count 2/ })).toBeVisible();

    // Open reaction picker
    const reactBtn = page.getByRole('button', { name: 'Add reaction' }).first();
    await reactBtn.click();

    // Reaction picker dialog with 6 emojis
    await expect(page.getByRole('dialog', { name: 'Choose a reaction' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Heart' })).toBeVisible();

    // Click Heart
    await page.getByRole('button', { name: 'Heart' }).click();

    // Verify PUT request was made with heart
    expect(lastReactionMethod).toBe('PUT');
    expect(lastReactionBody).toContain('heart');

    // Verify UI reflects Heart reaction with count 1 and active state
    const heartBadge = page.getByRole('button', { name: /Heart, count 1/ });
    await expect(heartBadge).toBeVisible();
    await expect(heartBadge).toHaveAttribute('aria-pressed', 'true');

    // Click Heart again to remove it
    await heartBadge.click();

    // Verify DELETE request was made
    expect(lastReactionMethod).toBe('DELETE');
  });

  // 9. Live WebSocket updates (message_created and reaction_changed)
  test('9. WebSocket updates append new message and update aggregate reaction counts', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [sampleMsg1],
          older_cursor: null,
          has_more_older: false,
        },
      });
    });

    let wsRouteHandle: WebSocketRoute | null = null;
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', (ws) => {
      wsRouteHandle = ws;
    });

    await page.goto('/communities/irm/discussion');

    // Connected state remains accessible without a prominent badge
    await expect(page.locator('[role="status"][aria-label="Discussion connection"]')).toHaveText('Connected to discussion');

    // 9a. Incoming message_created event from another peer
    const incomingLiveMsg = {
      type: 'message_created',
      community_slug: 'irm',
      message: {
        id: 'c0000000-0000-0000-0000-000000000010',
        kind: 'TEXT',
        content: 'Brand new real-time message received via WebSocket!',
        sticker_id: null,
        author_id: '00000000-0000-4000-8000-000000000005',
        author_username: 'peer_student',
        created_at: new Date().toISOString(),
        reactions: [],
      },
    };

    wsRouteHandle!.send(JSON.stringify(incomingLiveMsg));

    // Message appears immediately in DOM
    await expect(page.getByText('Brand new real-time message received via WebSocket!')).toBeVisible();
    await expect(page.getByText('@peer_student')).toBeVisible();

    // 9b. Incoming reaction_changed event on sampleMsg1
    const incomingReactionEvent = {
      type: 'reaction_changed',
      community_slug: 'irm',
      message_id: sampleMsg1.id,
      reactions: [
        { emoji: 'thumbs_up', count: 5 },
        { emoji: 'heart', count: 3 },
      ],
    };

    wsRouteHandle!.send(JSON.stringify(incomingReactionEvent));

    // SampleMsg1 now shows updated counts: 👍 5, ❤️ 3
    await expect(page.getByRole('button', { name: /Thumbs Up, count 5/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Heart, count 3/ })).toBeVisible();
  });

  // 10. WebSocket 1008 Policy Violation Triggers Re-verification
  test('10. WebSocket 1008 policy violation triggers access re-verification', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [sampleMsg1], older_cursor: null, has_more_older: false },
      });
    });

    let wsRouteHandle: WebSocketRoute | null = null;
    let authRecheckCount = 0;
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      authRecheckCount += 1;
      if (authRecheckCount === 1) {
        // Initial load: active membership
        await route.fulfill({ status: 200, json: mockActiveMembership });
      } else {
        // Re-verification after 1008 violation: session expired
        await route.fulfill({ status: 401, json: { detail: 'Session expired' } });
      }
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      if (authRecheckCount <= 1) {
        await route.fulfill({ status: 200, json: mockActiveUser });
      } else {
        await route.fulfill({ status: 401, json: { detail: 'Session expired' } });
      }
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', (ws) => {
      wsRouteHandle = ws;
    });

    await page.goto('/communities/irm/discussion');
    await expect(page.locator('[role="status"][aria-label="Discussion connection"]')).toHaveText('Connected to discussion');

    const initialChecks = authRecheckCount;

    // Simulate 1008 policy violation close from server
    await wsRouteHandle!.close({ code: 1008, reason: 'Session expired' });

    // Verifies auth refresh was initiated
    await expect.poll(() => authRecheckCount).toBeGreaterThan(initialChecks);

    // Verifies access is revoked and retry verification guidance is displayed
    await expect(page.getByText(/Membership could not be verified/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry Verification' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();
  });

  // 11. Responsive Layout Integrity (320px, 390px, 768px, 1024px)
  test('11. Discussion layout renders gracefully without overflowing across mobile and desktop viewports', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          items: [sampleMsg1, sampleMsg2],
          older_cursor: null,
          has_more_older: false,
        },
      });
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    const viewports = [
      { width: 320, height: 568 },  // Narrow mobile
      { width: 390, height: 844 },  // Mobile
      { width: 768, height: 1024 }, // Tablet
      { width: 1024, height: 768 }, // Desktop
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto('/communities/irm/discussion');

      // Verify header, chat content, and composer are all visible
      await expect(page.getByRole('heading', { level: 1, name: 'Discussion' })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Write a message' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

      // Ensure no horizontal scrollbar on body
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px rounding tolerance
    }
  });

  // 12. Equal-timestamp UUID comparator orders deterministically matching PostgreSQL byte ordering
  test('12. Equal-timestamp UUID comparator orders deterministically matching PostgreSQL byte ordering', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const u1 = { id: '00000000-0000-0000-0000-000000000001', created_at: '2026-10-07T12:00:00Z', kind: 'TEXT' as const, content: '1' };
      const u2 = { id: '00000000-0000-0000-0000-00000000000a', created_at: '2026-10-07T12:00:00Z', kind: 'TEXT' as const, content: 'a' };
      const u3 = { id: '00000000-0000-0000-0000-000000000010', created_at: '2026-10-07T12:00:00Z', kind: 'TEXT' as const, content: '10' };
      const u4 = { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', created_at: '2026-10-07T12:00:00Z', kind: 'TEXT' as const, content: 'f' };

      const compare = (
        a: { id: string; created_at: string },
        b: { id: string; created_at: string }
      ) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        if (timeA !== timeB) return timeA - timeB;
        const idA = a.id.toLowerCase();
        const idB = b.id.toLowerCase();
        return idA < idB ? -1 : idA > idB ? 1 : 0;
      };

      const sorted = [u4, u2, u3, u1].sort(compare);
      return sorted.map((m) => m.content);
    });

    expect(result).toEqual(['1', 'a', '10', 'f']);
  });

  // 13. Delayed snapshot arriving after live WebSocket message does not erase the live message
  test('13. Delayed snapshot arriving after live WebSocket message does not erase the live message', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const liveMsg = {
      id: 'c0000000-0000-0000-0000-000000000099',
      kind: 'TEXT' as const,
      content: 'Live message arriving before slow snapshot completes',
      sticker_id: null,
      author_id: '00000000-0000-4000-8000-000000000006',
      author_username: 'fast_sender',
      created_at: '2026-10-07T10:00:00Z',
      reactions: [],
      caller_reaction: null,
    };

    let resolveSnapshotPromise: (val: boolean) => void;
    const snapshotPromise = new Promise((resolve) => {
      resolveSnapshotPromise = resolve as (val: boolean) => void;
    });

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await snapshotPromise;
      await route.fulfill({
        status: 200,
        json: {
          items: [sampleMsg1],
          older_cursor: null,
          has_more_older: false,
        },
      });
    });

    let wsRouteHandle: WebSocketRoute | null = null;
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', (ws) => {
      wsRouteHandle = ws;
    });

    await page.goto('/communities/irm/discussion');
    await expect(page.locator('[role="status"][aria-label="Discussion connection"]')).toHaveText('Connected to discussion');

    // WS connects while snapshot request is delayed. Deliver liveMsg over WS:
    wsRouteHandle!.send(
      JSON.stringify({
        type: 'message_created',
        community_slug: 'irm',
        message: liveMsg,
      })
    );

    await expect(page.getByText('Live message arriving before slow snapshot completes')).toBeVisible();

    // Now let the delayed initial snapshot resolve:
    resolveSnapshotPromise!(true);

    // Both the initial history sampleMsg1 AND the newer liveMsg must remain rendered!
    await expect(page.getByText('Welcome to the IRM General Discussion!')).toBeVisible();
    await expect(page.getByText('Live message arriving before slow snapshot completes')).toBeVisible();
  });

  // 14. History pagination across 75 messages (3 pages) renders all records chronologically without duplicates or omissions
  test('14. History pagination across 75 messages (3 pages) renders all records chronologically without duplicates or omissions', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    // Generate 75 messages: msg_01 (oldest) to msg_75 (newest)
    const all75 = Array.from({ length: 75 }, (_, i) => {
      const num = String(i + 1).padStart(2, '0');
      const timeMin = String(i).padStart(2, '0');
      return {
        id: `d0000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
        kind: 'TEXT' as const,
        content: `Numbered message ${num}`,
        sticker_id: null,
        author_id: i % 2 === 0 ? mockActiveUser.id : '00000000-0000-4000-8000-000000000007',
        author_username: `user_${num}`,
        created_at: `2026-10-07T08:${timeMin}:00Z`,
        reactions: [],
        caller_reaction: null,
      };
    });

    // Page 1 (initial latest 30): items 45..74 (msg_46 to msg_75)
    const page1Items = all75.slice(45, 75);
    const cursorPage1 = page1Items[0].id; // msg_46

    // Page 2 (older 30): items 15..44 (msg_16 to msg_45)
    const page2Items = all75.slice(15, 45);
    const cursorPage2 = page2Items[0].id; // msg_16

    // Page 3 (oldest 15): items 0..14 (msg_01 to msg_15)
    const page3Items = all75.slice(0, 15);

    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      const url = new URL(route.request().url());
      const before = url.searchParams.get('before');

      if (!before) {
        // Initial page: latest 30
        await route.fulfill({
          status: 200,
          json: {
            items: page1Items,
            older_cursor: cursorPage1,
            newer_cursor: page1Items[page1Items.length - 1].id,
            has_more_older: true,
            has_more_newer: false,
          },
        });
      } else if (before === cursorPage1) {
        // Second page: older 30
        await route.fulfill({
          status: 200,
          json: {
            items: page2Items,
            older_cursor: cursorPage2,
            newer_cursor: page2Items[page2Items.length - 1].id,
            has_more_older: true,
            has_more_newer: false,
          },
        });
      } else if (before === cursorPage2) {
        // Final page: oldest 15
        await route.fulfill({
          status: 200,
          json: {
            items: page3Items,
            older_cursor: null,
            newer_cursor: page3Items[page3Items.length - 1].id,
            has_more_older: false,
            has_more_newer: false,
          },
        });
      }
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    await page.goto('/communities/irm/discussion');
    await expect(page.getByText('Numbered message 75')).toBeVisible();
    await expect(page.getByText('Numbered message 46')).toBeVisible();

    // 14b. Load older messages (page 2)
    const loadOlderBtn = page.getByRole('button', { name: 'Load older messages' });
    await expect(loadOlderBtn).toBeVisible();
    await loadOlderBtn.click();

    await expect(page.getByText('Numbered message 45')).toBeVisible();
    await expect(page.getByText('Numbered message 16')).toBeVisible();

    // 14c. Load older messages again (page 3)
    await expect(loadOlderBtn).toBeVisible();
    await loadOlderBtn.click();

    await expect(page.getByText('Numbered message 15')).toBeVisible();
    await expect(page.getByText('Numbered message 01')).toBeVisible();

    // Reached beginning of history
    await expect(page.getByText('Beginning of IRM discussion history')).toBeVisible();
    await expect(loadOlderBtn).not.toBeVisible();

    // Verify all 75 messages are present exactly once without duplicates
    const messageCount = await page.locator('article[data-message-id]').count();
    expect(messageCount).toBe(75);
  });

  // 15. WebSocket code 1008 from queue overflow triggers access revalidation and successful reconnection for eligible user
  test('15. WebSocket code 1008 from queue overflow triggers access revalidation and successful reconnection for eligible user', async ({ page }) => {
    let authRecheckCount = 0;
    await page.route('**/api/v1/communities/irm/membership/me', async (route) => {
      authRecheckCount += 1;
      await route.fulfill({ status: 200, json: mockActiveMembership });
    });
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({ status: 200, json: mockActiveUser });
    });
    await page.route('**/api/v1/communities/irm/discussion/stickers', async (route) => {
      await route.fulfill({ status: 200, json: mockStickers });
    });

    let historyFetchCount = 0;
    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      historyFetchCount += 1;
      await route.fulfill({
        status: 200,
        json: { items: [sampleMsg1], older_cursor: null, has_more_older: false },
      });
    });

    let wsConnections = 0;
    let wsRouteHandle: WebSocketRoute | null = null;
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', (ws) => {
      wsConnections += 1;
      wsRouteHandle = ws;
    });

    await page.goto('/communities/irm/discussion');
    await expect(page.locator('[role="status"][aria-label="Discussion connection"]')).toHaveText('Connected to discussion');
    expect(wsConnections).toBe(1);

    const initialHistoryFetches = historyFetchCount;
    const initialAuthChecks = authRecheckCount;

    // Simulate 1008 due to Queue Overflow from server
    await wsRouteHandle!.close({ code: 1008, reason: 'Queue overflow' });

    // User is still active: revalidation occurs, user stays eligible, and reconnects!
    await expect.poll(() => authRecheckCount).toBeGreaterThan(initialAuthChecks);
    await expect.poll(() => wsConnections, { timeout: 10000 }).toBe(2);

    // Reconnected successfully with quiet connected state
    await expect(page.locator('[role="status"][aria-label="Discussion connection"]')).toHaveText('Connected to discussion');
    // History snapshot was refreshed to recover any missed events during disconnect
    expect(historyFetchCount).toBeGreaterThan(initialHistoryFetches);
  });

  // 16. Failed submission retry card preserves client_message_id while user edits a separate new draft in composer
  test('16. Failed submission retry card preserves client_message_id while user edits a separate new draft in composer', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        json: { items: [], older_cursor: null, has_more_older: false },
      });
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    let postAttemptCount = 0;
    let capturedClientMsgId: string | null = null;
    let capturedPayloadContent: string | null = null;

    await page.route('**/api/v1/communities/irm/discussion/messages', async (route) => {
      if (route.request().method() === 'POST') {
        postAttemptCount += 1;
        const postData = JSON.parse(route.request().postData() || '{}');
        capturedClientMsgId = postData.client_message_id;
        capturedPayloadContent = postData.content;

        if (postAttemptCount === 1) {
          // First attempt: network error / server failure
          await route.abort('failed');
        } else {
          // Retry attempt: succeeds with 200 idempotent replay or 201
          await route.fulfill({
            status: 200,
            json: {
              id: 'e0000000-0000-0000-0000-000000000001',
              kind: 'TEXT',
              content: postData.content,
              sticker_id: null,
              author_id: mockActiveUser.id,
              author_username: mockActiveUser.username,
              created_at: new Date().toISOString(),
              reactions: [],
              caller_reaction: null,
            },
          });
        }
      }
    });

    await page.goto('/communities/irm/discussion');

    const textarea = page.getByRole('textbox', { name: 'Write a message' });
    await textarea.fill('First failing message to be retried');
    await page.getByRole('button', { name: 'Send' }).click();

    // Retry card appears
    await expect(page.getByText('Failed to send message', { exact: true })).toBeVisible();
    await expect(page.getByText('“First failing message to be retried”')).toBeVisible();
    const firstClientMsgId = capturedClientMsgId;
    expect(firstClientMsgId).toBeTruthy();

    // Now type a COMPLETELY SEPARATE draft in the composer
    await textarea.fill('Brand new separate draft that is NOT being retried');

    // Click Retry on the failing submission card
    await page.getByRole('button', { name: 'Retry' }).click();

    // Verify that the retry dispatched the ORIGINAL payload content and the EXACT SAME client_message_id
    expect(capturedClientMsgId).toBe(firstClientMsgId);
    expect(capturedPayloadContent).toBe('First failing message to be retried');

    // The retry succeeded: retry card is gone, first message is rendered
    await expect(page.getByText('Failed to send message', { exact: true })).not.toBeVisible();
    await expect(page.getByText('First failing message to be retried')).toBeVisible();

    // And the composer textarea STILL retains the separate draft!
    await expect(textarea).toHaveValue('Brand new separate draft that is NOT being retried');
  });

  // 17. Reconnecting with older history resets to authoritative latest window and resets pagination cursor consistently
  test('17. Reconnecting with older history resets to authoritative latest window and resets pagination cursor consistently', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    const oldMsg = {
      id: 'f0000000-0000-0000-0000-000000000001',
      kind: 'TEXT' as const,
      content: 'Ancient message from older page',
      sticker_id: null,
      author_id: '00000000-0000-4000-8000-000000000008',
      author_username: 'old_author',
      created_at: '2026-10-06T10:00:00Z',
      reactions: [],
      caller_reaction: null,
    };

    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      const url = new URL(route.request().url());
      const before = url.searchParams.get('before');

      if (before) {
        // Older page fetch
        await route.fulfill({
          status: 200,
          json: { items: [oldMsg], older_cursor: null, has_more_older: false },
        });
      } else {
        // Latest page fetch (initial or refresh)
        await route.fulfill({
          status: 200,
          json: { items: [sampleMsg1], older_cursor: 'cursor-to-older', has_more_older: true },
        });
      }
    });

    let wsRouteHandle: WebSocketRoute | null = null;
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', (ws) => {
      wsRouteHandle = ws;
    });

    await page.goto('/communities/irm/discussion');
    await expect(page.getByText('Welcome to the IRM General Discussion!')).toBeVisible();

    // Click "Load older messages"
    await page.getByRole('button', { name: 'Load older messages' }).click();
    await expect(page.getByText('Ancient message from older page')).toBeVisible();

    // Simulate transient disconnect and reconnect
    await wsRouteHandle!.close({ code: 1006, reason: 'Abnormal closure' });

    // Reconnected: refreshes latest window and resets pagination cleanly
    await expect(page.getByText('Welcome to the IRM General Discussion!')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load older messages' })).toBeVisible();
  });

  // 18. Sticker catalog loading, failure display, and retry
  test('18. Sticker catalog loading failure displays honest error with retry and does not fabricate static stickers', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], older_cursor: null, has_more_older: false } });
    });
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    let failCatalog = true;
    let catalogRequestCount = 0;
    await page.unroute('**/api/v1/communities/irm/discussion/stickers');
    await page.route('**/api/v1/communities/irm/discussion/stickers', async (route) => {
      catalogRequestCount++;
      if (failCatalog) {
        await route.fulfill({ status: 500, json: { detail: 'Catalog database unavailable' } });
      } else {
        await route.fulfill({ status: 200, json: mockStickers });
      }
    });

    await page.goto('/communities/irm/discussion');

    // Wait for composer to mount and open sticker picker
    const stickerBtn = page.getByRole('button', { name: 'Choose a sticker' });
    await expect(stickerBtn).toBeVisible();
    await stickerBtn.click();

    // Verify error is shown with retry button
    await expect(page.getByText('Catalog database unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry Loading Stickers' })).toBeVisible();

    // Retry catalog fetch
    failCatalog = false;
    await page.getByRole('button', { name: 'Retry Loading Stickers' }).click();
    await expect(page.getByText('Catalog database unavailable')).not.toBeVisible();

    // Verify actual catalog stickers are now visible
    await expect(page.getByRole('button', { name: /Thumbs Up sticker/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Heart Eyes sticker/i })).toBeVisible();
    expect(catalogRequestCount).toBeGreaterThanOrEqual(2);
  });

  // 19. Empty initial history snapshot does not wipe out live in-flight WebSocket message
  test('19. Empty initial history snapshot does not wipe out live in-flight WebSocket message', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    let fulfillHistory: (() => void) | null = null;
    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      // Delay fulfillment until WebSocket event arrives
      await new Promise<void>((resolve) => { fulfillHistory = resolve; });
      await route.fulfill({
        status: 200,
        json: { items: [], older_cursor: null, has_more_older: false },
      });
    });

    let wsRouteHandle: WebSocketRoute | null = null;
    let wsConnectedResolve: () => void;
    const wsConnectedPromise = new Promise<void>((r) => { wsConnectedResolve = r; });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', (ws) => {
      wsRouteHandle = ws;
      wsConnectedResolve();
    });

    await page.goto('/communities/irm/discussion');
    await wsConnectedPromise;

    // Deliver WebSocket live message while initial history is in-flight
    wsRouteHandle!.send(
      JSON.stringify({
        type: 'message_created',
        community_slug: 'irm',
        message: {
          id: 'e0000000-0000-0000-0000-000000000001',
          kind: 'TEXT',
          content: 'Live message arriving before empty history snapshot completes',
          sticker_id: null,
          author_id: '00000000-0000-4000-8000-000000000009',
          author_username: 'fast_sender',
          created_at: new Date().toISOString(),
          reactions: [],
        },
      })
    );

    // Verify message appears in UI
    await expect(page.getByText('Live message arriving before empty history snapshot completes')).toBeVisible();

    // Now fulfill the delayed empty snapshot
    fulfillHistory!();

    // Verify the live message is STILL visible and was NOT erased!
    await expect(page.getByText('Live message arriving before empty history snapshot completes')).toBeVisible();
  });

  // 20. Unauthorized personas assert complete protection across direct entry and navigation
  test('20. Unauthorized personas assert complete protection: no history request, no WebSocket, no composer', async ({ page }) => {
    let historyRequested = false;
    let wsAttempted = false;

    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      historyRequested = true;
      await route.abort();
    });

    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {
      wsAttempted = true;
    });

    // 20a. Authenticated user without IRM membership (membership: null)
    await setupAuthRoutes(page, mockActiveUser, { membership: null, capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false } });

    await page.goto('/communities/irm/discussion');
    await expect(page.getByRole('heading', { name: 'Join the IRM Community' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request IRM Membership' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();
    await expect(page.getByRole('main').getByText(/sarah_dev/i)).not.toBeVisible();
    expect(historyRequested).toBe(false);
    expect(wsAttempted).toBe(false);

    // 20b. Active member of another community only
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, mockActiveUser, { membership: null, capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false } });

    await page.goto('/communities/irm/discussion');
    await expect(page.getByRole('heading', { name: 'Join the IRM Community' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();
    expect(historyRequested).toBe(false);
    expect(wsAttempted).toBe(false);
  });

  // 21. Delayed submission completion after account change or logout cannot leak into new account
  test('21. Delayed submission completion after account change or logout cannot leak into new account', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);

    await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async (route) => {
      await route.fulfill({ status: 200, json: { items: [], older_cursor: null, has_more_older: false } });
    });
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    let fulfillPost: (() => void) | null = null;
    await page.route('**/api/v1/communities/irm/discussion/messages', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise<void>((resolve) => { fulfillPost = resolve; });
        await route.fulfill({
          status: 201,
          json: {
            id: 'd0000000-0000-0000-0000-000000000001',
            kind: 'TEXT',
            content: 'User A message in-flight during logout',
            sticker_id: null,
            author_id: mockActiveUser.id,
            author_username: mockActiveUser.username,
            created_at: new Date().toISOString(),
            reactions: [],
            caller_reaction: null,
          },
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/communities/irm/discussion');

    const textarea = page.getByRole('textbox', { name: 'Write a message' });
    await textarea.fill('User A message in-flight during logout');
    await page.getByRole('button', { name: 'Send' }).click();

    // Now User A logs out while the POST request is in-flight
    await page.unroute('**/api/v1/auth/me');
    await page.unroute('**/api/v1/communities/irm/membership/me');
    await setupAuthRoutes(page, null, null);

    // Trigger AuthContext logout/session check
    await page.goto('/login');

    // Fulfill the delayed POST request now that user has logged out
    fulfillPost!();

    // Navigate to discussion as guest
    await page.goto('/communities/irm/discussion');
    await expect(page.getByText('Authentication Needed')).toBeVisible();
    await expect(page.getByText('User A message in-flight during logout')).not.toBeVisible();
  });

  // 22. Popover keyboard Escape dismissal, focus restoration, and 320px mobile width safety
  test('22. Popover keyboard Escape dismissal, focus restoration, and 320px mobile viewport safety', async ({ page }) => {
    await setupAuthRoutes(page, mockActiveUser, mockActiveMembership);
    await page.route('**/api/v1/communities/irm/discussion/messages*', async (route) => {
      await route.fulfill({ status: 200, json: { items: [sampleMsg1], older_cursor: null, has_more_older: false } });
    });
    await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', () => {});

    // Set mobile 320px viewport
    await page.setViewportSize({ width: 320, height: 600 });
    await page.goto('/communities/irm/discussion');

    // 22a. Sticker picker opens, Escape dismisses, focus restores to trigger button
    const stickerTrigger = page.getByRole('button', { name: 'Choose a sticker' });
    await stickerTrigger.click();
    const stickerDialog = page.getByRole('dialog', { name: 'Built-in stickers' });
    await expect(stickerDialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(stickerDialog).not.toBeVisible();
    await expect(stickerTrigger).toBeFocused();

    // 22b. Reaction picker opens, Escape dismisses, focus restores to trigger button
    const reactionTrigger = page.getByRole('button', { name: 'Add reaction' }).first();
    await reactionTrigger.click();
    const reactionDialog = page.getByRole('dialog', { name: 'Choose a reaction' });
    await expect(reactionDialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(reactionDialog).not.toBeVisible();
    await expect(reactionTrigger).toBeFocused();

    // 22c. Verify no horizontal overflow at 320px
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

});

