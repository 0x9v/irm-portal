import { test, expect, Page, WebSocketRoute } from './moderation-fixtures';

const id = '00000000-0000-4000-8000-000000000001';
const replyId = '00000000-0000-4000-8000-000000000002';
const memberId = '00000000-0000-4000-8000-000000000003';
const date = '2026-10-10T10:00:00Z';
const user = { id: 'actor', username: 'delegate', email: 'private@example.invalid', first_name: 'Acting', family_name: 'Delegate' };
const post = { id, title: 'Community notice', content: 'Visible parent body', excerpt: 'Visible parent body', author_username: 'student', created_at: date, updated_at: date, modules: [] };
const reply = { id: replyId, post_id: id, announcement_id: id, content: 'Visible reply body', author_username: 'student', created_at: date };
const message = { id, kind: 'TEXT', content: 'Visible discussion message', sticker_id: null, author_username: 'student', created_at: date, reactions: [{ emoji: 'heart', count: 1 }], caller_reaction: null };
const members = [
  { id: 'actor-membership', status: 'ACTIVE', role: 'DELEGATE', username: 'delegate', created_at: date, updated_at: date },
  { id: memberId, status: 'ACTIVE', role: 'MEMBER', username: 'ordinary_member', created_at: date, updated_at: date },
];
async function fixture(page: Page, role = 'DELEGATE', status = 'ACTIVE') {
  const state = {
    role, status, guest: false, authRequests: 0, membershipFailure: false,
    mutations: [] as { path: string; method: string }[], outcome: 204 as number | 'network',
    waitMutation: null as null | Promise<void>, historyWait: null as null | Promise<void>,
    reactionWait: null as null | Promise<void>, socket: null as WebSocketRoute | null,
    parentRemoved: false, replyRemoved: false, memberRemoved: false,
    roster: members.map(member => ({ ...member })),
    permissions: { upload_official_documents: false, create_announcements: false, manage_document_voting: false },
    pending: [{ id: replyId, status: 'PENDING', role: 'MEMBER', username: 'applicant', first_name: 'Synthetic', family_name: 'Applicant', cne: 'FIXTURE-CNE', created_at: date, updated_at: date }],
  };
  const headers = { 'Access-Control-Allow-Origin': process.env.IRM_ACCEPTANCE_FRONTEND || 'http://127.0.0.1:3128', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
  // Fail closed: no API request or WebSocket ever reaches a real backend.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (data: unknown, responseStatus = 200) => route.fulfill({ status: responseStatus, json: data, headers });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/api/v1/auth/me') { state.authRequests++; return json(user, state.guest ? 401 : 200); }
    if (path === '/api/v1/communities/irm/membership/me') return json({ membership: { id: 'actor-membership', role: state.role, status: state.status }, capabilities: { create_announcements: false, manage_document_voting: false, upload_official_documents: false } }, state.membershipFailure ? 500 : 200);
    if (path.endsWith('/reaction')) {
      if (state.reactionWait) await state.reactionWait;
      return json({ message_id: id, reactions: [{ emoji: 'heart', count: 2 }], caller_reaction: 'heart' });
    }
    if (path.endsWith('/permissions')) {
      if (method === 'PATCH') state.permissions = route.request().postDataJSON();
      return json(state.permissions);
    }
    if (path.endsWith('/role') && method === 'PATCH') {
      const target = state.roster.find(member => path.includes(member.id))!;
      target.role = route.request().postDataJSON().role;
      return json(target);
    }
    if (method === 'POST' && (path.endsWith('/approve') || path.endsWith('/reject'))) {
      state.pending = [];
      return json({ id: replyId, status: path.endsWith('/approve') ? 'ACTIVE' : 'REJECTED', role: 'MEMBER' });
    }
    if (method !== 'GET') {
      state.mutations.push({ path, method });
      if (state.waitMutation) await state.waitMutation;
      if (state.outcome === 'network') return route.abort('failed');
      if (state.outcome !== 204) return json({ detail: 'Synthetic refusal' }, state.outcome);
      if (path.endsWith('/membership')) state.status = 'PENDING';
      else if (path.includes('/replies/')) state.replyRemoved = true;
      else if (path.includes('/memberships/')) state.memberRemoved = true;
      else state.parentRemoved = true;
      return route.fulfill({ status: 204, headers });
    }
    if (path.endsWith('/modules')) return json([]);
    if (path.endsWith('/membership/active')) return json(state.memberRemoved ? [state.roster[0]] : state.roster);
    if (path.endsWith('/membership/pending')) return json(state.pending);
    if (path.endsWith('/discussion/stickers')) return json([]);
    if (path.endsWith('/discussion/messages')) {
      if (state.historyWait) await state.historyWait;
      return json({ items: state.parentRemoved ? [] : [message], older_cursor: null, newer_cursor: null, has_more_older: false, has_more_newer: false });
    }
    if (path.endsWith('/replies')) return json({ items: state.replyRemoved ? [] : [reply], next_cursor: null });
    if (path.endsWith(`/posts/${id}`) || path.endsWith(`/announcements/${id}`)) return state.parentRemoved ? json({ detail: 'Unavailable' }, 404) : json(post);
    if (path.endsWith('/posts')) return json({ items: state.parentRemoved ? [] : [post], next_cursor: null });
    if (path.endsWith('/announcements')) return json(state.parentRemoved ? [] : [post]);
    return route.abort();
  });
  await page.routeWebSocket(/.*/, socket => { state.socket = socket; });
  return state;
}
const cases = [
  { name: 'post', page: '/communities/irm/posts', label: 'Remove post', path: `/posts/${id}`, hidden: 'Visible parent body' },
  { name: 'announcement', page: '/communities/irm/announcements', label: 'Remove announcement', path: `/announcements/${id}`, hidden: 'Visible parent body' },
  { name: 'post reply', page: `/communities/irm/posts/${id}`, label: 'Remove reply', path: `/posts/${id}/replies/${replyId}`, hidden: 'Visible reply body' },
  { name: 'announcement reply', page: `/communities/irm/announcements/${id}`, label: 'Remove reply', path: `/announcements/${id}/replies/${replyId}`, hidden: 'Visible reply body' },
  { name: 'message', page: '/communities/irm/discussion', label: 'Remove message', path: `/discussion/messages/${id}`, hidden: 'Visible discussion message' },
  { name: 'member', page: '/communities/irm/membership/staff', label: 'Remove member', path: `/memberships/${memberId}`, hidden: '@ordinary_member' },
  { name: 'ban', page: '/communities/irm/membership/staff', label: 'Ban member', path: `/memberships/${memberId}/ban`, hidden: '@ordinary_member' },
];
for (const entry of cases) test(`${entry.name}: cancel, explicit route, 204 and reconciliation`, async ({ page }) => {
  const state = await fixture(page); await page.goto(entry.page);
  const isAnnouncement = entry.name === 'announcement' || entry.name === 'announcement reply';
  const trigger = entry.name === 'message'
    ? page.locator(`[data-message-id="${id}"]`).getByRole('button', { name: /Actions for message/ })
    : isAnnouncement ? page.getByRole('button', { name: entry.name === 'announcement' ? /Actions for Community notice/ : /Actions for Reply by/ }).first()
    : page.getByRole('button', { name: entry.label, exact: true });
  const openConfirmation = async () => {
    await trigger.click();
    if (entry.name === 'message' || isAnnouncement) await page.getByRole('button', { name: entry.label, exact: true }).click();
  };
  await openConfirmation(); let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(state.mutations).toEqual([]); await expect(trigger).toBeFocused();
  await openConfirmation(); dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: entry.label, exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByText(entry.hidden, { exact: entry.name !== "member" && entry.name !== "ban" })).toHaveCount(0);
  expect(state.mutations).toEqual([{ path: `/api/v1/communities/irm${entry.path}`, method: entry.name === 'ban' ? 'PUT' : 'DELETE' }]);
});
for (const role of ['MEMBER', 'MODERATOR', 'guest', 'loading', 'error']) test(`${role}: no management controls`, async ({ page }) => {
  const state = await fixture(page, role); state.guest = role === 'guest'; state.membershipFailure = role === 'error';
  if (role === 'loading') await page.route('**/membership/me', route => new Promise<void>(resolve => { page.once('close', () => { void route.abort(); resolve(); }); }));
  await page.goto('/communities/irm/posts');
  if (role === 'MEMBER' || role === 'MODERATOR') await expect(page.getByText('Visible parent body')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove post', exact: true })).toHaveCount(0);
});
test('pending duplicate-click guard preserves content until success', async ({ page }) => {
  const state = await fixture(page); let release!: () => void; state.waitMutation = new Promise(resolve => { release = resolve; });
  await page.goto('/communities/irm/posts'); await page.getByRole('button', { name: 'Remove post', exact: true }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Remove post', exact: true }); await confirm.click();
  await expect(confirm).toBeDisabled(); await expect(page.getByText('Visible parent body')).toBeVisible();
  await expect.poll(() => state.mutations.length).toBe(1); release(); await expect(page.getByRole('dialog')).not.toBeVisible();
});
for (const outcome of ['network', 500, 404, 401, 403] as const) test(`${outcome}: result handling`, async ({ page }) => {
  const state = await fixture(page); state.outcome = outcome;
  await page.goto('/communities/irm/posts'); await page.getByRole('button', { name: 'Remove post', exact: true }).click();
  const previousAuthRequests = state.authRequests;
  if (outcome === 401 || outcome === 403) state.role = 'MEMBER';
  await page.getByRole('dialog').getByRole('button', { name: 'Remove post', exact: true }).click();
  if (outcome === 'network' || outcome === 500) {
    await expect(page.getByRole('dialog')).toContainText('outcome could not be confirmed');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Refresh and check' })).toBeVisible();
    await expect(page.getByText('Visible parent body')).toBeVisible(); expect(state.mutations).toHaveLength(1);
  } else if (outcome === 404) await expect(page.getByText('Visible parent body')).toHaveCount(0);
  else { await expect.poll(() => state.authRequests).toBeGreaterThan(previousAuthRequests); await expect(page.getByRole('button', { name: 'Remove post', exact: true })).toHaveCount(0); }
});
test('409 protects leadership/state and does not remove member row', async ({ page }) => {
  const state = await fixture(page); state.outcome = 409; await page.goto('/communities/irm/membership/staff');
  await expect(page.getByRole('button', { name: 'Remove member', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Ban member', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Ban member', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('server protected this target'); await expect(page.getByText('@ordinary_member', { exact: false })).toBeVisible();
});
for (const parent of ['posts', 'announcements']) test(`${parent}: parent removal clears detail and replies`, async ({ page }) => {
  await fixture(page); await page.goto(`/communities/irm/${parent}/${id}`); await expect(page.getByText('Visible reply body')).toBeVisible();
  const label = parent === 'posts' ? 'Remove post' : 'Remove announcement';
  if (parent === 'announcements') await page.getByRole('button', { name: /Actions for Community notice/ }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('replies will also be hidden'); await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByText('Visible parent body')).toHaveCount(0); await expect(page.getByText('Visible reply body')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: parent === 'posts' ? 'Post Unavailable' : 'Resource Not Found' })).toBeVisible(); await expect(page.getByRole('main').getByRole('link', { name: parent === 'posts' ? /Return to Posts/ : /Back to/ })).toBeVisible();
});
test('discussion: scoped duplicate events suppress stale history/create/reaction', async ({ page }) => {
  const state = await fixture(page); await page.goto('/communities/irm/discussion'); await expect(page.getByText(message.content)).toBeVisible();
  const row = page.locator(`[data-message-id="${id}"]`);
  let releaseReaction!: () => void; state.reactionWait = new Promise(resolve => { releaseReaction = resolve; });
  await row.getByRole('button', { name: /Heart, count/ }).click();
  state.socket!.send(JSON.stringify({ type: 'message_removed', community_slug: 'foreign', message_id: id })); await expect(row).toBeVisible();
  let releaseHistory!: () => void; state.historyWait = new Promise(resolve => { releaseHistory = resolve; });
  await page.getByRole('button', { name: 'Refresh discussion history' }).click();
  state.socket!.send(JSON.stringify({ type: 'message_removed', community_slug: 'irm', message_id: id }));
  state.socket!.send(JSON.stringify({ type: 'message_removed', community_slug: 'irm', message_id: id }));
  releaseReaction(); releaseHistory(); state.socket!.send(JSON.stringify({ type: 'message_created', message })); await expect(row).toHaveCount(0);
});
test('discussion removal unmounts an open reaction picker', async ({ page }) => {
  const state = await fixture(page); await page.goto('/communities/irm/discussion');
  await page.locator(`[data-message-id="${id}"]`).getByRole('button', { name: 'Add reaction' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a reaction' })).toBeVisible();
  state.socket!.send(JSON.stringify({ type: 'message_removed', community_slug: 'irm', message_id: id }));
  await expect(page.getByRole('dialog', { name: 'Choose a reaction' })).toHaveCount(0);
});
for (const status of ['REMOVED', 'BANNED', 'FUTURE']) test(`${status}: membership guidance and application eligibility`, async ({ page }) => {
  await fixture(page, 'MEMBER', status); await page.goto('/account#community-membership');
  if (status === 'REMOVED') { await expect(page.getByRole('button', { name: 'Reapply for membership' })).toBeVisible(); await expect(page.getByText(/account remains available/)).toBeVisible(); }
  else { await expect(page.getByLabel('Student CNE')).toHaveCount(0); await expect(page.getByRole('main').getByRole('link', { name: 'Support', exact: true })).toBeVisible(); }
});
test('dialog keyboard containment, Escape and focus return', async ({ page }) => {
  await fixture(page); await page.goto('/communities/irm/posts'); const trigger = page.getByRole('button', { name: 'Remove post', exact: true }); await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog'); const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true }); await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Remove post', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(cancel).toBeFocused(); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
});
for (const width of [320, 390, 768, 1440]) for (const dark of [false, true]) test(`${width} ${dark ? 'dark' : 'light'}: content/member controls and dialogs fit`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await fixture(page);
  for (const entry of [cases[0], cases[1], cases[2], cases[3], cases[4], cases[5]]) {
    await page.goto(entry.page); const trigger = entry.name === 'message'
      ? page.locator(`[data-message-id="${id}"]`).getByRole('button', { name: /Actions for message/ })
      : page.getByRole('button', { name: entry.label, exact: true }); await expect(trigger).toBeVisible();
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44); await trigger.click();
    if (entry.name === 'message') await page.getByRole('button', { name: 'Remove message', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    const bounds = (await dialog.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});

test('REMOVED reapplication uses existing application route and becomes PENDING', async ({ page }) => {
  const state = await fixture(page, 'MEMBER', 'REMOVED'); await page.goto('/account#community-membership');
  await page.getByLabel('Student CNE').fill('FIXTURE-CNE'); await page.getByRole('button', { name: 'Reapply for membership' }).click();
  await expect(page.getByText('PENDING', { exact: true })).toBeVisible();
  expect(state.mutations).toEqual([{ path: '/api/v1/communities/irm/membership', method: 'POST' }]);
});
test('existing staff role and permission workflows remain connected', async ({ page }) => {
  const state = await fixture(page); await page.goto('/communities/irm/membership/staff');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Make Moderator' }).click();
  await page.getByRole('button', { name: 'Manage permissions', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Create announcements').check();
  await dialog.getByRole('button', { name: 'Save Permissions' }).click();
  await expect(page.getByText('Permissions saved successfully.')).toBeVisible(); expect(state.permissions.create_announcements).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  page.once('dialog', native => native.accept()); await page.getByRole('button', { name: 'Return to Member', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make Moderator' })).toBeVisible();
});
test('existing pending application approval/rejection workflows remain connected', async ({ page }) => {
  const state = await fixture(page); await page.goto('/communities/irm/membership/review');
  await page.getByRole('button', { name: /Approve/, exact: false }).click();
  await expect(page.getByText(/Resulting status: ACTIVE, role: MEMBER/)).toBeVisible();
  state.pending = [{ id: replyId, status: 'PENDING', role: 'MEMBER', username: 'applicant', first_name: 'Synthetic', family_name: 'Applicant', cne: 'FIXTURE-CNE', created_at: date, updated_at: date }];
  await page.reload(); await page.getByRole('button', { name: /Reject/, exact: false }).click();
  await expect(page.getByText(/Resulting status: REJECTED, role: MEMBER/)).toBeVisible();
});
