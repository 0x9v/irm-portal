import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

const APPROVED_TEST_DB = 'irm_integration_test';
const DISALLOWED_DB_NAMES = new Set(['irm', 'irm_dev', 'irm_prod', 'postgres', 'template1']);

export function verifyTestDatabaseConnection(connectedDbName: string): void {
  if (!connectedDbName || connectedDbName !== APPROVED_TEST_DB) {
    throw new Error(
      `SECURITY REFUSAL: Refusing destructive action on database "${connectedDbName}". Must be explicitly "${APPROVED_TEST_DB}".`
    );
  }
  if (DISALLOWED_DB_NAMES.has(connectedDbName.toLowerCase())) {
    throw new Error(
      `SECURITY REFUSAL: Database "${connectedDbName}" is a production or development database.`
    );
  }
}

export function executeSafeTruncation(
  query: string,
  getConnectedDbFn: () => string,
  executeSqlFn: (q: string) => string
): string {
  const connectedDb = getConnectedDbFn();
  verifyTestDatabaseConnection(connectedDb);
  return executeSqlFn(query);
}

function runPsql(query: string): string {
  const result = execSync(
    `psql -h 127.0.0.1 -p 5432 -U irm_test -d irm_integration_test -t -A -q -c "${query}"`,
    { encoding: 'utf-8' }
  );
  const lines = result.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[0] || '';
}

test.describe('Task 5.2 Real-Backend Acceptance: Member-Only Community Posts & Replies', () => {
  test.beforeAll(() => {
    const backendDir = path.resolve(__dirname, '../../backend');
    execSync(
      `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/seed.py`,
      { encoding: 'utf-8' }
    );

    // Verify connected database identity before executing scoped table truncation
    executeSafeTruncation(
      'TRUNCATE TABLE community_post_replies, community_posts CASCADE;',
      () => runPsql('SELECT current_database();'),
      (sql) => runPsql(sql)
    );
  });

  test('Full Acceptance: Post creation, module tagging, feed filtering, replies, and privacy enforcement', async ({ browser }) => {
    test.setTimeout(60000);
    const testRun = Date.now().toString().slice(-6);
    const password = 'Password123!';

    const memAEmail = `mem_a_${testRun}@example.com`;
    const memAUsername = `mem_a_${testRun}`;

    const memBEmail = `mem_b_${testRun}@example.com`;
    const memBUsername = `mem_b_${testRun}`;

    const modEmail = `mod_${testRun}@example.com`;
    const modUsername = `mod_${testRun}`;

    const pendEmail = `pend_${testRun}@example.com`;
    const pendUsername = `pend_${testRun}`;

    // Helper to register and establish membership
    const setupUser = async (email: string, username: string, status: 'ACTIVE' | 'PENDING', role: string) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto('/register');
      await page.fill('input[name=username]', username);
      await page.fill('input[name=email]', email);
      await page.fill('input[name=first_name]', 'Test');
      await page.fill('input[name=family_name]', 'User');
      await page.fill('input[name=password]', password);
      await page.click('button[type=submit]');
      await expect(page.getByText('Your account was created successfully!')).toBeVisible();

      const userId = runPsql(`SELECT id FROM users WHERE email='${email}';`);
      const communityId = runPsql(`SELECT id FROM communities WHERE slug='irm';`);
      const uniqueCne = `CNE_${Date.now().toString().slice(-4)}_${Math.floor(Math.random() * 1000)}`;

      const existingMemId = runPsql(`SELECT id FROM memberships WHERE user_id='${userId}' AND community_id='${communityId}';`);
      let memId = existingMemId;
      if (!existingMemId) {
        memId = runPsql(
          `INSERT INTO memberships (id, user_id, community_id, status, role, cne, created_at, updated_at) VALUES (gen_random_uuid(), '${userId}', '${communityId}', '${status}', '${role}', '${uniqueCne}', NOW(), NOW()) RETURNING id;`
        );
      } else {
        runPsql(`UPDATE memberships SET status='${status}', role='${role}' WHERE id='${memId}';`);
      }

      // Login to obtain real session cookie
      await page.goto('/login');
      await page.fill('input[name=email]', email);
      await page.fill('input[name=password]', password);
      await page.click('button[type=submit]');
      await page.waitForURL('**/account#community-membership');

      return { ctx, page, userId, memId };
    };

    const memA = await setupUser(memAEmail, memAUsername, 'ACTIVE', 'MEMBER');
    const memB = await setupUser(memBEmail, memBUsername, 'ACTIVE', 'MEMBER');
    const mod = await setupUser(modEmail, modUsername, 'ACTIVE', 'MODERATOR');
    const pend = await setupUser(pendEmail, pendUsername, 'PENDING', 'MEMBER');

    // Fetch first existing module name from DB
    const modAName = runPsql(`SELECT name FROM modules ORDER BY name ASC LIMIT 1;`) || 'Advanced C';

    // -------------------------------------------------------------
    // Step 1: Member A creates a tagged post
    // -------------------------------------------------------------
    const postATitle = `Post A by Member: Algorithms & Data ${testRun}`;
    const postABody = `Detailed explanation by Member A.\nLine 2: Preserved formatting with special chars & <tags>.\nLine 3: Conclusion.`;

    await memA.page.goto('/communities/irm/posts/new');
    await expect(memA.page.getByRole('heading', { name: 'Create a Post' })).toBeVisible();

    await memA.page.fill('#post-title', postATitle);
    await memA.page.fill('#post-content', postABody);

    // Tag with Mod A
    const modAButton = memA.page.getByRole('button', { name: `+ ${modAName}` });
    await expect(modAButton).toBeVisible();
    await modAButton.click();

    // Submit post
    await memA.page.getByRole('button', { name: 'Publish Post' }).click();

    // Verify redirected to detail page without private content in URL query
    await memA.page.waitForURL(/\/communities\/irm\/posts\/[0-9a-f-]{36}$/);
    await expect(memA.page.getByText('Your post has been published successfully.')).toBeVisible();
    await expect(memA.page.getByRole('heading', { level: 1, name: postATitle })).toBeVisible();
    await expect(memA.page.getByText(`@${memAUsername}`)).toBeVisible();
    await expect(memA.page.getByText(modAName)).toBeVisible();

    // Reloading detail page consumes the ephemeral confirmation and hides the banner
    await memA.page.reload();
    await expect(memA.page.getByText('Your post has been published successfully.')).not.toBeVisible();
    await expect(memA.page.getByRole('heading', { level: 1, name: postATitle })).toBeVisible();

    const postAUrl = memA.page.url();
    const postAId = new URL(postAUrl).pathname.split('/').pop() || '';

    // -------------------------------------------------------------
    // Step 2: Moderator creates an untagged post
    // -------------------------------------------------------------
    const modPostTitle = `Untagged Discussion by Moderator ${testRun}`;
    const modPostBody = `General community discussion body without module tags.`;

    await mod.page.goto('/communities/irm/posts/new');
    await expect(mod.page.getByRole('heading', { name: 'Create a Post' })).toBeVisible();

    await mod.page.fill('#post-title', modPostTitle);
    await mod.page.fill('#post-content', modPostBody);
    await mod.page.getByRole('button', { name: 'Publish Post' }).click();

    await mod.page.waitForURL(/\/communities\/irm\/posts\/[0-9a-f-]{36}$/);
    await expect(mod.page.getByText('Your post has been published successfully.')).toBeVisible();
    await expect(mod.page.getByRole('heading', { level: 1, name: modPostTitle })).toBeVisible();

    // Direct navigation with manual ?created=true parameter does not spoof confirmation
    const modPostUrl = mod.page.url();
    const currentModPostId = new URL(modPostUrl).pathname.split('/').pop() || '';
    await mod.page.goto(`/communities/irm/posts/${currentModPostId}?created=true`);
    await expect(mod.page.getByText('Your post has been published successfully.')).not.toBeVisible();

    // -------------------------------------------------------------
    // Step 3: Member B views feed and filters by module
    // -------------------------------------------------------------
    await memB.page.goto('/communities/irm/posts');
    await expect(memB.page.getByRole('heading', { level: 1, name: 'Community Posts' })).toBeVisible();

    // Newest first: Moderator's post then Member A's post
    await expect(memB.page.getByText(modPostTitle)).toBeVisible();
    await expect(memB.page.getByText(postATitle)).toBeVisible();

    // Filter by modA
    const filterPillModA = memB.page.getByRole('button', { name: modAName });
    await filterPillModA.click();

    await memB.page.waitForURL(/module_id=/);
    await expect(memB.page.getByText(postATitle)).toBeVisible();
    await expect(memB.page.getByText(modPostTitle)).not.toBeVisible();

    // Clear filter ("All Modules")
    await memB.page.getByRole('button', { name: 'All Modules' }).click();
    await expect(memB.page.getByText(modPostTitle)).toBeVisible();
    await expect(memB.page.getByText(postATitle)).toBeVisible();

    // -------------------------------------------------------------
    // Step 4: Member B views Member A's post and posts a reply
    // -------------------------------------------------------------
    await memB.page.getByRole('link', { name: postATitle }).click();
    await memB.page.waitForURL(`**/communities/irm/posts/${postAId}`);

    // Verify full post body and newlines
    await expect(memB.page.getByText('Line 2: Preserved formatting with special chars & <tags>.')).toBeVisible();

    // Composer
    const replyTextarea = memB.page.getByLabel(/Leave a reply/i);
    await expect(replyTextarea).toBeVisible();

    const memBReplyText = `Reply from Member B acknowledging post ${testRun}.`;
    await replyTextarea.fill(memBReplyText);
    await memB.page.getByRole('button', { name: 'Post Reply' }).click();

    await expect(memB.page.getByText('Your reply was posted.')).toBeVisible();
    await expect(memB.page.getByText(memBReplyText)).toBeVisible();
    await expect(memB.page.getByText(`@${memBUsername}`)).toBeVisible();

    // -------------------------------------------------------------
    // Step 5: Member A views detail and replies back
    // -------------------------------------------------------------
    await memA.page.goto(`/communities/irm/posts/${postAId}`);
    await expect(memA.page.getByText(memBReplyText)).toBeVisible();

    const memAReplyText = `Reply from Member A thanking Member B ${testRun}.`;
    const memAReplyArea = memA.page.getByLabel(/Leave a reply/i);
    await memAReplyArea.fill(memAReplyText);
    await memA.page.getByRole('button', { name: 'Post Reply' }).click();

    await expect(memA.page.getByText('Your reply was posted.')).toBeVisible();
    await expect(memA.page.getByText(memAReplyText)).toBeVisible();

    // -------------------------------------------------------------
    // Step 6: Malformed & Non-existent Post IDs
    // -------------------------------------------------------------
    await memA.page.goto('/communities/irm/posts/00000000-0000-0000-0000-000000000000');
    await expect(memA.page.getByRole('heading', { level: 2, name: 'Post Unavailable' })).toBeVisible();

    await memA.page.goto('/communities/irm/posts/invalid-id-syntax');
    await expect(memA.page.getByRole('heading', { level: 2, name: 'Post Unavailable' })).toBeVisible();

    // -------------------------------------------------------------
    // Step 7: Access Control & Privacy
    // -------------------------------------------------------------
    // Pending Member
    await pend.page.goto('/communities/irm/posts');
    await expect(pend.page.getByText('Membership Under Review')).toBeVisible();
    await expect(pend.page.getByText(postATitle)).not.toBeVisible();
    await expect(pend.page.getByRole('link', { name: 'New Post' })).not.toBeVisible();

    await pend.page.goto('/communities/irm/posts/new');
    await expect(pend.page.getByText('Membership Under Review')).toBeVisible();
    await expect(pend.page.locator('#post-title')).not.toBeVisible();

    // Direct API attempt by pending member returns 403
    const pendPostStatus = await pend.page.evaluate(async () => {
      const res = await fetch('http://localhost:8000/api/v1/communities/irm/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Illegal Pending Post', content: 'Should fail' }),
        credentials: 'include',
      });
      return res.status;
    });
    expect(pendPostStatus).toBe(403);

    // Unauthenticated Guest
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();

    await guestPage.goto('/communities/irm/posts');
    await expect(guestPage.getByText('Authentication Needed')).toBeVisible();
    await expect(guestPage.getByText(postATitle)).not.toBeVisible();

    await guestPage.goto(`/communities/irm/posts/${postAId}`);
    await expect(guestPage.getByText('Authentication Needed')).toBeVisible();
    await expect(guestPage.getByText(postATitle)).not.toBeVisible();

    const guestGetStatus = await guestPage.request.get('http://localhost:8000/api/v1/communities/irm/posts');
    expect(guestGetStatus.status()).toBe(401);

    const guestPostStatus = await guestPage.request.post('http://localhost:8000/api/v1/communities/irm/posts', {
      data: { title: 'Guest Post', content: 'Should fail' },
    });
    expect(guestPostStatus.status()).toBe(401);

    // -------------------------------------------------------------
    // Step 8: Multi-page Feed Pagination & Feed Ordering Preserved
    // -------------------------------------------------------------
    // Verify that reply creation on Post A did not bump its created_at or place it ahead of Moderator post
    const postACreatedAt = runPsql(`SELECT created_at FROM community_posts WHERE id='${postAId}';`);
    const modPostId = runPsql(`SELECT id FROM community_posts WHERE title='${modPostTitle}';`);
    const modPostCreatedAt = runPsql(`SELECT created_at FROM community_posts WHERE id='${modPostId}';`);
    expect(new Date(modPostCreatedAt).getTime()).toBeGreaterThanOrEqual(new Date(postACreatedAt).getTime());

    // Insert 22 older posts into PostgreSQL to exercise multi-page feed pagination
    const commId = runPsql(`SELECT id FROM communities WHERE slug='irm';`);
    for (let i = 1; i <= 22; i++) {
      const pastMin = 100 + i;
      runPsql(
        `INSERT INTO community_posts (id, community_id, author_id, title, content, created_at) VALUES (gen_random_uuid(), '${commId}', '${memA.userId}', 'Historic Feed Post ${i} ${testRun}', 'Historic feed content', NOW() - INTERVAL '${pastMin} minutes');`
      );
    }

    await memB.page.goto('/communities/irm/posts');
    await expect(memB.page.getByText(modPostTitle)).toBeVisible();
    await expect(memB.page.getByText(postATitle)).toBeVisible();

    const feedLoadMoreBtn = memB.page.getByRole('button', { name: 'Load more posts' });
    await expect(feedLoadMoreBtn).toBeVisible();
    await feedLoadMoreBtn.click();

    // Verify older items loaded into the same feed
    await expect(memB.page.getByText(`Historic Feed Post 20 ${testRun}`)).toBeVisible();

    // -------------------------------------------------------------
    // Step 9: Multi-page Replies & Intervening Reply Catch-Up
    // -------------------------------------------------------------
    // Insert 25 replies for Post A to test multi-page reply cursor pagination
    for (let i = 1; i <= 25; i++) {
      runPsql(
        `INSERT INTO community_post_replies (id, post_id, author_id, content, created_at) VALUES (gen_random_uuid(), '${postAId}', '${memB.userId}', 'Batch Reply ${i} on Post A', NOW() - INTERVAL '${60 - i} seconds');`
      );
    }

    await memB.page.goto(`/communities/irm/posts/${postAId}`);
    const replyLoadMoreBtn = memB.page.getByRole('button', { name: 'Load more replies' });
    await expect(replyLoadMoreBtn).toBeVisible();

    // Member B posts while older replies are not all loaded
    const lateReplyText = `Late intervening reply from B ${testRun}`;
    const composerArea = memB.page.getByLabel(/Leave a reply/i);
    await composerArea.fill(lateReplyText);
    await memB.page.getByRole('button', { name: 'Post Reply' }).click();

    await expect(memB.page.getByText('Your reply was posted.')).toBeVisible();
    await expect(memB.page.getByText(lateReplyText)).toBeVisible();
    await expect(memB.page.getByText('Your new reply')).toBeVisible();

    // Load more replies still available and works
    await expect(replyLoadMoreBtn).toBeVisible();
    await replyLoadMoreBtn.click();
    await expect(memB.page.getByText('Batch Reply 25 on Post A')).toBeVisible();
    await expect(memB.page.getByText(lateReplyText)).toBeVisible();

    // -------------------------------------------------------------
    // Step 10: Cross-Community Isolation & Denial
    // -------------------------------------------------------------
    // Ensure foreign community exists with a foreign post
    let foreignCommId = runPsql(`SELECT id FROM communities WHERE slug='cs-club';`);
    if (!foreignCommId) {
      foreignCommId = runPsql(
        `INSERT INTO communities (id, name, slug, created_at, updated_at) VALUES (gen_random_uuid(), 'CS Club', 'cs-club', NOW(), NOW()) RETURNING id;`
      );
    }
    const foreignPostId = runPsql(
      `INSERT INTO community_posts (id, community_id, author_id, title, content, created_at) VALUES (gen_random_uuid(), '${foreignCommId}', '${memA.userId}', 'Foreign Secret Post', 'Foreign content', NOW()) RETURNING id;`
    );

    // Member A attempts to view foreign post via IRM route -> returns 404
    await memA.page.goto(`/communities/irm/posts/${foreignPostId}`);
    await expect(memA.page.getByRole('heading', { level: 2, name: 'Post Unavailable' })).toBeVisible();

    // Direct API call returns 404
    const foreignGetStatus = await memA.page.evaluate(async (pid) => {
      const res = await fetch(`http://localhost:8000/api/v1/communities/irm/posts/${pid}`, {
        credentials: 'include',
      });
      return res.status;
    }, foreignPostId);
    expect(foreignGetStatus).toBe(404);

    // Clean up contexts
    await guestCtx.close();
    await pend.ctx.close();
    await mod.ctx.close();
    await memB.ctx.close();
    await memA.ctx.close();
  });

  test('Safety Guard: Destructive SQL is refused if connected database is not explicitly irm_integration_test', () => {
    let destructiveSqlExecuted = false;
    const fakeExecutor = () => {
      destructiveSqlExecuted = true;
      return '';
    };

    // Refuses production / dev / generic names without executing destructive SQL
    expect(() => {
      executeSafeTruncation('TRUNCATE TABLE community_posts;', () => 'irm', fakeExecutor);
    }).toThrow(/SECURITY REFUSAL/);
    expect(destructiveSqlExecuted).toBe(false);

    expect(() => {
      executeSafeTruncation('TRUNCATE TABLE community_posts;', () => 'irm_dev', fakeExecutor);
    }).toThrow(/SECURITY REFUSAL/);
    expect(destructiveSqlExecuted).toBe(false);

    expect(() => {
      executeSafeTruncation('TRUNCATE TABLE community_posts;', () => 'irm_prod', fakeExecutor);
    }).toThrow(/SECURITY REFUSAL/);
    expect(destructiveSqlExecuted).toBe(false);

    expect(() => {
      executeSafeTruncation('TRUNCATE TABLE community_posts;', () => 'postgres', fakeExecutor);
    }).toThrow(/SECURITY REFUSAL/);
    expect(destructiveSqlExecuted).toBe(false);

    expect(() => {
      executeSafeTruncation('TRUNCATE TABLE community_posts;', () => 'some_other_test', fakeExecutor);
    }).toThrow(/SECURITY REFUSAL/);
    expect(destructiveSqlExecuted).toBe(false);

    // Only approved test database identity permits execution
    executeSafeTruncation('TRUNCATE TABLE community_posts;', () => 'irm_integration_test', fakeExecutor);
    expect(destructiveSqlExecuted).toBe(true);
  });
});
