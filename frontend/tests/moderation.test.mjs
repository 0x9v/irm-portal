import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const dependency = createRequire(import.meta.url);
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const delegate = { user: { id: 'actor', username: 'delegate' }, membership: { id: 'actor-membership', status: 'ACTIVE', role: 'DELEGATE' }, isLoading: false, isRefreshing: false, isLoggingOut: false, error: null, membershipError: null, refresh: async () => {} };
function loader({ auth = delegate, fetchImpl = async () => new Response(null, { status: 204 }), hooks, stubs = {}, globals = {} } = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const mod = { exports: {} }; cache.set(filename, mod.exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const localRequire = name => {
      if (name in stubs) return stubs[name];
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      if (name === '@/context/AuthContext') return { useAuth: () => auth };
      if (name === 'react' && hooks) return { ...React, ...hooks };
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'prefetch')), children) };
      if (name === 'next/navigation') return { usePathname: () => '/', useParams: () => ({}), useRouter: () => ({ push() {} }) };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const file = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load([file, file + '.tsx', file + '.ts'].find(file => fs.existsSync(file)));
      }
      return dependency(name);
    };
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: localRequire, process: { env: { NEXT_PUBLIC_API_URL: 'http://fixture.invalid' } }, fetch: (...args) => fetchImpl(...args), Headers, FormData, Response, AbortController, URL, queueMicrotask, crypto: webcrypto, ...globals }, { filename });
    cache.set(filename, mod.exports); return mod.exports;
  }
  return file => load(path.join(src, file));
}
// Isolated hook lifecycle harness: runs the actual handlers and effects without
// a DOM. Native focus/layout acceptance lives in the separate browser suite.
function hookHarness() {
  const slots = []; let cursor = 0; let pending = [];
  const eq = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !eq(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useLayoutEffect(fn, deps) { const i = cursor++; if (!slots[i] || !eq(slots[i].deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps }; pending.push(() => { slots[i].cleanup = fn(); }); } },
    useEffect(fn, deps) { hooks.useLayoutEffect(fn, deps); },
    useId() { return hooks.useMemo(() => 'fixture-id', []); },
  };
  return { hooks, run(fn, props, attach) { cursor = 0; const output = fn(props); attach?.(output); const effects = pending; pending = []; effects.forEach(fn => fn()); return output; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const pure = loader()('lib/moderation.ts');
for (const [name, overrides, expected] of [
  ['Delegate', {}, true], ['Member', { membership: { ...delegate.membership, role: 'MEMBER' } }, false],
  ['Moderator with grants', { membership: { ...delegate.membership, role: 'MODERATOR' }, capabilities: { create_announcements: true } }, false],
  ['guest', { user: null }, false], ['loading', { isLoading: true }, false], ['refreshing', { isRefreshing: true }, false],
  ['logging out', { isLoggingOut: true }, false], ['verification error', { membershipError: 'failed' }, false], ['session error', { error: 'failed' }, false],
  ...['PENDING', 'REJECTED', 'REMOVED', 'BANNED', 'FUTURE'].map(status => [status, { membership: { ...delegate.membership, status } }, false]),
]) test(`${name}: rendered moderation visibility is ${expected}`, () => {
  const account = { ...delegate, ...overrides };
  assert.equal(pure.isConfirmedDelegate(account), expected);
  const Action = loader({ auth: account })('components/moderation/ModerationAction.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Action, { kind: 'post', id: 'target', onRemoved() {}, onCheck() {} }));
  assert.equal(html.includes('Remove post'), expected);
  if (expected) assert.match(html, /<button[^>]*type="button"[^>]*>Remove post<\/button>/);
});
test('IRM authority never authorizes another community', () => assert.equal(pure.isConfirmedDelegate(delegate, 'foreign'), false));
const routes = [
  ['announcement', '/announcements/target', 'DELETE'], ['announcement reply', '/announcements/parent/replies/target', 'DELETE'],
  ['post', '/posts/target', 'DELETE'], ['post reply', '/posts/parent/replies/target', 'DELETE'], ['message', '/discussion/messages/target', 'DELETE'],
  ['member', '/memberships/target', 'DELETE'], ['ban', '/memberships/target/ban', 'PUT'], ['unban', '/memberships/target/ban', 'DELETE'],
];
for (const [kind, route, method] of routes) test(`${kind}: actual request route/method and bodyless 204`, async () => {
  let calls = 0;
  const moderationModule = loader({ fetchImpl: async (url, init) => {
    calls++; assert.equal(url, `http://fixture.invalid/api/v1/communities/irm${route}`); assert.equal(init.method, method); assert.equal(init.credentials, 'include'); assert.equal(init.body, undefined);
    return { ok: true, status: 204, json() { throw Error('204 cannot have JSON'); }, text() { throw Error('204 cannot have text'); } };
  } })('lib/moderation.ts');
  assert.equal(await moderationModule.performModeration(moderationModule.moderationRequest(kind, 'irm', 'target', 'parent'), () => true), 'success');
  assert.equal(calls, 1);
});
for (const [status, result] of [[401, 'denied'], [403, 'denied'], [404, 'unavailable'], [409, 'conflict'], [500, 'uncertain']]) test(`${status}: classified once without retry`, async () => {
  let calls = 0;
  const moderationModule = loader({ fetchImpl: async () => { calls++; return new Response(JSON.stringify({ detail: 'fixture' }), { status }); } })('lib/moderation.ts');
  assert.equal(await moderationModule.performModeration(moderationModule.moderationRequest('post', 'irm', 'target'), () => true), result); assert.equal(calls, 1);
});
test('network loss has an unconfirmed outcome and no retry', async () => {
  let calls = 0; const moderationModule = loader({ fetchImpl: async () => { calls++; throw new Error('offline'); } })('lib/moderation.ts');
  assert.equal(await moderationModule.performModeration(moderationModule.moderationRequest('post', 'irm', 'target'), () => true), 'uncertain'); assert.equal(calls, 1);
});
for (const boundary of ['unmount', 'account switch', 'target switch', 'community switch', 'observed authority loss']) test(`${boundary}: request completion is stale`, async () => {
  let current = true, resolve;
  const moderationModule = loader({ fetchImpl: () => new Promise(done => { resolve = done; }) })('lib/moderation.ts');
  const result = moderationModule.performModeration(moderationModule.moderationRequest('post', 'irm', 'target'), () => current);
  current = false; resolve(new Response(null, { status: 204 })); assert.equal(await result, 'stale');
});
test('stale scope does not send a request', async () => {
  const moderationModule = loader({ fetchImpl: () => { throw Error('must not call'); } })('lib/moderation.ts');
  assert.equal(await moderationModule.performModeration(moderationModule.moderationRequest('post', 'irm', 'target'), () => false), 'stale');
});
test('actual scope hook invalidates old captures on account/target/access change and unmount', () => {
  const harness = hookHarness(), useScope = loader({ hooks: harness.hooks })('lib/useAsyncScope.ts').useAsyncScope;
  let capture = harness.run(useScope, 'actor:irm:post:ACTIVE'); const old = capture(); assert.equal(old(), true);
  capture = harness.run(useScope, 'other:irm:post:ACTIVE'); assert.equal(old(), false); const next = capture();
  capture = harness.run(useScope, 'other:foreign:new-target:REMOVED'); assert.equal(next(), false); const final = capture();
  harness.unmount(); assert.equal(final(), false);
});
function actionHarness(fetchImpl, extra = {}) {
  const harness = hookHarness(); let refreshed = 0, removed = [];
  const account = { ...delegate, refresh: async () => { refreshed++; } };
  const load = loader({ hooks: harness.hooks, auth: account, fetchImpl, stubs: { './ConfirmationDialog': { __esModule: true, default: function Dialog() {} } } });
  const Outer = load('components/moderation/ModerationAction.tsx').default;
  const props = { kind: 'post', id: 'target', onCheck: async () => {}, onRemoved: unavailable => removed.push(unavailable), ...extra };
  const child = Outer(props);
  const render = () => harness.run(child.type, child.props);
  const parts = () => { const tree = render(); return tree ? tree.props.children : [null, null]; };
  return { harness, parts, refreshed: () => refreshed, removed: () => removed };
}
test('confirmation cancellation sends no mutation', async () => {
  let calls = 0; const fixture = actionHarness(async () => { calls++; return new Response(null, { status: 204 }); });
  fixture.parts()[0].props.onClick(); let dialog = fixture.parts()[1]; assert.ok(dialog);
  dialog.props.onCancel(); assert.equal(fixture.parts()[1], false); assert.equal(calls, 0); fixture.harness.unmount();
});
test('pending prevents double confirmation and only reconciles after 204', async () => {
  let calls = 0, resolve; const fixture = actionHarness(() => { calls++; return new Promise(done => { resolve = done; }); });
  fixture.parts()[0].props.onClick(); const confirm = fixture.parts()[1].props.onConfirm;
  const first = confirm(); await confirm(); assert.equal(calls, 1); assert.equal(fixture.parts()[1].props.pending, true); assert.deepEqual(fixture.removed(), []);
  fixture.parts()[1].props.onCancel(); assert.ok(fixture.parts()[1]); resolve(new Response(null, { status: 204 })); await first;
  assert.deepEqual(fixture.removed(), [false]); assert.equal(fixture.parts()[1], false); fixture.harness.unmount();
});
for (const status of [401, 403]) test(`${status}: action refreshes authority and hides itself`, async () => {
  const fixture = actionHarness(async () => new Response('{}', { status })); fixture.parts()[0].props.onClick();
  await fixture.parts()[1].props.onConfirm(); assert.equal(fixture.refreshed(), 1); assert.equal(fixture.parts()[0], null); fixture.harness.unmount();
});
test('404 action reconciles unavailable content', async () => {
  const fixture = actionHarness(async () => new Response('{}', { status: 404 })); fixture.parts()[0].props.onClick();
  await fixture.parts()[1].props.onConfirm(); assert.deepEqual(fixture.removed(), [true]); fixture.harness.unmount();
});
for (const failure of ['network', 500, 409]) test(`${failure}: action preserves content and offers check`, async () => {
  let checks = 0; const fixture = actionHarness(async () => { if (failure === 'network') throw new Error('offline'); return new Response('{}', { status: failure }); }, { onCheck: async () => { checks++; } });
  fixture.parts()[0].props.onClick(); await fixture.parts()[1].props.onConfirm(); assert.deepEqual(fixture.removed(), []);
  assert.match(fixture.parts()[1].props.error, failure === 409 ? /protected.*state changed/ : /outcome could not be confirmed.*explicit retry/);
  await fixture.parts()[1].props.onCheck(); assert.equal(checks, 1); fixture.harness.unmount();
});
test('unmount before 204 does not reconcile or refresh another session', async () => {
  let resolve; const fixture = actionHarness(() => new Promise(done => { resolve = done; })); fixture.parts()[0].props.onClick();
  const pending = fixture.parts()[1].props.onConfirm(); fixture.harness.unmount(); resolve(new Response(null, { status: 204 })); await pending;
  assert.deepEqual(fixture.removed(), []); assert.equal(fixture.refreshed(), 0);
});
test('duplicate removals and delayed history/canonical/local collections stay removed', () => {
  const ledger = new pure.RemovalLedger(); const old = [{ id: 'removed' }, { id: 'keep' }];
  ledger.remove('removed'); ledger.remove('removed');
  for (const collection of [old, [...old], [{ id: 'removed' }]]) assert.ok(ledger.filter(collection).every(item => item.id !== 'removed'));
  assert.equal(ledger.allows('removed'), false); assert.equal(ledger.allows('keep'), true);
});
test('bounded ledger fails closed instead of evicting removals and resets per session', () => {
  const ledger = new pure.RemovalLedger(2); ledger.remove('a'); ledger.remove('b'); ledger.remove('c');
  assert.equal(ledger.saturated, true); assert.equal(ledger.allows('a'), false); assert.equal(ledger.allows('unknown'), false);
  ledger.clear(); assert.equal(ledger.saturated, false); assert.equal(ledger.allows('a'), true);
});
test('parent copy hides replies without claiming database erasure or Undo', () => {
  for (const kind of ['post', 'announcement']) { const copy = pure.moderationCopy(kind); assert.match(copy.description, /replies will also be hidden/); assert.match(copy.description, /no user-facing Undo/); assert.doesNotMatch(copy.description, /permanent|database erasure/); }
});
test('member, ban and unban have distinct state promises', () => {
  assert.match(pure.moderationCopy('member').description, /may apply again/); assert.match(pure.moderationCopy('ban').description, /blocks.*access and reapplication/);
  assert.match(pure.moderationCopy('unban').description, /REMOVED.*not reactivated or approved/);
});
for (const status of ['REMOVED', 'BANNED', 'FUTURE', 'PENDING', 'REJECTED']) test(`${status}: rendered membership application and guidance`, () => {
  const load = loader({ auth: { ...delegate, membership: { ...delegate.membership, role: 'MEMBER', status } } });
  const Page = load('components/account/CommunityMembershipSection.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Page, { masked: false }));
  assert.equal(html.includes('<form'), ['REMOVED', 'REJECTED'].includes(status));
  if (status === 'REMOVED') assert.match(html, /account remains available.*fresh application/);
  if (status === 'BANNED') { assert.match(html, /Community Access Restricted/); assert.match(html, /href="\/support"/); assert.doesNotMatch(html, /Reapply|private rejection/); }
  if (status === 'FUTURE') assert.match(html, /Membership Status Unavailable/);
});
test('membership verification failure hides stale application information', () => {
  const auth = { ...delegate, membershipError: 'Unavailable', membership: { ...delegate.membership, applicant_type: 'STUDENT', applicant_first_name: 'Previous', applicant_family_name: 'Applicant' } };
  const Page = loader({ auth })('components/account/CommunityMembershipSection.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Page, { masked: false }));
  assert.match(html, /Membership status could not be verified/);
  assert.doesNotMatch(html, /Previous Applicant|Current Membership|<form/);
});
test('account membership section distinguishes no membership, pending, active and masked states', () => {
  const Page = loader({ auth: { ...delegate, membership: null } })('components/account/CommunityMembershipSection.tsx').default;
  const noMembership = renderToStaticMarkup(React.createElement(Page, { masked: false }));
  assert.match(noMembership, /Community membership/);
  assert.match(noMembership, /<form/);
  assert.doesNotMatch(noMembership, /Role:/);
  for (const status of ['PENDING', 'ACTIVE']) {
    const Current = loader({ auth: { ...delegate, membership: { ...delegate.membership, status } } })('components/account/CommunityMembershipSection.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Current, { masked: false }));
    assert.match(html, new RegExp(`Status:.*${status}`));
    assert.match(html, /Role:.*DELEGATE/);
    assert.doesNotMatch(html, /<form/);
  }
  const masked = renderToStaticMarkup(React.createElement(Page, { masked: true }));
  assert.match(masked, /Checking membership status/);
  assert.doesNotMatch(masked, /<form|Role:/);
});
function elements(tree, predicate, result = []) {
  if (Array.isArray(tree)) tree.forEach(item => elements(item, predicate, result));
  else if (tree && typeof tree === 'object') {
    if (predicate(tree)) result.push(tree);
    if (tree.props) elements(tree.props.children, predicate, result);
  }
  return result;
}
function actionText(child) {
  return renderToStaticMarkup(React.createElement('span', null, child)).replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/g, '').replace(/<[^>]+>/g, '');
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const message = { id: '00000000-0000-4000-8000-000000000001', kind: 'TEXT', content: 'kept text', sticker_id: null, author_id: '00000000-0000-4000-8000-000000000002', author_username: 'student', created_at: '2026-10-10T10:00:00Z', reactions: [], caller_reaction: null };
function discussionHarness(fetchImpl, account = { ...delegate }) {
  const harness = hookHarness(); const sockets = [];
  class Socket { constructor() { sockets.push(this); } close() { this.onclose?.({ code: 1000 }); } }
  const fakeWindow = { addEventListener() {}, removeEventListener() {} };
  const load = loader({ auth: account, hooks: harness.hooks, fetchImpl,
    globals: { WebSocket: Socket, window: fakeWindow, setTimeout: () => 1, clearTimeout() {}, console: { error() {} }, crypto: { randomUUID: () => 'submission-id' } } });
  const Page = load('app/communities/irm/discussion/page.tsx').default;
  const render = () => harness.run(Page);
  const visible = () => elements(render(), node => !!node.props?.message && typeof node.props.message === 'object');
  return { harness, render, visible, sockets, account, event(data) { sockets.at(-1).onmessage({ data: JSON.stringify(data) }); } };
}
const historyResponse = items => new Response(JSON.stringify({ items, older_cursor: null, newer_cursor: null, has_more_older: false, has_more_newer: false }));
test('actual discussion page handles community-scoped and duplicate removal events', async () => {
  const fixture = discussionHarness(async url => url.includes('/stickers') ? new Response('[]') : historyResponse([message]));
  fixture.render(); await tick(); assert.equal(fixture.visible().length, 1);
  fixture.event({ type: 'message_removed', community_slug: 'foreign', message_id: message.id }); assert.equal(fixture.visible().length, 1);
  fixture.event({ type: 'message_removed', community_slug: 'irm', message_id: message.id });
  fixture.event({ type: 'message_removed', community_slug: 'irm', message_id: message.id }); assert.equal(fixture.visible().length, 0);
  fixture.event({ type: 'message_created', message }); assert.equal(fixture.visible().length, 0); fixture.harness.unmount();
});
test('actual discussion page cannot resurrect a removed message from delayed initial history', async () => {
  let resolve; const fixture = discussionHarness(url => url.includes('/stickers') ? Promise.resolve(new Response('[]')) : new Promise(done => { resolve = done; }));
  fixture.render(); fixture.event({ type: 'message_created', message }); assert.equal(fixture.visible().length, 1);
  fixture.event({ type: 'message_removed', community_slug: 'irm', message_id: message.id });
  resolve(historyResponse([message])); await tick(); assert.equal(fixture.visible().length, 0); fixture.harness.unmount();
});
test('actual discussion page discards delayed reaction presentation after removal', async () => {
  let resolveReaction;
  const fixture = discussionHarness(async url => {
    if (url.endsWith('/reaction')) return new Promise(done => { resolveReaction = done; });
    return url.includes('/stickers') ? new Response('[]') : historyResponse([message]);
  });
  fixture.render(); await tick(); const item = fixture.visible()[0];
  const reaction = item.props.onReactionToggle(message.id, 'heart'); assert.equal(fixture.visible()[0].props.isReacting, true);
  fixture.event({ type: 'message_removed', community_slug: 'irm', message_id: message.id });
  resolveReaction(new Response(JSON.stringify({ message_id: message.id, reactions: [{ emoji: 'heart', count: 1 }], caller_reaction: 'heart' })));
  await reaction; assert.equal(fixture.visible().length, 0); fixture.harness.unmount();
});
test('actual discussion confirmed send response cannot restore a removed message', async () => {
  let resolveSend;
  const fixture = discussionHarness(async (url, init) => {
    if (init.method === 'POST') return new Promise(done => { resolveSend = done; });
    return url.includes('/stickers') ? new Response('[]') : historyResponse([]);
  });
  fixture.render(); await tick(); const composer = elements(fixture.render(), node => !!node.props?.onSendText)[0];
  const pending = composer.props.onSendText('kept text');
  fixture.event({ type: 'message_created', message }); fixture.event({ type: 'message_removed', community_slug: 'irm', message_id: message.id });
  resolveSend(new Response(JSON.stringify(message))); await pending; assert.equal(fixture.visible().length, 0); fixture.harness.unmount();
});
test('actual discussion access loss clears history and ignores delayed sends', async () => {
  let resolveSend; const account = { ...delegate };
  const fixture = discussionHarness(async (url, init) => {
    if (init.method === 'POST') return new Promise(done => { resolveSend = done; });
    return url.includes('/stickers') ? new Response('[]') : historyResponse([message]);
  }, account);
  fixture.render(); await tick(); const composer = elements(fixture.render(), node => !!node.props?.onSendText)[0];
  const pending = composer.props.onSendText('draft'); account.membership = { ...delegate.membership, status: 'BANNED' }; fixture.render();
  resolveSend(new Response(JSON.stringify(message))); await pending; assert.equal(fixture.visible().length, 0); fixture.harness.unmount();
});
for (const [file, parentProp, parentId, kind] of [
  ['components/AnnouncementReplies.tsx', 'announcementId', 'announcement', 'announcement reply'],
  ['components/CommunityPostReplies.tsx', 'postId', 'post', 'post reply'],
]) test(`${kind}: actual component removes canonical and locally confirmed reply without resetting draft or cursor`, async () => {
  const harness = hookHarness(); const canonical = { id: 'old', author_username: 'member', content: 'canonical reply', created_at: message.created_at };
  const local = { ...canonical, id: kind === 'post reply' ? '00000000-0000-4000-8000-000000000004' : 'local', post_id: parentId, content: 'local reply' };
  const account = { ...delegate };
  const load = loader({ auth: account, hooks: harness.hooks, fetchImpl: async (_url, init) => init.method === 'POST' ? new Response(JSON.stringify(local)) : new Response(JSON.stringify({ items: [canonical], next_cursor: 'old' })) });
  const Component = load(file).default, props = { [parentProp]: parentId, communitySlug: 'irm' };
  const render = () => harness.run(Component, props);
  render(); await tick();
  let draft = elements(render(), node => node.type === 'textarea')[0]; draft.props.onChange({ target: { value: 'local reply' } });
  let form = elements(render(), node => node.type === 'form')[0]; await form.props.onSubmit({ preventDefault() {} }); await tick();
  draft = elements(render(), node => node.type === 'textarea')[0]; draft.props.onChange({ target: { value: 'unrelated next draft' } });
  let actions = elements(render(), node => node.props?.kind === kind); assert.equal(actions.length, 2);
  actions.find(node => node.props.id === local.id).props.onRemoved(false); actions = elements(render(), node => node.props?.kind === kind); assert.equal(actions.length, 1);
  actions[0].props.onRemoved(false); assert.equal(elements(render(), node => node.props?.kind === kind).length, 0);
  assert.equal(elements(render(), node => node.type === 'textarea')[0].props.value, 'unrelated next draft');
  assert.ok(elements(render(), node => node.type === 'button' && actionText(node.props.children) === 'Load more replies').length); harness.unmount();
});
for (const [folder, param, label] of [['posts', 'postId', 'post'], ['announcements', 'announcementId', 'announcement']]) test(`${label}: actual detail parent removal clears parent and unmounts replies with return guidance`, async () => {
  const harness = hookHarness(); const load = loader({ hooks: harness.hooks, stubs: { 'next/navigation': { useParams: () => ({ [param]: message.id }) } },
    fetchImpl: async () => new Response(JSON.stringify({ ...message, title: 'parent', content: 'body', updated_at: message.created_at, modules: [] })) });
  let Page = load(`app/communities/irm/${folder}/[${param}]/page.tsx`).default;
  let render = () => harness.run(Page);
  if (folder === 'posts') {
    const wrapper = Page(); Page = wrapper.props.children.type; render = () => harness.run(Page);
  }
  render(); await tick(); const action = elements(render(), node => node.props?.kind === label)[0]; assert.ok(action);
  action.props.onRemoved(false);
  if (folder === 'announcements') {
    const unavailable = elements(render(), node => node.props?.isNotFound)[0]; assert.ok(unavailable);
    assert.equal(unavailable.props.returnHref, `/communities/irm/${folder}`);
  } else {
    assert.ok(elements(render(), node => node.type === 'h2' && node.props.children === 'Post Unavailable').length);
    assert.ok(elements(render(), node => node.props?.href === '/communities/irm/posts').length);
  } assert.equal(elements(render(), node => node.props?.kind === label).length, 0);
  assert.equal(elements(render(), node => node.props?.[param]).length, 0); harness.unmount();
});
for (const kind of ['member', 'ban']) test(`${kind}: actual roster protects Delegate/self and clears confirmed affected row`, async () => {
  const harness = hookHarness(); const roster = [
    { id: delegate.membership.id, status: 'ACTIVE', role: 'DELEGATE', username: 'delegate' },
    { id: 'other-delegate', status: 'ACTIVE', role: 'DELEGATE', username: 'other_delegate' },
    { id: 'member', status: 'ACTIVE', role: 'MEMBER', username: 'ordinary' },
    { id: 'moderator', status: 'ACTIVE', role: 'MODERATOR', username: 'moderator' },
  ];
  const load = loader({ hooks: harness.hooks, fetchImpl: async () => new Response(JSON.stringify(roster)) });
  const Wrapper = load('app/communities/irm/membership/staff/page.tsx').default;
  const child = Wrapper(); const render = () => harness.run(child.type, child.props); render(); await tick();
  let actions = elements(render(), node => node.props?.kind === kind); assert.deepEqual(actions.map(node => node.props.id), ['member', 'moderator']);
  actions[0].props.onRemoved(false); actions = elements(render(), node => node.props?.kind === kind); assert.deepEqual(actions.map(node => node.props.id), ['moderator']);
  const feedback = elements(render(), node => node.props?.type === 'info')[0]; assert.match(feedback.props.message, kind === 'ban' ? /reapplication are blocked/ : /may apply again/);
  harness.unmount();
});
test('native confirmation component focus placement, containment, pending Escape and focus return', async () => {
  const harness = hookHarness(); let cancels = 0;
  class Element {
    isConnected = true;
    focus() { document.activeElement = this; }
    setAttribute() {}
  }
  const previous = new Element(), cancel = new Element(), confirm = new Element();
  const document = { activeElement: previous, body: {}, querySelector: () => previous };
  const dialogElement = new Element(); dialogElement.showModal = () => {}; dialogElement.close = () => {};
  dialogElement.querySelectorAll = () => [cancel, confirm];
  const Dialog = loader({ hooks: harness.hooks, stubs: { 'react-dom': { createPortal: tree => tree } }, globals: { document, HTMLElement: Element } })('components/moderation/ConfirmationDialog.tsx').default;
  const props = { title: 'Remove post', description: 'Hides replies', pending: false, error: null, onCancel: () => { cancels++; }, onConfirm() {}, onCheck() {} };
  const attach = tree => {
    tree.props.ref.current = dialogElement;
    elements(tree, node => node.props?.ref).forEach(node => { if (node.props.children === 'Cancel') node.props.ref.current = cancel; });
  };
  let tree = harness.run(Dialog, props, attach); assert.equal(document.activeElement, cancel);
  let prevented = false; tree.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(document.activeElement, confirm);
  tree.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault() {} }); assert.equal(document.activeElement, cancel);
  tree.props.onCancel({ preventDefault() {} }); assert.equal(cancels, 1);
  tree = harness.run(Dialog, { ...props, pending: true }, attach); tree.props.onCancel({ preventDefault() {} }); assert.equal(cancels, 1); assert.equal(document.activeElement, dialogElement);
  harness.unmount(); await tick(); assert.equal(document.activeElement, previous);
});
test('actual discussion older-page response cannot reinsert an observed removal', async () => {
  let resolveOlder;
  const fixture = discussionHarness(async url => {
    if (url.includes('/stickers')) return new Response('[]');
    if (url.includes('before=')) return new Promise(resolve => { resolveOlder = resolve; });
    return new Response(JSON.stringify({ items: [message], older_cursor: message.id, has_more_older: true }));
  });
  fixture.render(); await tick(); const button = elements(fixture.render(), node => node.type === 'button' && actionText(node.props.children) === 'Load older messages')[0];
  const pending = button.props.onClick(); fixture.event({ type: 'message_removed', community_slug: 'irm', message_id: message.id });
  resolveOlder(historyResponse([message])); await pending; assert.equal(fixture.visible().length, 0); fixture.harness.unmount();
});
test('discussion message presentation distinguishes confirmed ownership and retains author, time, reaction semantics', () => {
  const Item = loader()('components/discussion/DiscussionMessageItem.tsx').DiscussionMessageItem;
  const incoming = { ...message, content: 'Line one\nLine two', reactions: [{ emoji: 'heart', count: 2 }], caller_reaction: 'heart' };
  const otherHtml = renderToStaticMarkup(React.createElement(Item, { message: incoming, onReactionToggle() {} }));
  assert.match(otherHtml, /data-message-owner="other"/);
  assert.match(otherHtml, /aria-label="Message from student"/);
  assert.match(otherHtml, /@student/);
  assert.match(otherHtml, /datetime="2026-10-10T10:00:00Z"/i);
  assert.match(otherHtml, /aria-pressed="true"/);
  assert.match(otherHtml, /Line one\nLine two/);
  const ownHtml = renderToStaticMarkup(React.createElement(Item, { message: incoming, isOwn: true, onReactionToggle() {} }));
  assert.match(ownHtml, /data-message-owner="current"/);
  assert.match(ownHtml, /aria-label="Your message"/);
  assert.doesNotMatch(ownHtml, /@student/);
});
test('emoji-only sizing classification leaves ordinary prose unchanged and built-in stickers enlarge', () => {
  const { DiscussionMessageItem: Item, isEmojiOnlyMessage } = loader()('components/discussion/DiscussionMessageItem.tsx');
  for (const content of ['🙂', '❤️', '🙂\n👍', '🇲🇦']) assert.equal(isEmojiOnlyMessage(content), true);
  for (const content of ['hello 🙂', '123', 'a', '🙂 and hello', '']) assert.equal(isEmojiOnlyMessage(content), false);
  const emojiHtml = renderToStaticMarkup(React.createElement(Item, { message: { ...message, content: '🙂' }, onReactionToggle() {} }));
  const proseHtml = renderToStaticMarkup(React.createElement(Item, { message: { ...message, content: 'hello 🙂' }, onReactionToggle() {} }));
  assert.match(emojiHtml, /emojiOnly/);
  assert.doesNotMatch(proseHtml, /emojiOnly/);
  const stickerHtml = renderToStaticMarkup(React.createElement(Item, { message: { ...message, kind: 'STICKER', content: null, sticker_id: 'pepe_thumbs_up' }, onReactionToggle() {} }));
  assert.match(stickerHtml, /width="160" height="160"/);
});
test('discussion moderation uses a message-specific disclosure only for a confirmed Delegate', () => {
  const props = { kind: 'message', id: message.id, context: 'message by @student', presentation: 'message-menu', onRemoved() {}, onCheck() {} };
  const DelegateAction = loader()('components/moderation/ModerationAction.tsx').default;
  const delegateHtml = renderToStaticMarkup(React.createElement(DelegateAction, props));
  assert.match(delegateHtml, /aria-label="Actions for message by @student"/);
  assert.match(delegateHtml, /aria-expanded="false"/);
  assert.doesNotMatch(delegateHtml, /ui-button--destructive/);
  const MemberAction = loader({ auth: { ...delegate, membership: { ...delegate.membership, role: 'MEMBER' } } })('components/moderation/ModerationAction.tsx').default;
  assert.equal(renderToStaticMarkup(React.createElement(MemberAction, props)), '');
});
test('Discussion ownership requires authoritative author UUID, not local send history or username', async () => {
  const currentUserId = '00000000-0000-4000-8000-000000000003';
  const local = { ...message, id: 'confirmed-local', author_username: 'renamed-user', author_id: currentUserId };
  const account = { ...delegate, user: { ...delegate.user, id: currentUserId } };
  const fixture = discussionHarness(async (_url, init) => init.method === 'POST' ? new Response(JSON.stringify(local)) : _url.includes('/stickers') ? new Response('[]') : historyResponse([message]), account);
  fixture.render(); await tick();
  assert.equal(fixture.visible()[0].props.isOwn, false);
  const composer = elements(fixture.render(), node => !!node.props?.onSendText)[0];
  assert.equal(await composer.props.onSendText('Hello'), true);
  const visible = fixture.visible();
  assert.equal(visible.find(node => node.props.message.id === local.id).props.isOwn, true);
  assert.equal(visible.find(node => node.props.message.id === message.id).props.isOwn, false);
  fixture.harness.unmount();
});
test('Discussion send without author UUID stays unclassified as own', async () => {
  const local = { ...message, id: 'confirmed-without-author-id' };
  delete local.author_id;
  const fixture = discussionHarness(async (_url, init) => init.method === 'POST' ? new Response(JSON.stringify(local)) : _url.includes('/stickers') ? new Response('[]') : historyResponse([]));
  fixture.render(); await tick();
  const composer = elements(fixture.render(), node => !!node.props?.onSendText)[0];
  assert.equal(await composer.props.onSendText('Hello'), true);
  assert.equal(fixture.visible()[0].props.isOwn, false);
  fixture.harness.unmount();
});
test('Discussion normalizes absent and malformed author IDs without username inference', () => {
  const normalize = loader()('lib/discussion.ts').normalizeDiscussionMessage;
  for (const author_id of [undefined, null, 'not-a-uuid']) {
    const normalized = normalize({ ...message, author_username: 'delegate', author_id });
    assert.equal(normalized.author_id, '');
    assert.notEqual(normalized.author_id, delegate.user.id);
  }
  assert.equal(normalize({ ...message, id: null }), null);
});
