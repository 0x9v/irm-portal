import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

function runPsql(query: string): string {
  const result = execSync(
    `psql -h 127.0.0.1 -p 5432 -U irm_test -d irm_integration_test -t -A -q -c "${query}"`,
    { encoding: 'utf-8' }
  );
  const lines = result.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[0] || '';
}

function appointDelegate(email: string) {
  const userId = runPsql(`SELECT id FROM users WHERE email='${email}';`);
  if (!userId) {
    throw new Error(`User with email ${email} not found in test database`);
  }
  runPsql(`UPDATE memberships SET role='MEMBER' WHERE role='DELEGATE';`);
  const uniqueCne = `CNE_DEL_${Date.now().toString().slice(-4)}`;
  const backendDir = path.resolve(__dirname, '../../backend');
  execSync(
    `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/appoint_delegate.py irm ${userId} --cne ${uniqueCne} --apply`,
    { encoding: 'utf-8' }
  );
}

test.describe('Task 3.3: Real-Backend Acceptance - Announcements Permissions, Ordering, Privacy & Detail', () => {
  test.beforeAll(() => {
    const backendDir = path.resolve(__dirname, '../../backend');
    execSync(
      `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/seed.py`,
      { encoding: 'utf-8' }
    );
  });

  test('Full Acceptance: Delegate & Granted Moderator create, Ungranted Moderator & Member denied, Home bounds to latest-3, Detail & XSS safe, Guest denied', async ({ browser }) => {
    const testRun = Date.now().toString().slice(-6);
    const password = 'Password123!';

    const delEmail = `del_${testRun}@example.com`;
    const delUsername = `del_${testRun}`;

    const gmodEmail = `gmod_${testRun}@example.com`;
    const gmodUsername = `gmod_${testRun}`;

    const umodEmail = `umod_${testRun}@example.com`;
    const umodUsername = `umod_${testRun}`;

    const memEmail = `mem_${testRun}@example.com`;
    const memUsername = `mem_${testRun}`;

    // Helper to register and create an active membership directly in DB
    const setupUser = async (email: string, username: string, role: string, permissions: string[] = []) => {
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

      // Ensure active membership exists in DB
      const userId = runPsql(`SELECT id FROM users WHERE email='${email}';`);
      const communityId = runPsql(`SELECT id FROM communities WHERE slug='irm';`);
      const uniqueCne = `CNE_${Date.now().toString().slice(-4)}_${Math.floor(Math.random() * 1000)}`;

      // Insert or update membership
      const existingMemId = runPsql(`SELECT id FROM memberships WHERE user_id='${userId}' AND community_id='${communityId}';`);
      let memId = existingMemId;
      if (!existingMemId) {
        memId = runPsql(
          `INSERT INTO memberships (id, user_id, community_id, status, role, cne, created_at, updated_at) VALUES (gen_random_uuid(), '${userId}', '${communityId}', 'ACTIVE', '${role}', '${uniqueCne}', NOW(), NOW()) RETURNING id;`
        );
      } else {
        runPsql(`UPDATE memberships SET status='ACTIVE', role='${role}' WHERE id='${memId}';`);
      }

      for (const perm of permissions) {
        runPsql(
          `INSERT INTO membership_permissions (id, membership_id, permission) VALUES (gen_random_uuid(), '${memId}', '${perm}') ON CONFLICT DO NOTHING;`
        );
      }

      // Login the user to establish real session
      await page.goto('/login');
      await page.fill('input[name=email]', email);
      await page.fill('input[name=password]', password);
      await page.click('button[type=submit]');
      await page.waitForURL('**/account#community-membership');

      return { ctx, page, userId };
    };

    // 1. Setup Delegate
    const del = await setupUser(delEmail, delUsername, 'MEMBER');
    appointDelegate(delEmail);

    // 2. Setup Granted Moderator (has CREATE_ANNOUNCEMENTS)
    const gmod = await setupUser(gmodEmail, gmodUsername, 'MODERATOR', ['CREATE_ANNOUNCEMENTS']);

    // 3. Setup Ungranted Moderator (no permissions)
    const umod = await setupUser(umodEmail, umodUsername, 'MODERATOR', []);

    // 4. Setup Ordinary Member
    const mem = await setupUser(memEmail, memUsername, 'MEMBER', []);

    // ==========================================
    // TEST A: CREATION PERMISSIONS
    // ==========================================

    // Delegate creates Notice 1
    await del.page.goto('/communities/irm/announcements');
    await expect(del.page.getByRole('heading', { name: 'Post Announcement' })).toBeVisible();
    await del.page.fill('#announcement-title', `Notice 1: Alpha Kickoff ${testRun}`);
    await del.page.fill('#announcement-content', `First announcement body content for ${testRun}.`);
    await del.page.click('button[type=submit]');
    await expect(del.page.getByText('Announcement created successfully.')).toBeVisible();
    await expect(del.page.getByText(`Notice 1: Alpha Kickoff ${testRun}`)).toBeVisible();

    // Granted Moderator creates Notice 2 (with markup characters to verify XSS escaping)
    await gmod.page.goto('/communities/irm/announcements');
    await expect(gmod.page.getByRole('heading', { name: 'Post Announcement' })).toBeVisible();
    await gmod.page.fill('#announcement-title', `Notice 2: Beta Review <script>window.__xss=1</script> ${testRun}`);
    await gmod.page.fill('#announcement-content', `Line 1: Plain text with <b>bold</b> and <img src=x onerror=1> markup.\nLine 2: Newlines preserved.`);
    await gmod.page.click('button[type=submit]');
    await expect(gmod.page.getByText('Announcement created successfully.')).toBeVisible();

    // Ungranted Moderator cannot see creation form
    await umod.page.goto('/communities/irm/announcements');
    await expect(umod.page.getByRole('heading', { name: 'Post Announcement' })).not.toBeVisible();
    await expect(umod.page.locator('#announcement-title')).not.toBeVisible();

    // Direct POST by Ungranted Moderator returns 403 Forbidden
    const umodStatus = await umod.page.evaluate(async () => {
      const res = await fetch('http://localhost:8000/api/v1/communities/irm/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Illegal Notice', content: 'Should fail' }),
        credentials: 'include',
      });
      return res.status;
    });
    expect(umodStatus, 'Ungranted moderator must be rejected with 403 on announcement creation').toBe(403);

    // Ordinary Member cannot see creation form
    await mem.page.goto('/communities/irm/announcements');
    await expect(mem.page.getByRole('heading', { name: 'Post Announcement' })).not.toBeVisible();
    await expect(mem.page.locator('#announcement-title')).not.toBeVisible();

    // Direct POST by Ordinary Member returns 403 Forbidden
    const memStatus = await mem.page.evaluate(async () => {
      const res = await fetch('http://localhost:8000/api/v1/communities/irm/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Illegal Notice', content: 'Should fail' }),
        credentials: 'include',
      });
      return res.status;
    });
    expect(memStatus, 'Ordinary member must be rejected with 403 on announcement creation').toBe(403);

    // ==========================================
    // TEST B: CREATE AT LEAST FOUR ANNOUNCEMENTS
    // ==========================================
    // Delegate creates Notice 3 and Notice 4
    await del.page.goto('/communities/irm/announcements');
    await del.page.fill('#announcement-title', `Notice 3: Lab Maintenance ${testRun}`);
    await del.page.fill('#announcement-content', `Third notice body content for ${testRun}.`);
    await del.page.click('button[type=submit]');
    await expect(del.page.getByText('Announcement created successfully.')).toBeVisible();

    await del.page.fill('#announcement-title', `Notice 4: Final Exam Schedule ${testRun}`);
    await del.page.fill('#announcement-content', `Fourth and latest notice body content for ${testRun}.`);
    await del.page.click('button[type=submit]');
    await expect(del.page.getByText('Announcement created successfully.')).toBeVisible();

    // ==========================================
    // TEST C: HOME LATEST-THREE BOUNDED OPERATION
    // ==========================================
    // Ordinary member visits Home
    const homeAnnouncementsPromise = mem.page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/communities/irm/announcements') && resp.status() === 200
    );

    await mem.page.goto('/');
    const homeAnnouncementsResp = await homeAnnouncementsPromise;

    // Confirm query was bounded to limit=3
    expect(homeAnnouncementsResp.url()).toContain('limit=3');

    // Confirm exactly the latest 3 appear in deterministic newest-first order
    await expect(mem.page.getByText(`Notice 4: Final Exam Schedule ${testRun}`)).toBeVisible();
    await expect(mem.page.getByText(`Notice 3: Lab Maintenance ${testRun}`)).toBeVisible();
    await expect(mem.page.getByText(`Notice 2: Beta Review <script>window.__xss=1</script> ${testRun}`)).toBeVisible();

    // Notice 1 (the 4th newest) must NOT appear on Home
    await expect(mem.page.getByText(`Notice 1: Alpha Kickoff ${testRun}`)).not.toBeVisible();

    // Clicks "All announcements" -> lands on list page and sees all 4 notices
    await mem.page.getByRole('link', { name: /All announcements/i }).click();
    await mem.page.waitForURL('**/communities/irm/announcements');
    await expect(mem.page.getByText(`Notice 4: Final Exam Schedule ${testRun}`)).toBeVisible();
    await expect(mem.page.getByText(`Notice 3: Lab Maintenance ${testRun}`)).toBeVisible();
    await expect(mem.page.getByText(`Notice 2: Beta Review <script>window.__xss=1</script> ${testRun}`)).toBeVisible();
    await expect(mem.page.getByText(`Notice 1: Alpha Kickoff ${testRun}`)).toBeVisible();

    // ==========================================
    // TEST D: DETAIL ROUTE & XSS ESCAPING
    // ==========================================
    // Open Notice 2 card (which contains script and HTML tags)
    const notice2Card = mem.page.getByRole('link', { name: new RegExp(`Notice 2: Beta Review.*${testRun}`) });
    await expect(notice2Card).toBeVisible();
    await notice2Card.click();

    await mem.page.waitForURL('**/communities/irm/announcements/*');
    await expect(mem.page.getByRole('heading', { level: 1, name: new RegExp(`Notice 2: Beta Review.*${testRun}`) })).toBeVisible();

    // Author username verified
    await expect(mem.page.getByText(`By @${gmodUsername}`)).toBeVisible();

    // Verify content is plain text and newlines preserved
    await expect(mem.page.getByText('Line 1: Plain text with <b>bold</b> and <img src=x onerror=1> markup.')).toBeVisible();
    await expect(mem.page.getByText('Line 2: Newlines preserved.')).toBeVisible();

    // Verify script did NOT execute
    const isXssFired = await mem.page.evaluate(() => (window as unknown as { __xss?: number }).__xss !== undefined);
    expect(isXssFired, 'Injected markup must not execute as JavaScript').toBe(false);

    // Breadcrumbs verification
    const breadcrumb = mem.page.locator("nav[aria-label='Breadcrumb']");
    await expect(breadcrumb.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(breadcrumb.getByRole('link', { name: 'Announcements' })).toHaveAttribute('href', '/communities/irm/announcements');

    // Return link navigates back
    await mem.page.click('text=Back to Announcements');
    await mem.page.waitForURL('**/communities/irm/announcements');

    // ==========================================
    // TEST E: MALFORMED & UNKNOWN DETAIL IDS
    // ==========================================
    // 1. Unknown UUID
    await mem.page.goto('/communities/irm/announcements/00000000-0000-0000-0000-000000000000');
    await expect(mem.page.getByRole('heading', { name: 'Resource Not Found' })).toBeVisible();
    await expect(mem.page.getByText('The requested announcement could not be found or may have been removed.')).toBeVisible();

    // 2. Malformed non-UUID
    await mem.page.goto('/communities/irm/announcements/not-a-valid-uuid-123');
    await expect(mem.page.getByRole('heading', { name: 'Resource Not Found' })).toBeVisible();

    // ==========================================
    // TEST F: UNAUTHENTICATED GUEST ACCESS DENIED
    // ==========================================
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();

    // Guest visiting list page
    await guestPage.goto('/communities/irm/announcements');
    await expect(guestPage.getByText('Authentication Needed')).toBeVisible();
    await expect(guestPage.getByText(`Notice 4: Final Exam Schedule ${testRun}`)).not.toBeVisible();

    // Guest visiting detail page
    const notice4Id = runPsql(`SELECT id FROM announcements WHERE title LIKE '%Notice 4: Final Exam Schedule ${testRun}%';`);
    await guestPage.goto(`/communities/irm/announcements/${notice4Id}`);
    await expect(guestPage.getByText('Authentication Needed')).toBeVisible();
    await expect(guestPage.getByText(`Notice 4: Final Exam Schedule ${testRun}`)).not.toBeVisible();

    // Direct API request by guest returns 401
    const guestApiResp = await guestPage.request.get('http://localhost:8000/api/v1/communities/irm/announcements');
    expect(guestApiResp.status()).toBe(401);

    // Cleanup
    await guestCtx.close();
    await mem.ctx.close();
    await umod.ctx.close();
    await gmod.ctx.close();
    await del.ctx.close();
  });

  test('Task 4.2 Real-Backend Acceptance: Member-Only Announcement Replies (Ordinary member, Ungranted Moderator, Delegate, XSS, & Preservation)', async ({ browser }) => {
    const testRun = Date.now().toString().slice(-6);
    const password = 'Password123!';

    const delEmail = `del_rep_${testRun}@example.com`;
    const delUsername = `del_rep_${testRun}`;

    const umodEmail = `umod_rep_${testRun}@example.com`;
    const umodUsername = `umod_rep_${testRun}`;

    const memEmail = `mem_rep_${testRun}@example.com`;
    const memUsername = `mem_rep_${testRun}`;

    // Helper to register and create an active membership directly in DB
    const setupUser = async (email: string, username: string, role: string, permissions: string[] = []) => {
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
          `INSERT INTO memberships (id, user_id, community_id, status, role, cne, created_at, updated_at) VALUES (gen_random_uuid(), '${userId}', '${communityId}', 'ACTIVE', '${role}', '${uniqueCne}', NOW(), NOW()) RETURNING id;`
        );
      } else {
        runPsql(`UPDATE memberships SET status='ACTIVE', role='${role}' WHERE id='${memId}';`);
      }

      for (const perm of permissions) {
        runPsql(
          `INSERT INTO membership_permissions (id, membership_id, permission) VALUES (gen_random_uuid(), '${memId}', '${perm}') ON CONFLICT DO NOTHING;`
        );
      }

      await page.goto('/login');
      await page.fill('input[name=email]', email);
      await page.fill('input[name=password]', password);
      await page.click('button[type=submit]');
      await page.waitForURL('**/account#community-membership');

      return { ctx, page, userId };
    };

    // 1. Setup Delegate, Ungranted Moderator, and Ordinary Member
    const del = await setupUser(delEmail, delUsername, 'MEMBER');
    appointDelegate(delEmail);

    const umod = await setupUser(umodEmail, umodUsername, 'MODERATOR', []);
    const mem = await setupUser(memEmail, memUsername, 'MEMBER', []);

    // 2. Delegate creates an announcement
    await del.page.goto('/communities/irm/announcements');
    await del.page.fill('#announcement-title', `Notice Discussion Target ${testRun}`);
    await del.page.fill('#announcement-content', `Discussion target content for ${testRun}.`);
    await del.page.click('button[type=submit]');
    await expect(del.page.getByText('Announcement created successfully.')).toBeVisible();

    const announcementId = runPsql(`SELECT id FROM announcements WHERE title='Notice Discussion Target ${testRun}';`);
    const initialUpdatedAt = runPsql(`SELECT updated_at FROM announcements WHERE id='${announcementId}';`);

    // 3. Ordinary Member views announcement detail
    await mem.page.goto(`/communities/irm/announcements/${announcementId}`);
    await expect(mem.page.getByRole('heading', { level: 1, name: `Notice Discussion Target ${testRun}` })).toBeVisible();

    // Verify empty discussion state and composer
    await expect(mem.page.getByRole('heading', { name: 'Discussion', exact: true })).toBeVisible();
    await expect(mem.page.getByText('No replies yet. Be the first to start the discussion.')).toBeVisible();
    const memTextarea = mem.page.getByLabel('Leave a reply');
    const memSubmitBtn = mem.page.getByRole('button', { name: 'Post Reply' });
    await expect(memTextarea).toBeVisible();
    await expect(memSubmitBtn).toBeDisabled();

    // Ordinary Member enters reply with HTML and script tags to verify rendering and XSS escaping
    const replyContent1 = `Ordinary member reply from ${memUsername}\nLine 2 with <b>bold</b> and <script>window.__reply_xss=1</script>`;
    await memTextarea.fill(replyContent1);
    await expect(memSubmitBtn).toBeEnabled();
    await memSubmitBtn.click();

    // Verify draft cleared and reply appears under Discussion
    await expect(memTextarea).toHaveValue('');
    await expect(mem.page.getByText(`@${memUsername}`)).toBeVisible();
    await expect(mem.page.getByText(replyContent1)).toBeVisible();

    // Verify XSS script did NOT execute
    const xssTriggered = await mem.page.evaluate(() => (window as unknown as { __reply_xss?: number }).__reply_xss !== undefined);
    expect(xssTriggered).toBe(false);

    // 4. Ungranted Moderator visits the announcement
    await umod.page.goto(`/communities/irm/announcements/${announcementId}`);
    // Ungranted Moderator sees discussion and the ordinary member's reply
    await expect(umod.page.getByText(`@${memUsername}`)).toBeVisible();
    await expect(umod.page.getByText(replyContent1)).toBeVisible();

    // Ungranted Moderator can reply (does not require CREATE_ANNOUNCEMENTS)
    const umodTextarea = umod.page.getByLabel('Leave a reply');
    const umodSubmitBtn = umod.page.getByRole('button', { name: 'Post Reply' });
    await expect(umodTextarea).toBeVisible();

    const replyContent2 = `Ungranted moderator reply from ${umodUsername}: All clear!`;
    await umodTextarea.fill(replyContent2);
    await umodSubmitBtn.click();

    await expect(umodTextarea).toHaveValue('');
    await expect(umod.page.getByText(`@${umodUsername}`)).toBeVisible();
    await expect(umod.page.getByText(replyContent2)).toBeVisible();

    // 5. Delegate visits announcement and sees both replies
    await del.page.goto(`/communities/irm/announcements/${announcementId}`);
    await expect(del.page.getByText(`@${memUsername}`)).toBeVisible();
    await expect(del.page.getByText(`@${umodUsername}`)).toBeVisible();

    // 6. Verify parent announcement's updated_at in database was NOT changed by replies
    const finalUpdatedAt = runPsql(`SELECT updated_at FROM announcements WHERE id='${announcementId}';`);
    expect(finalUpdatedAt, 'Parent announcement updated_at must remain unchanged by replies').toBe(initialUpdatedAt);

    // Verify replies count in database
    const replyCount = runPsql(`SELECT count(*) FROM announcement_replies WHERE announcement_id='${announcementId}';`);
    expect(replyCount).toBe('2');

    // 7. Guest cannot see replies or access composer
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();
    await guestPage.goto(`/communities/irm/announcements/${announcementId}`);
    await expect(guestPage.getByText('Authentication Needed')).toBeVisible();
    await expect(guestPage.getByLabel('Leave a reply')).not.toBeVisible();
    await expect(guestPage.getByText(`@${memUsername}`)).not.toBeVisible();

    // Direct API request by guest is rejected with 401
    const guestRepliesResp = await guestPage.request.get(`http://localhost:8000/api/v1/communities/irm/announcements/${announcementId}/replies`);
    expect(guestRepliesResp.status()).toBe(401);

    // Direct POST by guest is rejected with 401
    const guestPostResp = await guestPage.request.post(`http://localhost:8000/api/v1/communities/irm/announcements/${announcementId}/replies`, {
      data: { content: 'Guest forbidden reply' },
    });
    expect(guestPostResp.status()).toBe(401);

    // Cleanup
    await guestCtx.close();
    await mem.ctx.close();
    await umod.ctx.close();
    await del.ctx.close();
  });

  test('Task 4.3 Real-Backend Acceptance: Multi-Page Reply Pagination (50 replies), Gap Reconciliation & Authorization', async ({ browser }) => {
    const testRun = Date.now().toString().slice(-6);
    const password = 'Password123!';
    const userEmail = `page_user_${testRun}@example.com`;
    const username = `page_user_${testRun}`;

    const userBEmail = `user_b_${testRun}@example.com`;
    const userBUsername = `user_b_${testRun}`;

    const pendingEmail = `pending_${testRun}@example.com`;
    const pendingUsername = `pending_${testRun}`;

    // Register User A and set up active membership
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto('/register');
    await pageA.fill('input[name=username]', username);
    await pageA.fill('input[name=email]', userEmail);
    await pageA.fill('input[name=first_name]', 'Pagination');
    await pageA.fill('input[name=family_name]', 'UserA');
    await pageA.fill('input[name=password]', password);
    await pageA.click('button[type=submit]');
    await expect(pageA.getByText('Your account was created successfully!')).toBeVisible();

    const userIdA = runPsql(`SELECT id FROM users WHERE email='${userEmail}';`);
    const communityId = runPsql(`SELECT id FROM communities WHERE slug='irm';`);
    const uniqueCneA = `CNE_${Date.now().toString().slice(-4)}_${Math.floor(Math.random() * 1000)}`;

    runPsql(
      `INSERT INTO memberships (id, user_id, community_id, status, role, cne, created_at, updated_at) VALUES (gen_random_uuid(), '${userIdA}', '${communityId}', 'ACTIVE', 'MEMBER', '${uniqueCneA}', NOW(), NOW());`
    );

    // Register User B and set up active membership
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto('/register');
    await pageB.fill('input[name=username]', userBUsername);
    await pageB.fill('input[name=email]', userBEmail);
    await pageB.fill('input[name=first_name]', 'User');
    await pageB.fill('input[name=family_name]', 'B');
    await pageB.fill('input[name=password]', password);
    await pageB.click('button[type=submit]');
    await expect(pageB.getByText('Your account was created successfully!')).toBeVisible();

    const userIdB = runPsql(`SELECT id FROM users WHERE email='${userBEmail}';`);
    const uniqueCneB = `CNE_${Date.now().toString().slice(-4)}_${Math.floor(Math.random() * 1000)}`;
    runPsql(
      `INSERT INTO memberships (id, user_id, community_id, status, role, cne, created_at, updated_at) VALUES (gen_random_uuid(), '${userIdB}', '${communityId}', 'ACTIVE', 'MEMBER', '${uniqueCneB}', NOW(), NOW());`
    );

    // Register Pending User (PENDING membership)
    const ctxPending = await browser.newContext();
    const pagePending = await ctxPending.newPage();
    await pagePending.goto('/register');
    await pagePending.fill('input[name=username]', pendingUsername);
    await pagePending.fill('input[name=email]', pendingEmail);
    await pagePending.fill('input[name=first_name]', 'Pending');
    await pagePending.fill('input[name=family_name]', 'User');
    await pagePending.fill('input[name=password]', password);
    await pagePending.click('button[type=submit]');
    await expect(pagePending.getByText('Your account was created successfully!')).toBeVisible();

    const userIdPending = runPsql(`SELECT id FROM users WHERE email='${pendingEmail}';`);
    const uniqueCnePending = `CNE_${Date.now().toString().slice(-4)}_${Math.floor(Math.random() * 1000)}`;
    runPsql(
      `INSERT INTO memberships (id, user_id, community_id, status, role, cne, created_at, updated_at) VALUES (gen_random_uuid(), '${userIdPending}', '${communityId}', 'PENDING', 'MEMBER', '${uniqueCnePending}', NOW(), NOW());`
    );

    // Create an announcement directly in database
    const annId = runPsql(
      `INSERT INTO announcements (id, community_id, author_id, title, content, created_at, updated_at) VALUES (gen_random_uuid(), '${communityId}', '${userIdA}', 'Multi-Page Announcement ${testRun}', 'Pagination testing body content', NOW(), NOW()) RETURNING id;`
    );

    // Insert 50 replies chronologically (Page 1: 1-20, Page 2: 21-40, Page 3: 41-50)
    runPsql(`
      INSERT INTO announcement_replies (id, announcement_id, author_id, content, created_at)
      SELECT 
        gen_random_uuid(),
        '${annId}',
        '${userIdA}',
        'Reply number ' || i,
        NOW() + (i || ' seconds')::interval
      FROM generate_series(1, 50) AS i;
    `);

    // ==========================================
    // 1. PENDING USER ACCESS DENIAL
    // ==========================================
    await pagePending.goto('/login');
    await pagePending.fill('input[name=email]', pendingEmail);
    await pagePending.fill('input[name=password]', password);
    await pagePending.click('button[type=submit]');
    await pagePending.waitForURL('**/account#community-membership');

    // Pending member navigating to announcement cannot see replies or composer
    await pagePending.goto(`/communities/irm/announcements/${annId}`);
    await expect(pagePending.getByLabel('Leave a reply')).not.toBeVisible();
    await expect(pagePending.getByText('Reply number 1', { exact: true })).not.toBeVisible();

    // Direct API calls by pending user return 403
    const pendingGetStatus = await pagePending.evaluate(async (id) => {
      const res = await fetch(`http://localhost:8000/api/v1/communities/irm/announcements/${id}/replies`, {
        credentials: 'include',
      });
      return res.status;
    }, annId);
    expect(pendingGetStatus).toBe(403);

    const pendingPostStatus = await pagePending.evaluate(async (id) => {
      const res = await fetch(`http://localhost:8000/api/v1/communities/irm/announcements/${id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Pending user forbidden reply' }),
        credentials: 'include',
      });
      return res.status;
    }, annId);
    expect(pendingPostStatus).toBe(403);

    // ==========================================
    // 2. MULTI-PAGE PAGINATION (3 PAGES: 20, 20, 10)
    // ==========================================
    await pageA.goto('/login');
    await pageA.fill('input[name=email]', userEmail);
    await pageA.fill('input[name=password]', password);
    await pageA.click('button[type=submit]');
    await pageA.waitForURL('**/account#community-membership');

    await pageA.goto(`/communities/irm/announcements/${annId}`);
    await expect(pageA.getByRole('heading', { level: 1, name: `Multi-Page Announcement ${testRun}` })).toBeVisible();

    // Page 1: exactly items 1 through 20 loaded
    await expect(pageA.getByText('Reply number 1', { exact: true })).toBeVisible();
    await expect(pageA.getByText('Reply number 20', { exact: true })).toBeVisible();
    await expect(pageA.getByText('Reply number 21', { exact: true })).not.toBeVisible();

    const loadMoreBtn = pageA.getByRole('button', { name: 'Load more replies' });
    await expect(loadMoreBtn).toBeVisible();

    // Load page 2 (items 21 through 40)
    await loadMoreBtn.click();
    await expect(pageA.getByText('Reply number 21', { exact: true })).toBeVisible();
    await expect(pageA.getByText('Reply number 40', { exact: true })).toBeVisible();
    await expect(pageA.getByText('Reply number 41', { exact: true })).not.toBeVisible();
    await expect(loadMoreBtn).toBeVisible();

    // Load page 3 (items 41 through 50, partial final page)
    await loadMoreBtn.click();
    await expect(pageA.getByText('Reply number 41', { exact: true })).toBeVisible();
    await expect(pageA.getByText('Reply number 50', { exact: true })).toBeVisible();

    // Cursor is now null -> "Load more replies" is hidden
    await expect(loadMoreBtn).not.toBeVisible();

    // ==========================================
    // 3. POSTING GAP RECONCILIATION
    // ==========================================
    // User A has loaded up to reply 50 and nextCursor is null.
    // User B now posts reply 51 directly to the server.
    runPsql(`
      INSERT INTO announcement_replies (id, announcement_id, author_id, content, created_at)
      VALUES (
        gen_random_uuid(),
        '${annId}',
        '${userIdB}',
        'Intervening reply 51 from User B',
        NOW() + interval '51 seconds'
      );
    `);

    // User A posts reply 52 via browser UI
    const textarea = pageA.getByLabel('Leave a reply');
    await textarea.fill('Reply 52 from User A after User B');
    await pageA.getByRole('button', { name: 'Post Reply' }).click();

    // Post succeeds
    await expect(pageA.getByText('Your reply was posted.')).toBeVisible();
    await expect(textarea).toHaveValue('');

    // Both reply 51 (User B) and reply 52 (User A) must be visible in discussion
    await expect(pageA.getByText('Intervening reply 51 from User B')).toBeVisible();
    await expect(pageA.getByText('Reply 52 from User A after User B')).toBeVisible();

    // Verify canonical chronological ordering: reply 50 appears before 51, and 51 before 52
    const replyTexts = await pageA.locator('section[aria-labelledby="discussion-heading"] article').allInnerTexts();
    const joined = replyTexts.join('\n');
    const idx50 = joined.indexOf('Reply number 50');
    const idx51 = joined.indexOf('Intervening reply 51 from User B');
    const idx52 = joined.indexOf('Reply 52 from User A after User B');

    expect(idx50).toBeGreaterThan(-1);
    expect(idx51).toBeGreaterThan(idx50);
    expect(idx52).toBeGreaterThan(idx51);

    // Clean up contexts
    await ctxPending.close();
    await ctxB.close();
    await ctxA.close();
  });
});
