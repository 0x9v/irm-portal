import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/components/navigation/NavigationLinks.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const loadedModule = { exports: {} };
vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, require: name => {
  if (name === 'react/jsx-runtime') return { jsx: () => {}, jsxs: () => {} };
  if (name === 'next/link' || name === 'next/navigation' || name === '@/context/AuthContext') return {};
  if (name === './NavIcons') return new Proxy({}, { get: (_, key) => key });
  if (name.endsWith('.css')) return { default: {} };
  throw new Error(`Unexpected import ${name}`);
} });
const { navigationGroups, navigationIsActive } = loadedModule.exports;
const user = { id: 'u', username: 'student' };
const base = { user, membership: null, capabilities: null, membershipError: null, error: null, isLoading: false, isRefreshing: false, isLoggingOut: false };
const labels = state => Array.from(navigationGroups({ ...base, ...state }).flatMap(group => group.items.map(item => item.label)));
const hrefs = state => Array.from(navigationGroups({ ...base, ...state }).flatMap(group => group.items.map(item => item.href)));

for (const status of [null, 'PENDING', 'REJECTED', 'REMOVED', 'BANNED']) {
  test(`${status || 'no membership'} retains allowed study and personal routes`, () => {
    const items = labels({ membership: status && { status, role: 'MEMBER' } });
    assert.deepEqual(items, ['Home', 'Modules', 'Saved documents', 'Recently opened']);
  });
}

test('ACTIVE member, Moderator and Delegate use role and capability gates', () => {
  const member = { membership: { status: 'ACTIVE', role: 'MEMBER' } };
  const moderator = { membership: { status: 'ACTIVE', role: 'MODERATOR' } };
  const delegate = { membership: { status: 'ACTIVE', role: 'DELEGATE' } };
  const capability = { manage_document_voting: true };
  assert(labels(member).includes('Announcements'));
  assert(labels(member).includes('My submissions'));
  assert(!labels(member).includes('Review applications'));
  assert(!labels(moderator).includes('Review applications'));
  assert(!labels(moderator).includes('Voting settings'));
  assert(labels({ ...moderator, capabilities: capability }).includes('Voting settings'));
  assert(labels(delegate).includes('Review applications'));
  assert(labels(delegate).includes('Manage staff'));
  assert(labels(delegate).includes('Members'));
  assert(!labels(delegate).includes('Voting settings'));
  assert(labels({ ...delegate, capabilities: capability }).includes('Voting settings'));
  assert(!labels({ ...delegate, capabilities: capability, membershipError: 'Unavailable' }).includes('Review applications'));
  assert(!labels({ ...delegate, capabilities: capability, isRefreshing: true }).includes('Voting settings'));
  assert.equal(new Set(hrefs({ ...delegate, capabilities: capability })).size, hrefs({ ...delegate, capabilities: capability }).length);
});

test('nested routes select exactly their owning destination', () => {
  const cases = [
    ['/communities/irm/modules/algo/documents/file', '/communities/irm/modules'],
    ['/communities/irm/announcements/notice', '/communities/irm/announcements'],
    ['/communities/irm/posts/thread', '/communities/irm/posts'],
    ['/communities/irm/membership/review/application', '/communities/irm/membership/review'],
    ['/communities/irm/membership/staff', '/communities/irm/membership/staff'],
    ['/communities/irm/membership/members/profile', '/communities/irm/membership/members'],
    ['/communities/irm/documents/recent', '/communities/irm/documents/recent'],
  ];
  const all = hrefs({ membership: { status: 'ACTIVE', role: 'DELEGATE' }, capabilities: { manage_document_voting: true } });
  for (const [path, expected] of cases) {
    assert.deepEqual(all.filter(href => navigationIsActive(path, href)), [expected]);
  }
  assert.equal(navigationIsActive('/communities/irm/modules-other', '/communities/irm/modules'), false);
});
