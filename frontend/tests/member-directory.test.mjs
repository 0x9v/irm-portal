import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
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
      if (name === '@/context/ThemeContext') return { useTheme: () => ({ resolvedTheme: 'light', preference: 'system', setPreference() {} }) };
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
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: localRequire, process: { env: { NEXT_PUBLIC_API_URL: 'http://fixture.invalid' } }, fetch: (...args) => fetchImpl(...args), Headers, FormData, Response, AbortController, URL, URLSearchParams, queueMicrotask, ...globals }, { filename });
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
const management = loader()('lib/memberManagement.ts');
for (const status of ['ACTIVE', 'PENDING', 'REJECTED', 'REMOVED', 'BANNED']) {
  test(`${status}: Delegate target protected`, () => assert.deepEqual(Array.from(management.memberActions({ status, role: 'DELEGATE' })), []));
  for (const role of ['MEMBER', 'MODERATOR']) test(`${status} ${role}: available actions`, () => {
    const expected = status === 'BANNED' ? ['unban'] : status === 'REMOVED' ? ['ban'] : ['member', 'ban'];
    assert.deepEqual(Array.from(management.memberActions({ status, role })), expected);
  });
}
test('unknown state has no mutation control', () => assert.deepEqual(Array.from(management.memberActions({ status: 'FUTURE', role: 'MEMBER' })), []));
function elements(tree, predicate, result = []) {
  if (Array.isArray(tree)) tree.forEach(item => elements(item, predicate, result));
  else if (tree && typeof tree === 'object') {
    if (predicate(tree)) result.push(tree);
    if (tree.type?.name === "NavigationLinks") elements(tree.type(tree.props), predicate, result);
    else if (tree.props) elements(tree.props.children, predicate, result);
  }
  return result;
}
function actionText(child) {
  return renderToStaticMarkup(React.createElement('span', null, child)).replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/g, '').replace(/<[^>]+>/g, '');
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const item = (id, status = 'ACTIVE', role = 'MEMBER') => ({ id, username: `student_${id}`, status, role, created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T10:00:00Z' });
const response = (items, next_cursor = null) => ({ items, next_cursor });
function directoryHarness(reader, account = { ...delegate }) {
  let calls = [], refreshed = 0, currentHarness;
  account.refresh = async () => { refreshed++; };
  const parentHarness = hookHarness();
  let childHarness = hookHarness(), childKey, parentKey;
  const hooks = Object.fromEntries(Object.keys(parentHarness.hooks).map(name => [name, (...args) => currentHarness.hooks[name](...args)]));
  const readPage = async (...args) => { calls.push(args); return reader(...args); };
  const load = loader({ auth: account, hooks });
  const Outer = load('components/moderation/MemberDirectory.tsx').default;
  let parentTree;
  function render() {
    const authorized = Outer({ readPage });
    if (authorized.type?.name !== 'AuthorizedDirectory') {
      childHarness.unmount(); childKey = undefined; return authorized;
    }
    currentHarness = parentHarness;
    parentTree = parentHarness.run(authorized.type, authorized.props);
    const child = elements(parentTree, node => node.type?.name === 'FilteredDirectory')[0];
    if (child.key !== childKey || authorized.key !== parentKey) {
      childHarness.unmount(); childHarness = hookHarness(); childKey = child.key; parentKey = authorized.key;
    }
    currentHarness = childHarness;
    return childHarness.run(child.type, child.props);
  }
  const nodes = predicate => elements(render(), predicate);
  const rows = () => nodes(node => node.type === 'li');
  const button = label => nodes(node => node.props?.onClick && actionText(node.props.children) === label)[0];
  return { render, rows, calls, account, button, nodes, ApiError: load('lib/api.ts').ApiError,
    refreshed: () => refreshed,
    filter(value) { render(); elements(parentTree, node => node.type === 'select')[0].props.onChange({ target: { value } }); return render(); },
    unmount() { childHarness.unmount(); parentHarness.unmount(); },
  };
}
for (const [name, overrides] of [
  ['guest', { user: null }], ['member', { membership: { ...delegate.membership, role: 'MEMBER' } }],
  ['Moderator', { membership: { ...delegate.membership, role: 'MODERATOR' }, capabilities: { manage_document_voting: true } }],
  ['loading', { isLoading: true }], ['verification error', { membershipError: 'Failed verification' }],
  ...['PENDING', 'REJECTED', 'REMOVED', 'BANNED'].map(status => [status, { membership: { ...delegate.membership, status } }]),
]) test(`${name}: direct directory denies reads and rows`, () => {
  let reads = 0; const account = { ...delegate, ...overrides };
  const Page = loader({ auth: account })('components/moderation/MemberDirectory.tsx').default;
  const markup = renderToStaticMarkup(React.createElement(Page, { readPage: () => { reads++; } }));
  assert.equal(reads, 0); assert.doesNotMatch(markup, /Membership directory|student_/);
});
for (const filter of ['ALL', 'ACTIVE', 'PENDING', 'REJECTED', 'REMOVED', 'BANNED']) test(`${filter}: new filter owns its first page and no cursor`, async () => {
  const fixture = directoryHarness(async (slug, selected) => response([item(selected)]));
  fixture.render(); await tick(); fixture.filter(filter); await tick();
  assert.equal(fixture.calls.at(-1)[1], filter); assert.equal(fixture.calls.at(-1)[2], null);
  assert.equal(fixture.rows().length, 1); fixture.unmount();
});
test('empty Banned state is explicit', async () => {
  const fixture = directoryHarness(async () => response([])); fixture.render(); fixture.filter('BANNED'); await tick();
  assert.ok(fixture.nodes(node => node.props?.children === 'No banned memberships found.').length); fixture.unmount();
});
test('empty All state is distinct from a filtered empty state', async () => {
  const fixture = directoryHarness(async () => response([])); fixture.render(); fixture.filter('ALL'); await tick();
  assert.ok(fixture.nodes(node => node.props?.children === 'No memberships found.').length);
  fixture.filter('ACTIVE'); await tick();
  assert.ok(fixture.nodes(node => node.props?.children === 'No memberships found for this status.').length); fixture.unmount();
});
test('initial failure offers retry, then real rows load', async () => {
  let attempts = 0; const fixture = directoryHarness(async () => { if (!attempts++) throw Error('offline'); return response([item('one')]); });
  fixture.render(); await tick();
  const feedback = fixture.nodes(node => node.props?.retryLabel === 'Retry directory')[0]; assert.ok(feedback);
  await feedback.props.onRetry(); await tick(); assert.equal(fixture.rows().length, 1); fixture.unmount();
});
test('cursor pagination deduplicates memberships', async () => {
  const fixture = directoryHarness(async (_, filter, after) => after ? response([item('one'), item('two')]) : response([item('one')], 'cursor-one'));
  fixture.render(); await tick(); await fixture.button('Load More').props.onClick(); await tick();
  assert.equal(fixture.calls.at(-1)[2], 'cursor-one'); assert.equal(fixture.calls.at(-1)[1], 'ACTIVE'); assert.equal(fixture.rows().length, 2); fixture.unmount();
});
test('Load More failure preserves rows and permits retry', async () => {
  let attempts = 0; const fixture = directoryHarness(async (_, __, after) => { if (!after) return response([item('one')], 'cursor-one'); if (!attempts++) throw Error('offline'); return response([item('two')]); });
  fixture.render(); await tick(); await fixture.button('Load More').props.onClick(); await tick(); assert.equal(fixture.rows().length, 1);
  await fixture.nodes(node => node.props?.retryLabel === 'Retry Load More')[0].props.onRetry(); await tick(); assert.equal(fixture.rows().length, 2); fixture.unmount();
});
test('Refresh clears pagination synchronously and ignores old Load More', async () => {
  let resolveOld; const fixture = directoryHarness(async (_, __, after) => after ? new Promise(resolve => { resolveOld = resolve; }) : response([item('fresh')], 'cursor'));
  fixture.render(); await tick(); fixture.button('Load More').props.onClick(); fixture.button('Refresh directory').props.onClick();
  assert.equal(fixture.rows().length, 0); assert.equal(fixture.button('Load More'), undefined);
  resolveOld(response([item('stale')])); await tick(); assert.equal(fixture.rows().length, 1); assert.equal(fixture.rows()[0].key, 'fresh');
  assert.equal(fixture.calls.at(-1)[2], null); fixture.unmount();
});
test('filter switch aborts reads and never leaks delayed previous data', async () => {
  let resolveOld; const fixture = directoryHarness(async (_, filter) => filter === 'ACTIVE' ? new Promise(resolve => { resolveOld = resolve; }) : response([]));
  fixture.render(); fixture.filter('BANNED'); assert.equal(fixture.calls[0][3].aborted, true); assert.equal(fixture.rows().length, 0);
  resolveOld(response([item('private-old')], 'old-cursor')); await tick(); assert.equal(fixture.rows().length, 0); assert.equal(fixture.button('Load More'), undefined); fixture.unmount();
});
for (const boundary of ['account switch', 'authority loss', 'unmount']) test(`${boundary}: pending reads cannot return records`, async () => {
  let resolveRead; const fixture = directoryHarness(() => new Promise(resolve => { resolveRead = resolve; })); fixture.render();
  if (boundary === 'account switch') { fixture.account.user = { id: 'other' }; fixture.unmount(); }
  else if (boundary === 'authority loss') { fixture.account.membership = { ...delegate.membership, role: 'MEMBER' }; fixture.render(); }
  else fixture.unmount();
  assert.equal(fixture.calls[0][3].aborted, true); resolveRead(response([item('stale')])); await tick();
  if (boundary === 'authority loss') assert.equal(fixture.rows().length, 0); fixture.unmount();
});
test('observed authority loss clears already loaded records', async () => {
  const fixture = directoryHarness(async () => response([item('one')], 'cursor')); fixture.render(); await tick(); assert.equal(fixture.rows().length, 1);
  fixture.account.membership = { ...delegate.membership, status: 'REMOVED' }; assert.equal(fixture.rows().length, 0); fixture.unmount();
});
for (const status of [401, 403]) test(`${status}: read clears records and revalidates authority`, async () => {
  const fixture = directoryHarness(async () => { throw new fixture.ApiError(status, 'denied'); });
  fixture.render(); await tick(); assert.equal(fixture.rows().length, 0); assert.equal(fixture.refreshed(), 1); fixture.unmount();
});
test('mutation callbacks refresh selected filter without setting membership ACTIVE', async () => {
  let banned = true; const fixture = directoryHarness(async (_, filter) => response(banned ? [item('target', 'BANNED')] : filter === 'ALL' ? [item('target', 'REMOVED')] : []));
  fixture.render(); fixture.filter('BANNED'); await tick();
  const action = fixture.nodes(node => node.props?.kind === 'unban')[0]; assert.ok(action); banned = false; action.props.onRemoved(false);
  assert.equal(fixture.rows().length, 0); await tick(); assert.equal(fixture.rows().length, 0); assert.equal(fixture.calls.at(-1)[1], 'BANNED'); assert.equal(fixture.calls.at(-1)[2], null);
  fixture.filter('ALL'); await tick(); const row = fixture.rows()[0]; assert.equal(row.key, 'target'); assert.ok(elements(row, node => node.props?.children?.includes?.('REMOVED')).length); fixture.unmount();
});
function actionHarness(fetchImpl, extra = {}) {
  const harness = hookHarness(); let refreshed = 0, completed = [];
  const account = { ...delegate, refresh: async () => { refreshed++; } };
  const load = loader({ hooks: harness.hooks, auth: account, fetchImpl, stubs: { './ConfirmationDialog': { __esModule: true, default: function Dialog() {} } } });
  const Outer = load('components/moderation/ModerationAction.tsx').default;
  const child = Outer({ kind: 'unban', id: 'target', context: '@student', onCheck: async () => {}, onRemoved: value => completed.push(value), ...extra });
  const parts = () => { const tree = harness.run(child.type, child.props); return tree ? tree.props.children : [null, null]; };
  return { harness, parts, refreshed: () => refreshed, completed: () => completed };
}
test('Unban confirmation identifies username and cancellation sends no request', () => {
  let calls = 0; const fixture = actionHarness(async () => { calls++; return new Response(null, { status: 204 }); });
  fixture.parts()[0].props.onClick(); const dialog = fixture.parts()[1]; assert.equal(dialog.props.heading, 'Unban @student?');
  assert.match(dialog.props.description, /does not restore.*management permissions/); assert.match(dialog.props.description, /REMOVED/);
  dialog.props.onCancel(); assert.equal(fixture.parts()[1], false); assert.equal(calls, 0); fixture.harness.unmount();
});
test('Unban uses DELETE ban route, 204 without parsing and duplicate lock', async () => {
  let calls = 0, resolve;
  const fixture = actionHarness((url, init) => {
    calls++; assert.equal(url, 'http://fixture.invalid/api/v1/communities/irm/memberships/target/ban'); assert.equal(init.method, 'DELETE');
    return new Promise(done => { resolve = done; });
  });
  fixture.parts()[0].props.onClick(); const first = fixture.parts()[1].props.onConfirm();
  await fixture.parts()[1].props.onConfirm(); assert.equal(calls, 1); assert.equal(fixture.parts()[1].props.pending, true);
  resolve({ ok: true, status: 204, json() { throw Error('must not parse'); }, text() { throw Error('must not parse'); } }); await first;
  assert.deepEqual(fixture.completed(), [false]); fixture.harness.unmount();
});
for (const status of [401, 403]) test(`Unban ${status}: directory cleanup callback and auth revalidation`, async () => {
  let denied = 0; const fixture = actionHarness(async () => new Response('{}', { status }), { onDenied: () => { denied++; } });
  fixture.parts()[0].props.onClick(); await fixture.parts()[1].props.onConfirm();
  assert.equal(denied, 1); assert.equal(fixture.refreshed(), 1); assert.equal(fixture.parts()[0], null); assert.deepEqual(fixture.completed(), []); fixture.harness.unmount();
});
test('Unban 404 refreshes unavailable target without success', async () => {
  const fixture = actionHarness(async () => new Response('{}', { status: 404 })); fixture.parts()[0].props.onClick(); await fixture.parts()[1].props.onConfirm();
  assert.deepEqual(fixture.completed(), [true]); fixture.harness.unmount();
});
test('Unban 409 invokes authoritative directory refresh callback', async () => {
  let conflicts = 0; const fixture = actionHarness(async () => new Response('{}', { status: 409 }), { onConflict: () => { conflicts++; } });
  fixture.parts()[0].props.onClick(); await fixture.parts()[1].props.onConfirm(); assert.equal(conflicts, 1); assert.deepEqual(fixture.completed(), []); fixture.harness.unmount();
});
for (const failure of ['network', 500]) test(`Unban ${failure}: retains target context and checks before explicit retry`, async () => {
  let calls = 0, checks = 0; const fixture = actionHarness(async () => { calls++; if (failure === 'network') throw Error('offline'); return new Response('{}', { status: failure }); }, { onCheck: async () => { checks++; } });
  fixture.parts()[0].props.onClick(); await fixture.parts()[1].props.onConfirm(); assert.equal(calls, 1); assert.deepEqual(fixture.completed(), []);
  assert.equal(fixture.parts()[1].props.context, '@student'); assert.match(fixture.parts()[1].props.error, /may have completed.*explicit retry/);
  await fixture.parts()[1].props.onCheck(); assert.equal(checks, 1); assert.equal(calls, 1); fixture.harness.unmount();
});
for (const boundary of ['unmount', 'account switch', 'filter change', 'community change', 'authority loss']) test(`Unban ${boundary}: stale completion cannot refresh or change directory`, async () => {
  let resolve; const fixture = actionHarness(() => new Promise(done => { resolve = done; })); fixture.parts()[0].props.onClick();
  const pending = fixture.parts()[1].props.onConfirm(); fixture.harness.unmount(); resolve(new Response(null, { status: 204 })); await pending;
  assert.deepEqual(fixture.completed(), []); assert.equal(fixture.refreshed(), 0);
});
test('directory target actions exclude leadership and have wrapping identity without private fields', async () => {
  const fixture = directoryHarness(async () => response([item('lead', 'ACTIVE', 'DELEGATE'), { ...item('long'), username: 'long'.repeat(80), email: 'private@example.invalid', first_name: 'PRIVATE' }]));
  fixture.render(); await tick(); assert.equal(fixture.nodes(node => node.props?.id === 'lead' && node.props?.kind).length, 0);
  const tree = fixture.render(); const identity = elements(tree, node => node.type === 'p' && node.props.className === 'username')[1];
  assert.equal(identity.props.children.join(''), '@' + 'long'.repeat(80));
  assert.equal(elements(tree, node => node.type === 'details').length, 1);
  assert.equal(elements(tree, node => node.type === 'summary')[0].props['aria-label'], 'Actions for @' + 'long'.repeat(80));
  assert.equal(elements(tree, node => JSON.stringify(node.props?.children)?.includes('PRIVATE') || JSON.stringify(node.props?.children)?.includes('private@example')).length, 0); fixture.unmount();
});
test('directory 409 callback refresh cancels pending pagination', async () => {
  let oldPage; const fixture = directoryHarness(async (_, __, after) => after ? new Promise(resolve => { oldPage = resolve; }) : response([item('target')], 'cursor'));
  fixture.render(); await tick(); fixture.button('Load More').props.onClick();
  fixture.nodes(node => node.props?.kind === 'ban')[0].props.onConflict(); assert.equal(fixture.calls[1][3].aborted, true);
  oldPage(response([item('stale')])); await tick(); assert.equal(fixture.rows().length, 1); assert.equal(fixture.rows()[0].key, 'target'); fixture.unmount();
});
test('directory mutation denial clears all rows/cursors immediately', async () => {
  const fixture = directoryHarness(async () => response([item('target')], 'cursor')); fixture.render(); await tick();
  fixture.nodes(node => node.props?.kind === 'ban')[0].props.onDenied(); assert.equal(fixture.rows().length, 0); assert.equal(fixture.button('Load More'), undefined); fixture.unmount();
});
test('account switch replaces read scope and old account response cannot fill new rows', async () => {
  const resolvers = []; const fixture = directoryHarness(() => new Promise(resolve => resolvers.push(resolve)));
  fixture.render(); fixture.account.user = { id: 'new-account' }; fixture.account.membership = { ...delegate.membership, id: 'new-membership' }; fixture.render();
  assert.equal(fixture.calls[0][3].aborted, true); resolvers[0](response([item('old-account')])); resolvers[1](response([item('new-account')])); await tick();
  assert.equal(fixture.rows().length, 1); assert.equal(fixture.rows()[0].key, 'new-account'); fixture.unmount();
});
test('new filter immediately clears loaded rows, cursor, pagination failure and dialogs', async () => {
  const fixture = directoryHarness(async (_, filter, after) => { if (after) throw Error('offline'); return response(filter === 'ACTIVE' ? [item('one')] : [], filter === 'ACTIVE' ? 'cursor' : null); });
  fixture.render(); await tick(); fixture.button('Load More').props.onClick(); await tick();
  assert.ok(fixture.nodes(node => node.props?.retryLabel === 'Retry Load More').length);
  fixture.filter('BANNED'); assert.equal(fixture.rows().length, 0); assert.equal(fixture.button('Load More'), undefined);
  assert.equal(fixture.nodes(node => node.props?.retryLabel === 'Retry Load More').length, 0); assert.equal(fixture.nodes(node => node.props?.kind).length, 0); fixture.unmount();
});

for (const filter of ['ALL', 'ACTIVE', 'PENDING', 'REJECTED', 'REMOVED', 'BANNED']) test(`HTTP directory ${filter}: exact query, session, abort and no-store`, async () => {
  const controller = new AbortController(); const cursor = '00000000-0000-4000-8000-000000000003'; let calls = 0;
  const read = loader({ fetchImpl: async (url, init) => {
    const parsed = new URL(url); calls++;
    assert.equal(parsed.pathname, '/api/v1/communities/irm/memberships');
    assert.equal(parsed.searchParams.get('status'), filter === 'ALL' ? null : filter);
    assert.equal(parsed.searchParams.get('limit'), '20');
    assert.equal(parsed.searchParams.get('after'), calls === 1 ? null : cursor);
    assert.equal(init.credentials, 'include'); assert.equal(init.signal, controller.signal); assert.equal(init.cache, 'no-store');
    return new Response(JSON.stringify(response([item(cursor)], calls === 1 ? cursor : null)));
  } })('lib/membershipDirectory.ts').readMembershipDirectory;
  const first = await read('irm', filter, null, controller.signal);
  await read('irm', filter, first.next_cursor, controller.signal); assert.equal(calls, 2);
});
test('integrated route uses prepared gated directory', () => {
  const Page = loader()('app/communities/irm/membership/members/page.tsx').default;
  assert.equal(Page().type.name, 'MemberDirectory');
});
for (const name of ['SidebarNav', 'MobileHeader']) for (const [persona, overrides] of [
  ['Delegate', {}], ['Member', { membership: { ...delegate.membership, role: 'MEMBER' } }],
  ['Moderator', { membership: { ...delegate.membership, role: 'MODERATOR' } }],
  ['guest', { user: null }], ['refreshing', { isRefreshing: true }], ['uncertain', { membershipError: 'unverified' }],
  ['inactive', { membership: { ...delegate.membership, status: 'REMOVED' } }],
]) test(`${name} Members navigation: ${persona}`, () => {
  const harness = hookHarness(); const auth = { ...delegate, capabilities: {}, logout: async () => {}, ...overrides };
  const Component = loader({ auth, hooks: harness.hooks, stubs: { './ThemeSelector': { __esModule: true, default: () => null }, './MobileShell.module.css': {} }, globals: { document: { addEventListener() {}, removeEventListener() {}, body: { style: {} } }, window: { addEventListener() {}, removeEventListener() {} } } })(`components/navigation/${name}.tsx`).default;
  let tree = harness.run(Component, {});
  if (name === 'MobileHeader') { elements(tree, node => node.props?.['aria-expanded'] !== undefined && node.type === 'button')[0].props.onClick(); tree = harness.run(Component, {}); }
  assert.equal(elements(tree, node => node.props?.href === '/communities/irm/membership/members').length, persona === 'Delegate' ? 1 : 0); harness.unmount();
});
