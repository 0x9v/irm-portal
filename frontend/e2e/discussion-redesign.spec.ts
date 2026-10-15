import { expect, test, type Page, type WebSocketRoute } from './moderation-fixtures';
import { mkdirSync } from 'node:fs';

const currentUserId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const incomingId = '10000000-0000-4000-8000-000000000001';
const ownId = '10000000-0000-4000-8000-000000000002';
const message = (id: string, author_id: string = otherUserId, content: string | null = 'A clear message') => ({
  id, kind: 'TEXT' as 'TEXT' | 'STICKER', content, sticker_id: null as string | null, author_id,
  author_username: author_id === currentUserId ? 'student' : 'classmate',
  created_at: '2026-10-12T12:30:00Z', reactions: [{ emoji: 'heart', count: 2 }], caller_reaction: null,
});

async function setup(page: Page, role = 'MEMBER', initial = [message(incomingId, otherUserId, 'Hello IRM\nSecond line'), message(ownId, currentUserId, 'My reply')], onSocket?: (socket: WebSocketRoute) => void, identity: { userId: string | null; username: string } = { userId: currentUserId, username: 'student' }) {
  await page.route('**/api/v1/**', route => route.abort());
  await page.route('**/api/v1/auth/me', route => identity.userId
    ? route.fulfill({ json: { id: identity.userId, username: identity.username, email: 'student@example.test' } })
    : route.fulfill({ status: 401, json: { detail: 'Not authenticated' } }));
  await page.route('**/api/v1/communities/irm/membership/me', route => identity.userId
    ? route.fulfill({ json: { membership: { id: '30000000-0000-4000-8000-000000000001', status: 'ACTIVE', role }, capabilities: {} } })
    : route.fulfill({ status: 401, json: { detail: 'Not authenticated' } }));
  await page.route('**/api/v1/communities/irm/discussion/stickers', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', route => route.fulfill({ json: {
    items: initial, older_cursor: null, has_more_older: false, newer_cursor: null, has_more_newer: false,
  } }));
  await page.routeWebSocket('**/api/v1/communities/irm/discussion/ws', socket => onSocket?.(socket));
}

test('message ownership uses IDs, keeps chronological order, and avoids a Live badge', async ({ page }) => {
  await setup(page, 'MEMBER', [
    { ...message(incomingId, otherUserId, 'Same username must not imply ownership'), author_username: 'student' },
    message(ownId, currentUserId, 'UUID-backed own message'),
  ]);
  await page.goto('/communities/irm/discussion');
  const rows = page.locator('[data-message-id]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('data-message-owner', 'other');
  await expect(rows.last()).toHaveAttribute('data-message-owner', 'current');
  await expect(page.locator(`article[data-message-id="${incomingId}"] time[title]`)).toHaveAttribute('datetime', '2026-10-12T12:30:00Z');
  await expect(page.getByRole('heading', { level: 1, name: 'IRM Discussion' })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Connected to discussion')).toBeAttached();
});

test('Delegate message actions disclose, dismiss, confirm, and reconcile', async ({ page }) => {
  await setup(page, 'DELEGATE');
  let removals = 0;
  await page.route(`**/api/v1/communities/irm/discussion/messages/${incomingId}`, route => {
    removals++;
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/communities/irm/discussion');
  const row = page.locator(`[data-message-id="${incomingId}"]`);
  const trigger = row.getByRole('button', { name: /Actions for message by @classmate/ });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: 'Remove message', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(removals).toBe(0);
  await trigger.click();
  await page.getByRole('button', { name: 'Remove message', exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove message', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(removals).toBe(1);
});

test('composer retains multiline and IME text, then shows UUID-backed ownership', async ({ page }) => {
  await setup(page);
  let sends = 0;
  await page.route('**/api/v1/communities/irm/discussion/messages', route => {
    sends++;
    return route.fulfill({ status: 201, json: message('10000000-0000-4000-8000-000000000003', currentUserId, 'First\nSecond') });
  });
  await page.goto('/communities/irm/discussion');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('First');
  await input.press('Enter');
  await input.type('Second');
  await expect(input).toHaveValue('First\nSecond');
  expect(sends).toBe(0);
  await input.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
  expect(sends).toBe(0);
  await input.press('Control+Enter');
  await expect(page.locator('[data-message-id="10000000-0000-4000-8000-000000000003"]')).toHaveAttribute('data-message-owner', 'current');
  expect(sends).toBe(1);
});

test('removal above the reader preserves the visible position', async ({ page }) => {
  let socket: WebSocketRoute | undefined;
  const ids = Array.from({ length: 45 }, (_, index) => `${String(index + 1).padStart(8, '0')}-0000-4000-8000-000000000000`);
  await setup(page, 'MEMBER', ids.map((id, index) => message(id, otherUserId, `Message ${index + 1}: ${'discussion content '.repeat(5)}`)), value => { socket = value; });
  await page.goto('/communities/irm/discussion');
  await expect(page.locator('[data-message-id]')).toHaveCount(ids.length);
  const log = page.getByRole('log', { name: 'Discussion message history' });
  await log.evaluate(element => { element.scrollTop = element.scrollHeight / 2; element.dispatchEvent(new Event('scroll')); });
  const anchor = await log.evaluate(element => {
    const top = element.getBoundingClientRect().top;
    const row = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.getBoundingClientRect().top >= top + 8);
    return { id: row?.dataset.messageId, y: row?.getBoundingClientRect().top };
  });
  expect(anchor.id).toBeTruthy();
  socket!.send(JSON.stringify({ type: 'message_removed', community_slug: 'irm', message_id: ids[0] }));
  await expect(page.locator(`[data-message-id="${ids[0]}"]`)).toHaveCount(0);
  const after = await page.locator(`[data-message-id="${anchor.id}"]`).boundingBox();
  expect(Math.abs(after!.y - anchor.y!)).toBeLessThan(3);
});

for (const width of [320, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`${width}px ${theme}: short-message reactions and picker remain visible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
    const contents = ['a', 'ok', '🙂', 'first line\nsecond line', 'Long content '.repeat(24)];
    const samples = contents.map((content, index) => message(`20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, index % 2 ? currentUserId : otherUserId, content));
    samples[4].reactions = ['heart', 'thumbs_up', 'laugh', 'surprised', 'sad', 'thanks'].map(emoji => ({ emoji, count: 2 }));
    samples.push(
      { ...message('20000000-0000-4000-8000-000000000006', otherUserId, 'No reactions yet'), reactions: [] },
      { ...message('20000000-0000-4000-8000-000000000007', currentUserId, 'My message without reactions'), reactions: [] },
    );
    const stickerId = '20000000-0000-4000-8000-000000000008';
    await setup(page, 'MEMBER', [...samples, { ...message(stickerId, otherUserId), kind: 'STICKER', content: null, sticker_id: 'pepe_thumbs_up' }]);
    await page.goto('/communities/irm/discussion');
    for (const sample of samples) {
      const row = page.locator(`[data-message-id="${sample.id}"]`);
      await row.scrollIntoViewIfNeeded();
      const chip = row.getByRole('button', { name: /Heart, count 2/ });
      if (sample.reactions.length) {
        await expect(chip).toBeVisible();
        const bounds = (await chip.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      } else {
        await expect(chip).toHaveCount(0);
      }
      const picker = row.getByRole('button', { name: 'Add reaction' });
      await expect(picker).toBeVisible();
      const pickerBounds = (await picker.boundingBox())!;
      expect(pickerBounds.width).toBeGreaterThanOrEqual(44);
      expect(pickerBounds.height).toBeGreaterThanOrEqual(44);
      expect(pickerBounds.x).toBeGreaterThanOrEqual(0);
      expect(pickerBounds.x + pickerBounds.width).toBeLessThanOrEqual(width);
      if (sample.reactions.length) {
        const chipBounds = (await chip.boundingBox())!;
        const separateTargets =
          chipBounds.x + chipBounds.width <= pickerBounds.x ||
          pickerBounds.x + pickerBounds.width <= chipBounds.x ||
          chipBounds.y + chipBounds.height <= pickerBounds.y ||
          pickerBounds.y + pickerBounds.height <= chipBounds.y;
        expect(separateTargets).toBe(true);
      }
      if (sample.id === samples[4].id) {
        const chipBoxes = await Promise.all((await row.getByRole('button', { name: /count 2/ }).all()).map(button => button.boundingBox()));
        expect(new Set(chipBoxes.map(box => Math.round(box!.y))).size).toBeGreaterThan(1);
      }
      await picker.click();
      const panel = page.getByRole('dialog', { name: 'Choose a reaction' });
      await expect(panel).toBeVisible();
      const panelBox = (await panel.boundingBox())!;
      expect(panelBox.x).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
      const heartOption = panel.getByRole('button', { name: 'Heart', exact: true });
      await expect(heartOption).toBeVisible();
      await panel.evaluate(async element => {
        const entrance = element.getAnimations().find(animation =>
          animation instanceof CSSAnimation && animation.animationName === 'ui-enter-disclosure');
        await entrance?.finished;
      });
      const heartSize = await heartOption.evaluate(element => {
        const style = getComputedStyle(element);
        return {
          width: parseFloat(style.width), height: parseFloat(style.height),
          minWidth: parseFloat(style.minWidth), minHeight: parseFloat(style.minHeight),
          flexShrink: parseFloat(style.flexShrink),
        };
      });
      expect(heartSize.minWidth).toBeGreaterThanOrEqual(44);
      expect(heartSize.minHeight).toBeGreaterThanOrEqual(44);
      expect(heartSize.width).toBeGreaterThanOrEqual(44);
      expect(heartSize.height).toBeGreaterThanOrEqual(44);
      expect(heartSize.flexShrink).toBe(0);
      // DOMRect subtracts fractional screen coordinates; allow at most 0.01px of rounding.
      expect((await heartOption.boundingBox())!.height).toBeGreaterThanOrEqual(44 - 0.01);
      await expect(panel.getByRole('button', { name: 'Thumbs Up', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(picker).toBeFocused();
    }
    const emojiSize = await page.locator(`[data-message-id="${samples[2].id}"] p`).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const proseSize = await page.locator(`[data-message-id="${samples[3].id}"] p`).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(emojiSize).toBeGreaterThan(proseSize);
    const sticker = page.locator(`[data-message-id="${stickerId}"] svg[role="img"]`);
    await sticker.scrollIntoViewIfNeeded();
    const stickerBox = (await sticker.boundingBox())!;
    expect(stickerBox.width).toBeGreaterThanOrEqual(140);
    expect(stickerBox.width).toBeLessThanOrEqual(width);
    const lastPicker = page.locator(`[data-message-id="${stickerId}"]`).getByRole('button', { name: 'Add reaction' });
    await lastPicker.click();
    const lastPanel = page.getByRole('dialog', { name: 'Choose a reaction' });
    const lastPanelBox = (await lastPanel.boundingBox())!;
    expect(lastPanelBox.x).toBeGreaterThanOrEqual(0);
    expect(lastPanelBox.x + lastPanelBox.width).toBeLessThanOrEqual(width);
    expect(lastPanelBox.y).toBeGreaterThanOrEqual(0);
    expect(lastPanelBox.y + lastPanelBox.height).toBeLessThanOrEqual(760);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) {
      mkdirSync('test-results/d1-1', { recursive: true });
      await page.screenshot({ path: `test-results/d1-1/discussion-reactions-${theme}-390.png`, fullPage: true });
    }
  });
}

test('UUID ownership survives navigation, reload, older history and a live own event', async ({ page }) => {
  const known = message(ownId, currentUserId, 'Known own message');
  const older = message('00000000-0000-4000-8000-000000000010', currentUserId, 'Older own message');
  const history = [known];
  const identity: { userId: string | null; username: string } = { userId: currentUserId, username: 'student' };
  let socket: WebSocketRoute | undefined;
  await setup(page, 'MEMBER', history, value => { socket = value; }, identity);
  await page.route('**/api/v1/communities/irm/discussion/messages*', route => {
    if (route.request().url().includes('before=')) return route.fulfill({ json: { items: [older], older_cursor: null, has_more_older: false, newer_cursor: null, has_more_newer: false } });
    return route.fulfill({ json: { items: history, older_cursor: 'cursor-id', has_more_older: true, newer_cursor: null, has_more_newer: false } });
  });
  await page.goto('/communities/irm/discussion');
  await expect(page.locator(`[data-message-id="${ownId}"]`)).toHaveAttribute('data-message-owner', 'current');
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.locator(`[data-message-id="${older.id}"]`)).toHaveAttribute('data-message-owner', 'current');
  const live = message('30000000-0000-4000-8000-000000000001', currentUserId, 'Live own message');
  await expect.poll(() => socket !== undefined).toBe(true);
  socket!.send(JSON.stringify({ type: 'message_created', community_slug: 'irm', message: live }));
  await expect(page.locator(`[data-message-id="${live.id}"]`)).toHaveAttribute('data-message-owner', 'current');
  history.push(live);
  identity.username = 'student-renamed';
  known.author_username = 'student-renamed';
  await page.goto('/communities/irm/modules');
  await page.goBack();
  await expect(page.locator(`[data-message-id="${ownId}"]`)).toHaveAttribute('data-message-owner', 'current');
  await page.reload();
  await expect(page.locator(`[data-message-id="${live.id}"]`)).toHaveAttribute('data-message-owner', 'current');
});

test('confirmed send and live event merge once, and an idempotent retry stays own', async ({ page }) => {
  let socket: WebSocketRoute | undefined;
  await setup(page, 'MEMBER', [], value => { socket = value; });
  let attempts = 0;
  const postedClientIds: string[] = [];
  let retryResponse: (() => Promise<void>) | undefined;
  await page.route('**/api/v1/communities/irm/discussion/messages', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts += 1;
    const post = route.request().postDataJSON() as { client_message_id: string; content: string };
    postedClientIds.push(post.client_message_id);
    if (attempts === 1) return route.abort('failed');
    const confirmed = message('40000000-0000-4000-8000-000000000001', currentUserId, post.content);
    await new Promise<void>(resolve => { retryResponse = async () => { await route.fulfill({ status: 200, json: confirmed }); resolve(); }; });
  });

  await page.goto('/communities/irm/discussion');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('retry with stable author');
  await input.press('Control+Enter');
  await expect(page.getByRole('alert')).toContainText('Failed to send message');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect.poll(() => postedClientIds.length).toBe(2);
  expect(postedClientIds[0]).toBe(postedClientIds[1]);

  const confirmed = message('40000000-0000-4000-8000-000000000001', currentUserId, 'retry with stable author');
  await expect.poll(() => socket !== undefined).toBe(true);
  socket!.send(JSON.stringify({ type: 'message_created', community_slug: 'irm', message: confirmed }));
  const row = page.locator(`[data-message-id="${confirmed.id}"]`);
  await expect(row).toHaveAttribute('data-message-owner', 'current');
  await expect(row).toHaveCount(1);
  await retryResponse!();
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-message-owner', 'current');
});

test('missing and invalid author UUIDs remain unclassified without a username guess', async ({ page }) => {
  const missing = message('50000000-0000-4000-8000-000000000001', otherUserId, 'No author UUID');
  delete (missing as { author_id?: string }).author_id;
  const invalid = { ...message('50000000-0000-4000-8000-000000000002', currentUserId, 'Malformed author UUID'), author_id: 'not-a-uuid' };
  await setup(page, 'MEMBER', [missing, invalid]);
  await page.goto('/communities/irm/discussion');
  await expect(page.locator(`[data-message-id="${missing.id}"]`)).toHaveAttribute('data-message-owner', 'unclassified');
  await expect(page.locator(`[data-message-id="${invalid.id}"]`)).toHaveAttribute('data-message-owner', 'unclassified');
});

test('account switch hides cached history until the new account snapshot arrives', async ({ page }) => {
  const identity: { userId: string | null; username: string } = { userId: currentUserId, username: 'student' };
  const oldOwn = message('60000000-0000-4000-8000-000000000001', currentUserId, 'Account A private history');
  const nextOwn = { ...message('60000000-0000-4000-8000-000000000002', otherUserId, 'Account B own history'), author_username: 'student-renamed' };
  let holdNextHistory = false;
  let releaseNextHistory: (() => Promise<void>) | undefined;
  let socket: WebSocketRoute | undefined;
  await setup(page, 'MEMBER', [oldOwn], value => { socket = value; }, identity);
  await page.route('**/api/v1/communities/irm/discussion/messages?limit=30', async route => {
    if (holdNextHistory) {
      await new Promise<void>(resolve => { releaseNextHistory = async () => { await route.fulfill({ json: { items: [nextOwn], older_cursor: null, has_more_older: false, newer_cursor: null, has_more_newer: false } }); resolve(); }; });
      return;
    }
    await route.fulfill({ json: { items: [oldOwn], older_cursor: null, has_more_older: false, newer_cursor: null, has_more_newer: false } });
  });
  await page.goto('/communities/irm/discussion');
  await expect(page.locator(`[data-message-id="${oldOwn.id}"]`)).toHaveAttribute('data-message-owner', 'current');

  identity.userId = otherUserId;
  identity.username = 'student-renamed';
  holdNextHistory = true;
  await socket!.close({ code: 1008, reason: 'Account switched' });
  await expect.poll(() => releaseNextHistory !== undefined).toBe(true);
  await expect(page.locator(`[data-message-id="${oldOwn.id}"]`)).toHaveCount(0);
  if (releaseNextHistory) await releaseNextHistory();
  holdNextHistory = false;
  await expect(page.locator(`[data-message-id="${nextOwn.id}"]`)).toHaveAttribute('data-message-owner', 'current');

  identity.userId = null;
  await socket!.close({ code: 1008, reason: 'Logged out' });
  await expect(page.locator(`[data-message-id="${nextOwn.id}"]`)).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`${width}px ${theme}: conversation geometry and clearance`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(preference => localStorage.setItem('irm-theme', preference), theme);
    await setup(page);
    await page.goto('/communities/irm/discussion');
    await expect(page.locator('[data-message-id]')).toHaveCount(2);
    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    }));
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    const input = page.getByRole('textbox', { name: 'Write a message' });
    await expect(input).toBeInViewport();
    const inputBox = (await input.boundingBox())!;
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    const colors = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('[data-discussion-page]')!;
      const rows = main.querySelectorAll<HTMLElement>('[data-message-owner]');
      const bubble = (row: HTMLElement) => row.lastElementChild!.firstElementChild! as HTMLElement;
      return {
        incoming: getComputedStyle(bubble(rows[0])).backgroundColor,
        outgoing: getComputedStyle(bubble(rows[1])).backgroundColor,
        history: getComputedStyle(main.querySelector<HTMLElement>('[role="log"]')!).backgroundColor,
      };
    });
    const expectedColors = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('[data-discussion-page]')!;
      const sample = document.createElement('span');
      main.append(sample);
      const resolved = (token: string) => { sample.style.backgroundColor = `var(${token})`; return getComputedStyle(sample).backgroundColor; };
      const values = { surface: resolved('--surface'), accentSoft: resolved('--accent-soft'), page: resolved('--page') };
      sample.remove();
      return values;
    });
    expect(colors.incoming).toBe(expectedColors.surface);
    expect(colors.outgoing).toBe(expectedColors.accentSoft);
    expect(colors.history).toBe(expectedColors.page);
    await input.fill('Ready to send');
    const sendColor = await page.getByRole('button', { name: 'Send message' }).evaluate(node => getComputedStyle(node).backgroundColor);
    const accentColor = await page.evaluate(() => {
      const sample = document.createElement('span');
      document.querySelector('[data-discussion-page]')!.append(sample);
      sample.style.backgroundColor = 'var(--accent)';
      const value = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return value;
    });
    expect(sendColor).toBe(accentColor);
    if (width < 1280) {
      const nav = page.getByRole('navigation', { name: 'Mobile bottom navigation' });
      const composer = await input.boundingBox(); const bar = await nav.boundingBox();
      expect(composer && bar && composer.y + composer.height <= bar.y).toBe(true);
    }
    if (width !== 320) {
      mkdirSync('test-results/d2', { recursive: true });
      await page.screenshot({ path: `test-results/d2/discussion-${theme}-${width}.png`, fullPage: true });
    }
    if (width < 1280) {
      await input.focus();
      await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).not.toBeVisible();
    }
  });
}

test('short viewport and reduced motion keep composer reachable without history page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await page.goto('/communities/irm/discussion');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await expect(input).toBeInViewport();
  await input.focus();
  const composer = await input.boundingBox();
  expect(composer && composer.y + composer.height <= 520).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-message-id]')!).transitionDuration)).toBe('0s');
});

test('long history owns scrolling while the composer stays fixed through mobile resizing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  const rows = Array.from({ length: 70 }, (_, index) => message(`90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, otherUserId, `Message ${index + 1}: ${'long history '.repeat(8)}`));
  await setup(page, 'MEMBER', rows);
  await page.goto('/communities/irm/discussion');
  await expect(page.locator('[data-message-id]')).toHaveCount(rows.length);
  const log = page.getByRole('log', { name: 'Discussion message history' });
  const input = page.getByRole('textbox', { name: 'Write a message' });
  const before = (await input.boundingBox())!;
  const scroll = await log.evaluate(element => {
    const canScroll = element.scrollHeight > element.clientHeight;
    element.scrollTop = 0;
    return { canScroll, top: element.scrollTop };
  });
  expect(scroll.canScroll).toBe(true);
  await expect(page.locator(`[data-message-id="${rows[0].id}"]`)).toBeAttached();
  const after = (await input.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  for (const size of [{ width: 768, height: 390 }, { width: 320, height: 520 }]) {
    await page.setViewportSize(size);
    await expect(input).toBeInViewport();
    const box = (await input.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  const beforeFocus = (await input.boundingBox())!;
  await input.focus();
  await expect(page.getByRole('navigation', { name: 'Mobile bottom navigation' })).not.toBeVisible();
  await expect(input).toBeInViewport();
  const afterFocus = (await input.boundingBox())!;
  expect(afterFocus.y).toBeGreaterThan(beforeFocus.y + 20);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
});

test('message grouping and date separators use timestamps without merging message identity', async ({ page }) => {
  const first = { ...message('70000000-0000-4000-8000-000000000001', otherUserId, 'Earlier'), created_at: '2026-10-12T12:00:00Z' };
  const sameGroup = { ...message('70000000-0000-4000-8000-000000000002', otherUserId, 'Follow-up'), created_at: '2026-10-12T12:02:00Z' };
  const nextDay = { ...message('70000000-0000-4000-8000-000000000003', otherUserId, 'Next day'), created_at: '2026-10-13T12:00:00Z' };
  await setup(page, 'MEMBER', [first, sameGroup, nextDay]);
  await page.goto('/communities/irm/discussion');
  const rows = page.locator('[data-message-id]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveAttribute('data-message-grouped', 'true');
  await expect(page.getByText(/Oct 12, 2026/)).toHaveCount(1);
  await expect(page.getByText(/Oct 13, 2026/)).toHaveCount(1);
});
