// Isolated render checks for navigation eligibility and real route presentation.
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
const requireDependency = createRequire(import.meta.url);
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const styles = new Proxy({}, { get: (_, key) => key });
let pathname = '/';
let account;
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const compiledModule = { exports: {} };
  cache.set(filename, compiledModule.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const isolatedRequire = name => {
    if (name === '@/context/AuthContext') return { useAuth: () => account };
    if (name === 'next/navigation') return { usePathname: () => pathname, useRouter: () => ({ push() {} }) };
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'prefetch')), children) };
    if (name.endsWith('.css')) return { __esModule: true, default: styles };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const file = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load([file, file + '.tsx', file + '.ts'].find(p => fs.existsSync(p)));
    }
    return requireDependency(name);
  };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: isolatedRequire }, { filename });
  cache.set(filename, compiledModule.exports); return compiledModule.exports;
}
function render(file, props) {
  return renderToStaticMarkup(React.createElement(load(path.join(src, file)).default, props));
}
const user = { id: 'fixture', username: 'actual_username', email: 'private@example.invalid' };
const initial = { user, isLoading: false, membershipError: null, membership: { status: 'ACTIVE', role: 'MEMBER' } };
const guidedRoutes = ['/', '/communities/irm/modules', '/account#community-membership', '/account#community-membership', '/account'];
const expectedRoutes = [ '/', '/communities/irm/modules', '/communities/irm/posts', '/communities/irm/discussion', '/account' ];

for (const [persona, overrides, routes] of [
  ['active', {}, expectedRoutes],
  ['delegate', { membership: { status: 'ACTIVE', role: 'DELEGATE' } }, expectedRoutes],
  ['guest', { user: null, membership: null }, []],
  ['nonmember', { membership: null }, guidedRoutes],
  ['pending', { membership: { status: 'PENDING', role: 'MEMBER' } }, guidedRoutes],
  ['banned', { membership: { status: 'BANNED', role: 'MEMBER' } }, ['/', '/communities/irm/modules', '/support', '/support', '/account']],
  ['auth error with stale active membership', { error: 'Unavailable' }, guidedRoutes],
  ['refreshing with stale active membership', { isRefreshing: true }, guidedRoutes],
  ['rejected', { membership: { status: 'REJECTED', role: 'MEMBER' } }, guidedRoutes],
  ['verification error with stale active membership', { membershipError: 'Unavailable' }, guidedRoutes],
  ['initial loading', { user: null, membership: null, isLoading: true }, []],
  ['loading with stale active membership', { isLoading: true }, []],
]) {
  test(`${persona}: bottom navigation offers the correct destinations without exposing private data`, () => {
    account = { ...initial, ...overrides }; pathname = '/';
    const html = render('components/navigation/MobileBottomNav.tsx');
    assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), routes);
    if (routes.length === 0) { assert.equal(html, ""); return; }
    assert.match(html, /aria-label="Mobile bottom navigation"/);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.doesNotMatch(html, /private@example|\/profile|\/community"|\/documents"/);
  });
}
for (const route of ['/communities/irm/modules/algo/documents/doc-42', '/communities/irm/posts/thread-42', '/communities/irm/discussion', '/account']) {
  test(`Bottom navigation marks the current section for ${route}`, () => {
    account = initial; pathname = route;
    const html = render('components/navigation/MobileBottomNav.tsx');
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    const currentHref = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*aria-current="page"/g)][0][1];
    assert.ok(route === currentHref || route.startsWith(currentHref + '/'));
  });
}
test('Four shortcuts retain Modules and offer membership guidance when access is unresolved', () => {
  const active = render('components/home/HomeMobileShortcuts.tsx', { isEligible: true });
  assert.deepEqual([...active.matchAll(/href="([^"]+)"/g)].map(match => match[1]), [
    '/communities/irm/modules', '/communities/irm/announcements', '/communities/irm/posts', '/communities/irm/discussion',
  ]);
  const unknown = render('components/home/HomeMobileShortcuts.tsx', { isEligible: false });
  assert.deepEqual([...unknown.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['/communities/irm/modules', ...Array(3).fill('/account#community-membership')]);
  assert.match(unknown, /Check membership access/);
});
test('Announcement author is optional and rendered as escaped plain text', () => {
  const notice = { id: 'a-42', title: 'Notice', content: 'Plain preview', created_at: '2026-10-10T12:00:00Z' };
  const absent = render('components/home/HomeAnnouncementRow.tsx', { announcement: notice });
  assert.doesNotMatch(absent, /By /);
  const supplied = render('components/home/HomeAnnouncementRow.tsx', { announcement: { ...notice, author_username: '<b>real_author</b>' } });
  assert.match(supplied, /By &lt;b&gt;real_author&lt;\/b&gt;/); assert.doesNotMatch(supplied, /<b>/);
});

test('Featured announcement uses real optional author, escaped long title and bounded excerpt', () => {
  const announcement = { id: 'notice-real', title: '<b>' + 'long title '.repeat(50), content: 'x'.repeat(800), created_at: '2026-10-11T12:00:00Z' };
  const html = render('components/AnnouncementCard.tsx', { announcement, variant: 'featured', headingLevel: 'h2' });
  assert.match(html, /Latest/); assert.match(html, /&lt;b&gt;/); assert.match(html, /href="\/communities\/irm\/announcements\/notice-real"/);
  assert.match(html, /x{360}…/); assert.doesNotMatch(html, /x{361}|By |IRM admins|caught up/);
  const supplied = render('components/AnnouncementCard.tsx', { announcement: { ...announcement, author_username: '<script>real_author</script>' }, variant: 'featured' });
  assert.match(supplied, /By @&lt;script&gt;real_author&lt;\/script&gt;/); assert.doesNotMatch(supplied, /<script>/);
});
