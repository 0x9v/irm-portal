import { test, expect, Browser, Page, APIResponse, Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type Actor = { id: string; username: string; email: string; password: string; membership_id: string; document_id?: string };
const manifest = JSON.parse(readFileSync(process.env.IRM_ACCEPTANCE_MANIFEST!, 'utf8')) as {
  api: string; frontend: string; run_id: string; actors: Record<string, Actor>;
};
if (manifest.run_id !== process.env.IRM_ACCEPTANCE_RUN_ID || manifest.api !== process.env.IRM_ACCEPTANCE_API ||
    manifest.frontend !== process.env.IRM_ACCEPTANCE_FRONTEND) throw new Error('Test manifest identity mismatch');
const base = manifest.api + '/api/v1/communities/irm';
const directory = '/communities/irm/membership/members';
async function revealActions(row: Locator) {
  const disclosure = row.locator('details');
  if (!(await disclosure.evaluate(element => (element as HTMLDetailsElement).open))) await disclosure.locator('summary').click();
  return disclosure;
}
async function body(response: APIResponse, status = 200) {
  expect(response.status()).toBe(status);
  return response.json();
}
async function empty(response: APIResponse) {
  expect(response.status()).toBe(204);
  expect((await response.body()).length).toBe(0);
}
async function login(browser: Browser, role: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const actor = manifest.actors[role];
  // Test-only endpoint verifies both live factories before browser mutation.
  const identity = await body(await context.request.get(manifest.api + '/__acceptance__/identity', { headers: { 'X-Acceptance-Run': manifest.run_id } }));
  expect(identity.same_factory).toBe(true);
  expect(identity.rest.schema).toBe(process.env.IRM_ACCEPTANCE_SCHEMA);
  expect(identity.websocket.schema).toBe(identity.rest.schema);
  await page.goto(manifest.frontend + '/login');
  await page.getByLabel('Email', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill(actor.password);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/\/communities\/irm\/membership$/);
  return { context, page, actor };
}
async function confirm(page: Page, trigger: Locator, label: string, endpoint: string) {
  let mutations = 0;
  const watch = (request: { url(): string; method(): string }) => {
    if (request.url() === endpoint && request.method() !== 'GET' && request.method() !== 'OPTIONS') mutations++;
  };
  page.on('request', watch);
  try {
    await trigger.click();
    const dialog = page.getByRole('dialog');
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(mutations).toBe(0);
    await trigger.click(); await cancel.click();
    await expect(trigger).toBeFocused(); expect(mutations).toBe(0);
    await trigger.click();
    const response = page.waitForResponse(r => r.url() === endpoint && r.request().method() !== 'OPTIONS');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(204); expect((await result.body()).length).toBe(0);
    await expect(dialog).toHaveCount(0); expect(mutations).toBe(1);
  } finally { page.off('request', watch); }
}

for (const kind of ['posts', 'announcements'] as const) for (const reply of [false, true]) {
  test(`real ${kind}${reply ? ' reply' : ' parent'}: cancellation/204/preservation/fresh reads`, async ({ browser }) => {
    const delegate = await login(browser, 'delegate'); const member = await login(browser, 'member');
    try {
      const text = `Synthetic ${kind} ${randomUUID()}`;
      const parent = await body(await (kind === 'posts' ? member : delegate).context.request.post(`${base}/${kind}`, { data: { title: text, content: text } }), 201);
      const endpoint = `${base}/${kind}/${parent.id}`;
      const first = await body(await member.context.request.post(endpoint + '/replies', { data: { content: text + ' first' } }), 201);
      const sibling = await body(await member.context.request.post(endpoint + '/replies', { data: { content: text + ' sibling' } }), 201);
      const href = `/communities/irm/${kind}/${parent.id}`;
      await delegate.page.goto(href); await member.page.goto(href);
      const label = reply ? 'Remove reply' : kind === 'posts' ? 'Remove post' : 'Remove announcement';
      await expect(member.page.getByRole('button', { name: /Remove (post|announcement|reply)/ })).toHaveCount(0);
      const trigger = reply ? delegate.page.getByRole('button', { name: label, exact: true }).first() : delegate.page.getByRole('button', { name: label, exact: true });
      const target = reply ? endpoint + '/replies/' + first.id : endpoint;
      await confirm(delegate.page, trigger, label, target);
      await expect(delegate.page.getByText(text + ' first', { exact: true })).toHaveCount(0);
      await empty(await delegate.context.request.delete(target));
      if (reply) {
        await body(await member.context.request.get(endpoint));
        const remaining = await body(await member.context.request.get(endpoint + '/replies'));
        expect(remaining.items.map((r: { id: string }) => r.id)).toContain(sibling.id);
        expect(remaining.items.map((r: { id: string }) => r.id)).not.toContain(first.id);
        await expect(delegate.page.getByText(text + ' sibling', { exact: true })).toBeVisible();
      } else {
        expect((await member.context.request.get(endpoint)).status()).toBe(404);
        expect((await member.context.request.get(endpoint + '/replies')).status()).toBe(404);
        expect((await member.context.request.post(endpoint + '/replies', { data: { content: 'Synthetic blocked reply' } })).status()).toBe(404);
      }
      await member.page.reload(); await expect(member.page.getByText(text + ' first', { exact: true })).toHaveCount(0);
    } finally { await delegate.context.close(); await member.context.close(); }
  });
}

test('real discussion: live removal, pending picker, reload and reconnect', async ({ browser }) => {
  const delegate = await login(browser, 'delegate'); const member = await login(browser, 'member');
  try {
    await member.page.goto('/communities/irm/discussion'); await delegate.page.goto('/communities/irm/discussion');
    const text = 'Synthetic discussion '+randomUUID();
    const message = await body(await member.context.request.post(base+'/discussion/messages', { data: { client_message_id: randomUUID(), kind: 'TEXT', content: text } }), 201);
    const row = member.page.locator(`[data-message-id="${message.id}"]`);
    await expect(row).toBeVisible(); await row.getByRole('button', { name: 'Add reaction' }).click();
    await expect(member.page.getByRole('dialog', { name: 'Choose a reaction' })).toBeVisible();
    await confirm(delegate.page, delegate.page.locator(`[data-message-id="${message.id}"]`).getByRole('button', { name: 'Remove message', exact: true }), 'Remove message', base+'/discussion/messages/'+message.id);
    await expect(row).toHaveCount(0); await expect(member.page.getByRole('dialog', { name: 'Choose a reaction' })).toHaveCount(0);
    await empty(await delegate.context.request.delete(base+'/discussion/messages/'+message.id));
    for (let reconnect = 0; reconnect < 2; reconnect++) {
      await member.page.reload(); await expect(row).toHaveCount(0);
      const history = await body(await member.context.request.get(base+'/discussion/messages'));
      expect(history.items.map((item: { id: string }) => item.id)).not.toContain(message.id);
    }
  } finally { await delegate.context.close(); await member.context.close(); }
});

for (const persona of ['member', 'moderator']) test(`real ${persona}: directory and mutations denied`, async ({ browser }) => {
  const actor = await login(browser, persona);
  try {
    await actor.page.goto(directory);
    await expect(actor.page.getByRole('region', { name: 'Membership directory' })).toHaveCount(0);
    await expect(actor.page.getByRole('button', { name: /^(Remove member|Ban member|Unban member)$/ })).toHaveCount(0);
    expect((await actor.context.request.get(base+'/memberships')).status()).toBe(403);
    expect((await actor.context.request.delete(base+'/memberships/'+manifest.actors.remove_target.membership_id)).status()).toBe(403);
  } finally { await actor.context.close(); }
});
test('real guest: direct directory entry has no records', async ({ page }) => {
  await page.goto(directory); await expect(page.getByRole('region', { name: 'Membership directory' })).toHaveCount(0);
});

for (const action of ['remove', 'ban'] as const) test(`real ${action}/Unban: directory authoritative lifecycle and data preservation`, async ({ browser }) => {
  const delegate = await login(browser, 'delegate'); const target = await login(browser, action+'_target');
  try {
    const contribution = await body(await target.context.request.post(base+'/posts', { data: { title: 'Preserved synthetic '+action, content: 'Synthetic contribution preserved' } }), 201);
    await delegate.page.goto(directory);
    const row = delegate.page.locator('section[aria-label="Membership directory"] li').filter({ hasText: '@'+target.actor.username });
    const label = action === 'remove' ? 'Remove member' : 'Ban member';
    await revealActions(row);
    await confirm(delegate.page, row.getByRole('button', { name: label, exact: true }), label, base+'/memberships/'+target.actor.membership_id+(action === 'ban' ? '/ban' : ''));
    expect((await target.context.request.get(manifest.api+'/api/v1/auth/me')).status()).toBe(200);
    expect((await target.context.request.get(base+'/posts')).status()).toBe(403);
    await body(await delegate.context.request.get(base+'/posts/'+contribution.id));
    expect((await target.context.request.get(manifest.api+'/api/v1/documents/'+target.actor.document_id+'/preview')).status()).toBe(200);
    if (action === 'ban') {
      expect((await target.context.request.post(base+'/membership', { data: { cne: 'ACC_REAPPLY_'+randomUUID() } })).status()).toBe(403);
      await delegate.page.getByLabel('Membership status').selectOption('BANNED');
      await expect(row).toContainText('Status: BANNED');
      await revealActions(row);
      const trigger = row.getByRole('button', { name: 'Unban member', exact: true });
      await trigger.click(); await expect(delegate.page.getByRole('dialog')).toContainText(/apply to IRM again/);
      await expect(delegate.page.getByRole('dialog')).toContainText(/not reactivated or approved/);
      await delegate.page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      const before = await body(await delegate.context.request.get(base+'/memberships?status=BANNED'));
      expect(before.items.map((item: { id: string }) => item.id)).toContain(target.actor.membership_id);
      await confirm(delegate.page, trigger, 'Unban member', base+'/memberships/'+target.actor.membership_id+'/ban');
      await expect(row).toHaveCount(0);
    }
    await delegate.page.getByLabel('Membership status').selectOption('REMOVED'); await expect(row).toContainText('Status: REMOVED');
    expect((await target.context.request.get(base+'/posts')).status()).toBe(403);
    const request = await body(await target.context.request.post(base+'/membership', { data: { cne: 'ACC_REAPPLY_'+randomUUID() } }), 201);
    expect(request.status).toBe('PENDING'); expect(request.role).toBe('MEMBER');
    const me = await body(await target.context.request.get(base+'/membership/me'));
    expect(Object.values(me.capabilities).every(value => value === false)).toBe(true);
    // Reopening never restores the old Moderator grants.
    await delegate.page.getByLabel('Membership status').selectOption('PENDING'); await expect(row).toContainText('Role: MEMBER');
  } finally { await delegate.context.close(); await target.context.close(); }
});

for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) test(`rendered ${width}px ${theme}: directory, banned, dialog, Staff and content`, async ({ browser }, info) => {
  const delegate = await login(browser, 'delegate');
  try {
    await delegate.page.setViewportSize({ width, height: 900 });
    await delegate.page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
    await delegate.page.goto(directory);
    await expect(delegate.page.locator('html')).toHaveAttribute('data-theme', theme);
    const check = async (surface: string) => {
      expect(await delegate.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const file = path.join(process.env.IRM_ACCEPTANCE_EVIDENCE!, `${width}-${theme}-${surface}.png`);
      await delegate.page.screenshot({ path: file, fullPage: true }); await info.attach(surface, { path: file, contentType: 'image/png' });
    };
    await expect(delegate.page.getByText('@'+manifest.actors.long_member.username, { exact: true })).toBeVisible();
    await check('directory');
    await revealActions(delegate.page.getByRole('region', { name: 'Membership directory' }).locator('li').filter({ hasText: '@'+manifest.actors.long_member.username }));
    const trigger = delegate.page.getByRole('button', { name: 'Ban member', exact: true }).first();
    const box = await trigger.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
    await trigger.scrollIntoViewIfNeeded();
    const nav = delegate.page.getByRole('navigation', { name: 'Mobile bottom navigation' });
    if (await nav.isVisible()) {
      const target = await trigger.boundingBox(), bottom = await nav.boundingBox();
      expect(target!.y + target!.height).toBeLessThanOrEqual(bottom!.y);
    }
    await trigger.click();
    await expect(delegate.page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await check('dialog'); await delegate.page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    const longActor = manifest.actors.long_member;
    await empty(await delegate.context.request.put(base+'/memberships/'+longActor.membership_id+'/ban'));
    try {
      await delegate.page.getByLabel('Membership status').selectOption('BANNED');
      await expect(delegate.page.getByText('@'+longActor.username, { exact: true })).toBeVisible();
      await check('banned');
      await revealActions(delegate.page.getByRole('region', { name: 'Membership directory' }).locator('li').filter({ hasText: '@'+longActor.username }));
      await delegate.page.getByRole('button', { name: 'Unban member', exact: true }).click();
      await check('unban-dialog'); await delegate.page.keyboard.press('Escape');
    } finally {
      await empty(await delegate.context.request.delete(base+'/memberships/'+longActor.membership_id+'/ban'));
      const returning = await browser.newContext();
      try {
        await body(await returning.request.post(manifest.api+'/api/v1/auth/login', { data: { email: longActor.email, password: longActor.password } }));
        await body(await returning.request.post(base+'/membership', { data: { cne: 'LAYOUT_'+randomUUID() } }), 201);
        await body(await delegate.context.request.post(base+'/membership/'+longActor.membership_id+'/approve'));
      } finally { await returning.close(); }
    }
    await delegate.page.goto('/communities/irm/membership/staff'); await check('staff');
    const parent = await body(await delegate.context.request.post(base+'/posts', { data: { title: 'Synthetic layout '+randomUUID(), content: 'Synthetic responsive controls' } }), 201);
    await delegate.page.goto('/communities/irm/posts/'+parent.id);
    await expect(delegate.page.getByRole('button', { name: 'Remove post', exact: true })).toBeVisible(); await check('content');
  } finally { await delegate.context.close(); }
});

// Dedicated accounts created via supported workflows; these never refer to an owner record.
test('real all six filters, Banned empty/page boundary, refresh and foreign/self protection', async ({ browser }) => {
  test.setTimeout(180000);
  const delegate = await login(browser, 'delegate');
  const created: string[] = [];
  try {
    await delegate.page.goto(directory);
    await delegate.page.getByLabel('Membership status').selectOption('BANNED');
    await expect(delegate.page.getByText('No banned memberships found.', { exact: true })).toBeVisible();
    for (let index = 0; index < 21; index++) {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const context = await browser.newContext();
      try {
        const email = 'page_'+suffix+'@example.com', password = randomUUID()+'Aa1!';
        await body(await context.request.post(manifest.api+'/api/v1/auth/register', { data: { username: 'page_'+suffix, email, password, first_name: 'Synthetic', family_name: 'Pagination' } }), 201);
        await body(await context.request.post(manifest.api+'/api/v1/auth/login', { data: { email, password } }));
        const membership = await body(await context.request.post(base+'/membership', { data: { cne: 'PAGE_'+suffix } }), 201);
        created.push(membership.id);
        await empty(await delegate.context.request.put(base+'/memberships/'+membership.id+'/ban'));
      } finally { await context.close(); }
    }
    const region = delegate.page.locator('section[aria-label="Membership directory"]');
    await delegate.page.getByRole('button', { name: 'Refresh directory', exact: true }).click();
    await expect(region.locator('li')).toHaveCount(20);
    await delegate.page.getByRole('button', { name: 'Load More', exact: true }).click();
    await expect(region.locator('li')).toHaveCount(21);
    await expect(delegate.page.getByRole('button', { name: 'Load More', exact: true })).toHaveCount(0);
    for (const status of ['ALL', 'ACTIVE', 'PENDING', 'REJECTED', 'REMOVED', 'BANNED']) {
      const expected = await body(await delegate.context.request.get(base+'/memberships?limit=20'+(status === 'ALL' ? '' : '&status='+status)));
      await delegate.page.getByLabel('Membership status').selectOption(status);
      await expect(region.locator('li')).toHaveCount(expected.items.length);
      for (const item of expected.items) await expect(region).toContainText('@'+item.username);
      if (status !== 'ALL') for (const item of expected.items) expect(item.status).toBe(status);
    }
    expect((await delegate.context.request.delete(base+'/memberships/'+delegate.actor.membership_id)).status()).toBe(409);
    expect((await delegate.context.request.put(base+'/memberships/'+delegate.actor.membership_id+'/ban')).status()).toBe(409);
    expect((await delegate.context.request.delete(base+'/memberships/'+manifest.actors.foreign_member.membership_id)).status()).toBe(404);
  } finally {
    // Keep later screenshots' Banned state deterministic and empty.
    for (const id of created) await empty(await delegate.context.request.delete(base+'/memberships/'+id+'/ban'));
    await delegate.context.close();
  }
});

test('real Staff permissions remain functional', async ({ browser }) => {
  const delegate = await login(browser, 'delegate');
  try {
    await delegate.page.goto('/communities/irm/membership/staff');
    const row = delegate.page.getByText('(@'+manifest.actors.moderator.username+')', { exact: true }).locator('xpath=../../..');
    await row.getByRole('button', { name: 'Manage permissions', exact: true }).click();
    const dialog = delegate.page.getByRole('dialog');
    await dialog.getByLabel('Create announcements').uncheck();
    await dialog.getByRole('button', { name: 'Save Permissions', exact: true }).click();
    const endpoint = base+'/membership/'+manifest.actors.moderator.membership_id+'/permissions';
    await expect.poll(async () => (await body(await delegate.context.request.get(endpoint))).create_announcements).toBe(false);
    await row.getByRole('button', { name: 'Manage permissions', exact: true }).click();
    await dialog.getByLabel('Create announcements').check();
    await dialog.getByRole('button', { name: 'Save Permissions', exact: true }).click();
    await expect.poll(async () => (await body(await delegate.context.request.get(endpoint))).create_announcements).toBe(true);
  } finally { await delegate.context.close(); }
});

test('real forwarded history/reaction responses held across removal cannot resurrect it', async ({ browser }) => {
  const delegate = await login(browser, 'delegate'); const member = await login(browser, 'member');
  let releaseHistory!: () => void, releaseReaction!: () => void;
  const historyHeld = new Promise<void>(resolve => { releaseHistory = resolve; });
  const reactionHeld = new Promise<void>(resolve => { releaseReaction = resolve; });
  let historyCaptured!: () => void, reactionCaptured!: () => void;
  const historyReady = new Promise<void>(resolve => { historyCaptured = resolve; });
  const reactionReady = new Promise<void>(resolve => { reactionCaptured = resolve; });
  try {
    const message = await body(await member.context.request.post(base+'/discussion/messages', { data: { client_message_id: randomUUID(), kind: 'TEXT', content: 'Synthetic delayed '+randomUUID() } }), 201);
    await body(await member.context.request.put(base+'/discussion/messages/'+message.id+'/reaction', { data: { emoji: 'heart' } }));
    await delegate.page.goto('/communities/irm/discussion'); await member.page.goto('/communities/irm/discussion');
    const row = member.page.locator(`[data-message-id="${message.id}"]`); await expect(row).toBeVisible();
    await member.page.route('**/discussion/messages/'+message.id+'/reaction', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      reactionCaptured(); await reactionHeld; await route.fulfill({ response });
    });
    await row.getByRole('button', { name: /Heart, count/ }).click(); await reactionReady;
    await member.page.route('**/discussion/messages?*', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      const data = await response.json(); expect(data.items.map((item: { id: string }) => item.id)).toContain(message.id);
      historyCaptured(); await historyHeld; await route.fulfill({ response });
    });
    await member.page.getByRole('button', { name: 'Refresh discussion history', exact: true }).click(); await historyReady;
    await confirm(delegate.page, delegate.page.locator(`[data-message-id="${message.id}"]`).getByRole('button', { name: 'Remove message', exact: true }), 'Remove message', base+'/discussion/messages/'+message.id);
    const historyDone = member.page.waitForResponse(r => r.url().includes('/discussion/messages?'));
    const reactionDone = member.page.waitForResponse(r => r.url().endsWith('/'+message.id+'/reaction'));
    releaseHistory(); releaseReaction(); await Promise.all([historyDone, reactionDone]);
    await expect(row).toHaveCount(0);
    await member.page.unrouteAll({ behavior: 'wait' });
    await member.page.reload(); await expect(row).toHaveCount(0);
  } finally {
    releaseHistory(); releaseReaction();
    await member.context.close(); await delegate.context.close();
  }
});

test('real observed member access loss clears discussion records, draft and picker', async ({ browser }) => {
  const delegate = await login(browser, 'delegate');
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const email = 'revoked_'+suffix+'@example.com', password = randomUUID()+'Aa1!';
    await body(await context.request.post(manifest.api+'/api/v1/auth/register', { data: { username: 'revoked_'+suffix, email, password, first_name: 'Synthetic', family_name: 'Revocation' } }), 201);
    await body(await context.request.post(manifest.api+'/api/v1/auth/login', { data: { email, password } }));
    const membership = await body(await context.request.post(base+'/membership', { data: { cne: 'REV_'+suffix } }), 201);
    await body(await delegate.context.request.post(base+'/membership/'+membership.id+'/approve'));
    const message = await body(await context.request.post(base+'/discussion/messages', { data: { client_message_id: randomUUID(), kind: 'TEXT', content: 'Synthetic access-loss record' } }), 201);
    await page.goto('/communities/irm/discussion');
    const row = page.locator(`[data-message-id="${message.id}"]`); await expect(row).toBeVisible();
    const entry = page.getByPlaceholder(/Write a message to the IRM community/);
    await entry.fill('Synthetic unsent draft'); await page.keyboard.press('Enter'); await page.keyboard.type('second line');
    await expect(entry).toHaveValue('Synthetic unsent draft\nsecond line');
    await row.getByRole('button', { name: 'Add reaction', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Choose a reaction' })).toBeVisible();
    await empty(await delegate.context.request.delete(base+'/memberships/'+membership.id));
    // Observe a real protected read denial; no artificial client auth state.
    await page.getByRole('button', { name: 'Refresh discussion history', exact: true }).click();
    await expect(row).toHaveCount(0); await expect(entry).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await context.request.get(manifest.api+'/api/v1/auth/me')).status()).toBe(200);
  } finally { await context.close(); await delegate.context.close(); }
});
