import { test, expect, Browser, Page } from '@playwright/test';
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

// Helper to register user and grant active community membership
async function setupUser(browser: Browser, email: string, username: string, password = 'Password123!') {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Register
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
  const uniqueCne = `CNE_${Date.now().toString().slice(-4)}_${Math.floor(Math.random() * 100000)}`;

  const existingMemId = runPsql(`SELECT id FROM memberships WHERE user_id='${userId}' AND community_id='${communityId}';`);
  let memId = existingMemId;
  if (!existingMemId) {
    memId = runPsql(
      `INSERT INTO memberships (id, user_id, community_id, status, role, cne, created_at, updated_at) VALUES (gen_random_uuid(), '${userId}', '${communityId}', 'ACTIVE', 'MEMBER', '${uniqueCne}', NOW(), NOW()) RETURNING id;`
    );
  } else {
    runPsql(`UPDATE memberships SET status='ACTIVE', role='MEMBER' WHERE id='${memId}';`);
  }

  // Login to obtain real session cookie
  await page.goto('/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/account#community-membership');

  return { ctx, page, userId, memId };
}

async function postMessageAsUser(
  page: Page,
  payload: { client_message_id: string; kind: string; content?: string | null; sticker_id?: string | null }
) {
  return await page.evaluate(async (body) => {
    const res = await fetch('http://localhost:8000/api/v1/communities/irm/discussion/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }, payload);
}

async function putReactionAsUser(page: Page, messageId: string, emoji: string) {
  return await page.evaluate(async ({ id, rx }) => {
    const res = await fetch(`http://localhost:8000/api/v1/communities/irm/discussion/messages/${id}/reaction`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ emoji: rx }),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  }, { id: messageId, rx: emoji });
}

test.describe('Task 6.3 Real-Backend Acceptance: General Discussion Full Workflow & Reconnect Suites', () => {
  test.beforeAll(() => {
    const backendDir = path.resolve(__dirname, '../../backend');
    execSync(
      `cd ${backendDir} && PYTHONPATH=. POSTGRES_DB=irm_integration_test POSTGRES_USER=irm_test POSTGRES_PASSWORD=irm_test DATABASE_PORT=5432 DATABASE_HOST=127.0.0.1 .venv/bin/python scripts/seed.py`,
      { encoding: 'utf-8' }
    );

    // Verify connected database identity before executing scoped table truncation
    executeSafeTruncation(
      'TRUNCATE TABLE discussion_reactions, discussion_messages CASCADE;',
      () => runPsql('SELECT current_database();'),
      (sql) => runPsql(sql)
    );
  });

  test('Two active members exchange text and stickers with real WebSocket live delivery and isolated reactions', async ({ browser }) => {
    test.setTimeout(60000);
    const testRun = Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
    const password = 'Password123!';

    const aliceEmail = `alice_${testRun}@example.com`;
    const aliceUsername = `alice_${testRun}`;

    const bobEmail = `bob_${testRun}@example.com`;
    const bobUsername = `bob_${testRun}`;

    const alice = await setupUser(browser, aliceEmail, aliceUsername, password);
    const bob = await setupUser(browser, bobEmail, bobUsername, password);

    try {
      // -------------------------------------------------------------
      // Step 1: Both users navigate to discussion page
      // -------------------------------------------------------------
      await alice.page.goto('/communities/irm/discussion');
      await expect(alice.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      await bob.page.goto('/communities/irm/discussion');
      await expect(bob.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(bob.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // -------------------------------------------------------------
      // Step 2: Alice sends a text message
      // -------------------------------------------------------------
      const aliceMessageText = `Hello Bob from Alice in live discussion! [${testRun}]`;
      const aliceTextarea = alice.page.getByRole('textbox', { name: 'Write a message' });
      await aliceTextarea.fill(aliceMessageText);
      await alice.page.getByRole('button', { name: 'Send' }).click();

      // Alice's message is immediately displayed on Alice's page
      await expect(alice.page.getByText(aliceMessageText)).toBeVisible();
      await expect(alice.page.getByText(`@${aliceUsername}`)).toBeVisible();

      // Step 3: Bob receives Alice's message via live WebSocket
      await expect(bob.page.getByText(aliceMessageText)).toBeVisible({ timeout: 10000 });
      await expect(bob.page.getByText(`@${aliceUsername}`)).toBeVisible();

      // -------------------------------------------------------------
      // Step 4: Bob sends a sticker
      // -------------------------------------------------------------
      await bob.page.getByRole('button', { name: 'Choose a sticker' }).click();
      await expect(bob.page.getByRole('dialog', { name: 'Built-in stickers' })).toBeVisible();
      await bob.page.getByRole('button', { name: /Rubber Duck sticker/ }).click();

      // Bob's sticker is displayed on Bob's page
      await expect(bob.page.getByRole('img', { name: 'Rubber Duck sticker' })).toBeVisible();
      await expect(bob.page.getByText(`@${bobUsername}`)).toBeVisible();

      // Step 5: Alice receives Bob's sticker via live WebSocket
      await expect(alice.page.getByRole('img', { name: 'Rubber Duck sticker' })).toBeVisible({ timeout: 10000 });
      await expect(alice.page.getByText(`@${bobUsername}`)).toBeVisible();

      // -------------------------------------------------------------
      // Step 6: Alice adds a Heart reaction to Bob's sticker
      // -------------------------------------------------------------
      const aliceReactToBobBtn = alice.page.getByRole('button', { name: 'Add reaction' }).last();
      await aliceReactToBobBtn.click();
      await expect(alice.page.getByRole('dialog', { name: 'Choose a reaction' })).toBeVisible();
      await alice.page.getByRole('button', { name: 'Heart' }).click();

      // Alice sees Heart reaction badge with count 1, aria-pressed="true"
      const aliceHeartBadge = alice.page.getByRole('button', { name: /Heart, count 1/ });
      await expect(aliceHeartBadge).toBeVisible();
      await expect(aliceHeartBadge).toHaveAttribute('aria-pressed', 'true');

      // Bob receives reaction_changed event live: sees Heart count 1
      // BUT Bob's caller_reaction is NOT selected!
      const bobHeartBadge = bob.page.getByRole('button', { name: /Heart, count 1/ });
      await expect(bobHeartBadge).toBeVisible({ timeout: 10000 });
      await expect(bobHeartBadge).toHaveAttribute('aria-pressed', 'false');

      // -------------------------------------------------------------
      // Step 7: Bob adds a Thumbs Up reaction to Alice's message
      // -------------------------------------------------------------
      const bobReactToAliceBtn = bob.page.getByRole('button', { name: 'Add reaction' }).first();
      await bobReactToAliceBtn.click();
      await expect(bob.page.getByRole('dialog', { name: 'Choose a reaction' })).toBeVisible();
      await bob.page.getByRole('button', { name: 'Thumbs Up' }).click();

      // Bob sees Thumbs Up reaction badge with count 1, aria-pressed="true"
      const bobThumbsBadge = bob.page.getByRole('button', { name: /Thumbs Up, count 1/ });
      await expect(bobThumbsBadge).toBeVisible();
      await expect(bobThumbsBadge).toHaveAttribute('aria-pressed', 'true');

      // Alice receives reaction_changed event live: sees Thumbs Up count 1
      // Alice's own reaction remains unselected
      const aliceThumbsBadge = alice.page.getByRole('button', { name: /Thumbs Up, count 1/ });
      await expect(aliceThumbsBadge).toBeVisible({ timeout: 10000 });
      await expect(aliceThumbsBadge).toHaveAttribute('aria-pressed', 'false');

      // -------------------------------------------------------------
      // Step 8: Persistence verification (Alice reloads page)
      // -------------------------------------------------------------
      await alice.page.reload();
      await expect(alice.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Verifies Alice's message, Bob's sticker, and reactions are preserved from DB
      await expect(alice.page.getByText(aliceMessageText)).toBeVisible();
      await expect(alice.page.getByRole('img', { name: 'Rubber Duck sticker' })).toBeVisible();
      await expect(alice.page.getByRole('button', { name: /Heart, count 1/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(alice.page.getByRole('button', { name: /Thumbs Up, count 1/ })).toHaveAttribute('aria-pressed', 'false');

      // -------------------------------------------------------------
      // Step 9: Disconnect / Reconnect Recovery
      // -------------------------------------------------------------
      // Alice navigates away to home page (disconnecting socket)
      await alice.page.goto('/');
      await expect(alice.page.getByRole('heading', { level: 1, name: 'Welcome to IRM Hub' })).toBeVisible();

      // Bob sends a message while Alice is disconnected
      const bobCatchupMsg = `Catch-up message sent while Alice is disconnected [${testRun}]`;
      const bobTextarea = bob.page.getByRole('textbox', { name: 'Write a message' });
      await bobTextarea.fill(bobCatchupMsg);
      await bob.page.getByRole('button', { name: 'Send' }).click();
      await expect(bob.page.getByText(bobCatchupMsg)).toBeVisible();

      // Alice navigates back to Discussion (reconnecting socket & fetching authoritative history)
      await alice.page.goto('/communities/irm/discussion');
      await expect(alice.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Alice receives Bob's catch-up message from durable history
      await expect(alice.page.getByText(bobCatchupMsg)).toBeVisible({ timeout: 10000 });

      // -------------------------------------------------------------
      // Step 10: Authorization Rejection for Non-Member
      // -------------------------------------------------------------
      const charlieEmail = `charlie_${testRun}@example.com`;
      const charlieUsername = `charlie_${testRun}`;
      const charlieCtx = await browser.newContext();
      const charliePage = await charlieCtx.newPage();

      try {
        await charliePage.goto('/register');
        await charliePage.fill('input[name=username]', charlieUsername);
        await charliePage.fill('input[name=email]', charlieEmail);
        await charliePage.fill('input[name=first_name]', 'Charlie');
        await charliePage.fill('input[name=family_name]', 'User');
        await charliePage.fill('input[name=password]', password);
        await charliePage.click('button[type=submit]');
        await expect(charliePage.getByText('Your account was created successfully!')).toBeVisible();

        await charliePage.goto('/login');
        await charliePage.fill('input[name=email]', charlieEmail);
        await charliePage.fill('input[name=password]', password);
        await charliePage.click('button[type=submit]');
        await charliePage.waitForURL('**/account#community-membership');

        // Charlie navigates directly to Discussion without IRM membership
        await charliePage.goto('/communities/irm/discussion');

        // Receives appropriate membership guidance and Discussion is not rendered
        await expect(charliePage.getByText('Join the IRM Community')).toBeVisible();
        await expect(charliePage.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();
        await expect(charliePage.getByText(aliceMessageText)).not.toBeVisible();
      } finally {
        await charlieCtx.close();
      }

      // -------------------------------------------------------------
      // Step 11: Revocation Rejection in Real Backend
      // -------------------------------------------------------------
      // Update Bob's membership status in PostgreSQL to REJECTED
      executeSafeTruncation(
        `UPDATE memberships SET status='REJECTED' WHERE id='${bob.memId}';`,
        () => runPsql('SELECT current_database();'),
        (sql) => runPsql(sql)
      );

      // Bob refreshes page
      await bob.page.reload();

      // Access is denied, guidance shown, discussion messages and composer unmounted
      await expect(bob.page.getByText('Membership Request Not Approved')).toBeVisible();
      await expect(bob.page.getByRole('textbox', { name: 'Write a message' })).not.toBeVisible();
      await expect(bob.page.getByText(aliceMessageText)).not.toBeVisible();

    } finally {
      await alice.ctx.close();
      await bob.ctx.close();
    }
  });

  test('Scenario G.1: Reconnect User A after User B posts messages and toggles reactions -> verify latest window and personalized reaction state are refreshed', async ({ browser }) => {
    test.setTimeout(60000);
    const testRun = Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
    const aliceEmail = `alice_g1_${testRun}@example.com`;
    const aliceUsername = `alice_g1_${testRun}`;
    const bobEmail = `bob_g1_${testRun}@example.com`;
    const bobUsername = `bob_g1_${testRun}`;

    executeSafeTruncation(
      'TRUNCATE TABLE discussion_reactions, discussion_messages CASCADE;',
      () => runPsql('SELECT current_database();'),
      (sql) => runPsql(sql)
    );

    const alice = await setupUser(browser, aliceEmail, aliceUsername);
    const bob = await setupUser(browser, bobEmail, bobUsername);

    try {
      await alice.page.goto('/communities/irm/discussion');
      await expect(alice.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      await bob.page.goto('/communities/irm/discussion');
      await expect(bob.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(bob.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Alice sends initial message
      const aliceMsg = `Initial message from Alice [${testRun}]`;
      await alice.page.getByRole('textbox', { name: 'Write a message' }).fill(aliceMsg);
      await alice.page.getByRole('button', { name: 'Send' }).click();
      await expect(alice.page.getByText(aliceMsg)).toBeVisible();
      await expect(bob.page.getByText(aliceMsg)).toBeVisible({ timeout: 10000 });

      // Alice reacts to her own message with THUMBS_UP
      await alice.page.getByRole('button', { name: 'Add reaction' }).first().click();
      await alice.page.getByRole('button', { name: 'Thumbs Up' }).click();
      const aliceThumbsBadge = alice.page.getByRole('button', { name: /Thumbs Up, count 1/ });
      await expect(aliceThumbsBadge).toBeVisible();
      await expect(aliceThumbsBadge).toHaveAttribute('aria-pressed', 'true');

      // Bob sees reaction count 1 but aria-pressed is false
      const bobThumbsBadge = bob.page.getByRole('button', { name: /Thumbs Up, count 1/ });
      await expect(bobThumbsBadge).toBeVisible({ timeout: 10000 });
      await expect(bobThumbsBadge).toHaveAttribute('aria-pressed', 'false');

      // Alice disconnects socket
      await alice.page.evaluate(() => (window as unknown as { __discussionTest?: { disconnect: () => void } }).__discussionTest?.disconnect());
      await expect(alice.page.getByText('Offline')).toBeVisible({ timeout: 5000 });

      // Bob posts messages while Alice is offline
      const bobOffline1 = `Bob offline 1 [${testRun}]`;
      const bobOffline2 = `Bob offline 2 [${testRun}]`;
      await bob.page.getByRole('textbox', { name: 'Write a message' }).fill(bobOffline1);
      await bob.page.getByRole('button', { name: 'Send' }).click();
      await expect(bob.page.getByText(bobOffline1)).toBeVisible();

      await bob.page.getByRole('textbox', { name: 'Write a message' }).fill(bobOffline2);
      await bob.page.getByRole('button', { name: 'Send' }).click();
      await expect(bob.page.getByText(bobOffline2)).toBeVisible();

      // Bob adds heart reaction to Alice's message using Bob's authenticated session
      const aliceMsgId = runPsql(`SELECT id FROM discussion_messages WHERE content='${aliceMsg}';`);
      const bobReactRes = await putReactionAsUser(bob.page, aliceMsgId, 'heart');
      expect(bobReactRes.status).toBe(200);

      // Verify Alice has NOT received the offline messages yet
      await expect(alice.page.getByText(bobOffline2)).not.toBeVisible();

      // Alice reconnects
      await alice.page.evaluate(() => (window as unknown as { __discussionTest?: { reconnect: () => void } }).__discussionTest?.reconnect());
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Alice now sees Bob's offline messages
      await expect(alice.page.getByText(bobOffline1)).toBeVisible();
      await expect(alice.page.getByText(bobOffline2)).toBeVisible();

      // Alice sees updated reactions:
      // - Bob's HEART is visible with count 1, aria-pressed false (not Alice's reaction)
      const aliceHeartBadge = alice.page.getByRole('button', { name: /Heart, count 1/ });
      await expect(aliceHeartBadge).toBeVisible();
      await expect(aliceHeartBadge).toHaveAttribute('aria-pressed', 'false');

      // - Alice's own THUMBS_UP is preserved (count 1, aria-pressed true)
      const aliceThumbsBadgeAfter = alice.page.getByRole('button', { name: /Thumbs Up, count 1/ });
      await expect(aliceThumbsBadgeAfter).toBeVisible();
      await expect(aliceThumbsBadgeAfter).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await alice.ctx.close();
      await bob.ctx.close();
    }
  });

  test('Scenario G.2: Disconnect User A, User B posts > 30 messages, Reconnect User A -> verify 30 latest messages returned and older messages accessible via pagination', async ({ browser }) => {
    test.setTimeout(60000);
    const testRun = Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
    const aliceEmail = `alice_g2_${testRun}@example.com`;
    const aliceUsername = `alice_g2_${testRun}`;
    const bobEmail = `bob_g2_${testRun}@example.com`;
    const bobUsername = `bob_g2_${testRun}`;

    executeSafeTruncation(
      'TRUNCATE TABLE discussion_reactions, discussion_messages CASCADE;',
      () => runPsql('SELECT current_database();'),
      (sql) => runPsql(sql)
    );

    const alice = await setupUser(browser, aliceEmail, aliceUsername);
    const bob = await setupUser(browser, bobEmail, bobUsername);

    try {
      await alice.page.goto('/communities/irm/discussion');
      await expect(alice.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Alice disconnects
      await alice.page.evaluate(() => (window as unknown as { __discussionTest?: { disconnect: () => void } }).__discussionTest?.disconnect());
      await expect(alice.page.getByText('Offline')).toBeVisible({ timeout: 5000 });

      // Bob posts 35 messages via REST using Bob's session
      for (let i = 1; i <= 35; i++) {
        const res = await postMessageAsUser(bob.page, {
          client_message_id: crypto.randomUUID(),
          kind: 'TEXT',
          content: `Batch_Msg_${String(i).padStart(2, '0')}_[${testRun}]`,
        });
        expect(res.status).toBe(201);
      }

      // Alice reconnects
      await alice.page.evaluate(() => (window as unknown as { __discussionTest?: { reconnect: () => void } }).__discussionTest?.reconnect());
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Verify the latest window has 30 messages (Batch_Msg_06 to Batch_Msg_35)
      await expect(alice.page.getByText(`Batch_Msg_35_[${testRun}]`)).toBeVisible();
      await expect(alice.page.getByText(`Batch_Msg_06_[${testRun}]`)).toBeVisible();

      // Batch_Msg_01 to Batch_Msg_05 are older and outside the 30-message window
      await expect(alice.page.getByText(`Batch_Msg_05_[${testRun}]`)).not.toBeVisible();
      await expect(alice.page.getByText(`Batch_Msg_01_[${testRun}]`)).not.toBeVisible();

      // Verify "Load older messages" button is present and active
      const loadOlderBtn = alice.page.getByRole('button', { name: 'Load older messages' });
      await expect(loadOlderBtn).toBeVisible();

      // Alice paginates to fetch the remaining older messages
      await loadOlderBtn.click();

      // Now Batch_Msg_01 to Batch_Msg_05 are prepended and visible
      await expect(alice.page.getByText(`Batch_Msg_05_[${testRun}]`)).toBeVisible();
      await expect(alice.page.getByText(`Batch_Msg_01_[${testRun}]`)).toBeVisible();

      // Verify all 35 messages are rendered without duplication
      const allMessages = await alice.page.locator(`text=Batch_Msg_`).count();
      expect(allMessages).toBe(35);
    } finally {
      await alice.ctx.close();
      await bob.ctx.close();
    }
  });

  test('Scenario G.3: User A loads older history, disconnects, User B updates reaction on older message -> Reconnect User A -> view resets to authoritative latest window', async ({ browser }) => {
    test.setTimeout(60000);
    const testRun = Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
    const aliceEmail = `alice_g3_${testRun}@example.com`;
    const aliceUsername = `alice_g3_${testRun}`;
    const bobEmail = `bob_g3_${testRun}@example.com`;
    const bobUsername = `bob_g3_${testRun}`;

    executeSafeTruncation(
      'TRUNCATE TABLE discussion_reactions, discussion_messages CASCADE;',
      () => runPsql('SELECT current_database();'),
      (sql) => runPsql(sql)
    );

    const alice = await setupUser(browser, aliceEmail, aliceUsername);
    const bob = await setupUser(browser, bobEmail, bobUsername);

    try {
      // Bob seeds 35 messages via Bob's authenticated session
      for (let i = 1; i <= 35; i++) {
        const res = await postMessageAsUser(bob.page, {
          client_message_id: crypto.randomUUID(),
          kind: 'TEXT',
          content: `History_Msg_${String(i).padStart(2, '0')}_[${testRun}]`,
        });
        expect(res.status).toBe(201);
      }

      // Alice visits Discussion
      await alice.page.goto('/communities/irm/discussion');
      await expect(alice.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Alice sees messages 06-35
      await expect(alice.page.getByText(`History_Msg_35_[${testRun}]`)).toBeVisible();
      await expect(alice.page.getByText(`History_Msg_06_[${testRun}]`)).toBeVisible();

      // Alice loads older history
      const loadOlderBtn = alice.page.getByRole('button', { name: 'Load older messages' });
      await expect(loadOlderBtn).toBeVisible();
      await loadOlderBtn.click();

      // Now Alice has loaded History_Msg_01
      await expect(alice.page.getByText(`History_Msg_01_[${testRun}]`)).toBeVisible();

      // Alice disconnects
      await alice.page.evaluate(() => (window as unknown as { __discussionTest?: { disconnect: () => void } }).__discussionTest?.disconnect());
      await expect(alice.page.getByText('Offline')).toBeVisible({ timeout: 5000 });

      // While Alice is disconnected, Bob adds a reaction on History_Msg_01 (outside the latest 30 window)
      const msg01Id = runPsql(`SELECT id FROM discussion_messages WHERE content='History_Msg_01_[${testRun}]';`);
      const reactRes = await putReactionAsUser(bob.page, msg01Id, 'laugh');
      expect(reactRes.status).toBe(200);

      // Alice reconnects
      await alice.page.evaluate(() => (window as unknown as { __discussionTest?: { reconnect: () => void } }).__discussionTest?.reconnect());
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      // Alice's view has reset to the authoritative latest 30 window (History_Msg_06 to History_Msg_35)
      // and older unrefreshed messages are not displayed with stale data
      await expect(alice.page.getByText(`History_Msg_35_[${testRun}]`)).toBeVisible();
      await expect(alice.page.getByText(`History_Msg_06_[${testRun}]`)).toBeVisible();
      await expect(alice.page.getByText(`History_Msg_01_[${testRun}]`)).not.toBeVisible();

      // The pagination cursor is consistent, and "Load older messages" is available
      const loadOlderBtnAfter = alice.page.getByRole('button', { name: 'Load older messages' });
      await expect(loadOlderBtnAfter).toBeVisible();

      // When Alice loads older messages again, fresh state with Bob's laugh reaction is retrieved
      await loadOlderBtnAfter.click();
      await expect(alice.page.getByText(`History_Msg_01_[${testRun}]`)).toBeVisible();
      await expect(alice.page.getByRole('button', { name: /Laugh, count 1/ })).toBeVisible();
    } finally {
      await alice.ctx.close();
      await bob.ctx.close();
    }
  });

  test('Scenario I: Message submission idempotency with real backend -> exact client_message_id retry returns 200 OK, single DB record, single UI message, conflicting returns 409', async ({ browser }) => {
    test.setTimeout(60000);
    const testRun = Date.now().toString().slice(-6) + Math.floor(Math.random() * 100);
    const aliceEmail = `alice_i_${testRun}@example.com`;
    const aliceUsername = `alice_i_${testRun}`;

    executeSafeTruncation(
      'TRUNCATE TABLE discussion_reactions, discussion_messages CASCADE;',
      () => runPsql('SELECT current_database();'),
      (sql) => runPsql(sql)
    );

    const alice = await setupUser(browser, aliceEmail, aliceUsername);

    try {
      const clientMessageId = '11111111-2222-3333-4444-' + Date.now().toString().slice(-12).padStart(12, '0');
      const msgContent = `Idempotent message [${testRun}]`;

      // 1. Initial creation
      const res1 = await postMessageAsUser(alice.page, {
        client_message_id: clientMessageId,
        kind: 'TEXT',
        content: msgContent,
      });
      expect(res1.status).toBe(201);
      expect(res1.data.content).toBe(msgContent);

      // 2. Exact identical replay
      const res2 = await postMessageAsUser(alice.page, {
        client_message_id: clientMessageId,
        kind: 'TEXT',
        content: msgContent,
      });
      expect(res2.status).toBe(200);
      expect(res2.data.id).toBe(res1.data.id);

      // 3. PostgreSQL record count is strictly 1
      const count = runPsql(`SELECT count(*) FROM discussion_messages WHERE client_message_id='${clientMessageId}';`);
      expect(count).toBe('1');

      // 4. Conflicting reuse with different content returns 409 Conflict
      const res3 = await postMessageAsUser(alice.page, {
        client_message_id: clientMessageId,
        kind: 'TEXT',
        content: `Conflicting message [${testRun}]`,
      });
      expect(res3.status).toBe(409);
      expect(res3.data.detail).toContain('already exists with different content');

      // 5. Alice opens Discussion page: single message rendered in UI
      await alice.page.goto('/communities/irm/discussion');
      await expect(alice.page.getByRole('heading', { level: 1, name: 'General Discussion' })).toBeVisible();
      await expect(alice.page.getByText('Live', { exact: true })).toBeVisible({ timeout: 10000 });

      await expect(alice.page.getByText(msgContent)).toBeVisible();
      await expect(alice.page.getByText(`Conflicting message [${testRun}]`)).not.toBeVisible();

      const renderedCount = await alice.page.locator(`text=${msgContent}`).count();
      expect(renderedCount).toBe(1);
    } finally {
      await alice.ctx.close();
    }
  });
});
