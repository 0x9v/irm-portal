// Render actual presentation with isolated account fixtures; no HTTP or backend.
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
const testDir = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(testDir, '../src');
let account;
const styles = new Proxy({}, { get: (_, key) => key });
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const compiledModule = { exports: {} }; cache.set(filename, compiledModule.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const isolatedRequire = name => {
    if (name === '@/context/AuthContext') return { useAuth: () => account };
    if (name === '@/lib/api') return { fetchApi: () => { throw new Error('Unexpected API request during presentation render'); }, ApiError: class extends Error {} };
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'prefetch')), children) };
    if (name.endsWith('.css')) return { __esModule: true, default: styles };
    if (name.startsWith('@/') || name.startsWith('.')) {
      const resolved = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load([resolved, resolved + '.tsx', resolved + '.ts'].find(p => fs.existsSync(p)));
    }
    return requireDependency(name);
  };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: isolatedRequire }, { filename });
  cache.set(filename, compiledModule.exports); return compiledModule.exports;
}
function render(relative, props) {
  return renderToStaticMarkup(React.createElement(load(path.join(src, relative)).default, props));
}
const user = { id: 'fixture', username: 'real_account_name', first_name: 'Fixture', family_name: 'Member', email: 'private@example.invalid' };
const initial = { user, membership: { status: 'ACTIVE', role: 'MEMBER' }, isLoading: false, isRefreshing: false, membershipError: null, refresh: async () => {} };

test('Active Home keeps one hero action, ordered sections, and real document routes', () => {
  account = initial;
  const html = render('app/page.tsx');
  const hero = html.slice(html.indexOf('aria-labelledby="home-heading"'), html.indexOf('</section>'));
  assert.equal((hero.match(/<a /g) || []).length, 1);
  assert.match(hero, /href="\/communities\/irm\/modules"/);
  for (const route of ['documents/saved', 'documents/recent', 'documents/mine']) {
    assert.ok(html.includes(`href="/communities/irm/${route}"`));
  }
  const headings = ['Your resources.', 'Study resources', 'Community spaces', 'Latest announcements', 'Your modules', 'Quick access', 'Your IRM access'];
  assert.deepEqual(headings.map(heading => html.indexOf(heading)), [...headings.map(heading => html.indexOf(heading))].sort((a, b) => a - b));
  assert.doesNotMatch(html, /private@example|Module 1|View calendar|TP\/TD|<footer/);
});
for (const [persona, override, guidance] of [
  ['guest', { user: null, membership: null }, 'Create an account'],
  ['nonmember', { membership: null }, 'No membership request'],
  ['pending', { membership: { status: 'PENDING', role: 'MEMBER' } }, 'Application pending'],
  ['rejected', { membership: { status: 'REJECTED', role: 'MEMBER' } }, 'Application not approved'],
  ['removed', { membership: { status: 'REMOVED', role: 'MEMBER' } }, 'Membership ended'],
  ['banned', { membership: { status: 'BANNED', role: 'MEMBER' } }, 'Access restricted'],
  ['error', { membership: null, membershipError: 'Unavailable' }, 'Retry verification'],
  ['loading', { user: null, membership: null, isLoading: true }, 'Checking your account'],
  ['refreshing', { membership: null, isRefreshing: true }, 'Checking membership'],
]) {
  test(`${persona} Home shows its current guidance without leaking private identity`, () => {
    account = { ...initial, ...override };
    const html = render('app/page.tsx'); assert.ok(html.includes(guidance));
    if (persona !== 'guest' && persona !== 'loading' && persona !== 'refreshing' && persona !== 'error') {
      assert.match(html, /href="\/communities\/irm\/modules"/);
      assert.doesNotMatch(html, /href="\/communities\/irm\/(posts|discussion|announcements|documents\/pending|documents\/mine)"/);
    }
    assert.doesNotMatch(html, /private@example/);
    if (persona === 'error') assert.doesNotMatch(html, /No membership request|Request membership/);
  });
}
test('Announcement row escapes text, preserves detail route and bounds excerpts', () => {
  const html = render('components/home/HomeAnnouncementRow.tsx', { announcement: {
    id: 'notice-42', title: '<script>unsafe()</script>', content: '<img src=x onerror=unsafe()> ' + 'x'.repeat(200), created_at: '2026-10-08T12:00:00Z',
  } });
  assert.match(html, /href="\/communities\/irm\/announcements\/notice-42"/);
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /dateTime="2026-10-08T12:00:00Z"/i); assert.match(html, /…/);
});
test('Modules retain actual names and slugs without invented counts or progress', () => {
  const html = render('components/home/HomeModuleCard.tsx', { module: { id: 'actual-module', name: 'Networks & systems', slug: 'networks-systems' } });
  assert.match(html, /href="\/communities\/irm\/modules\/networks-systems"/);
  assert.match(html, /Networks &amp; systems/); assert.doesNotMatch(html, /progress|%|documents available/);
});
test('Hero has approved copy and no duplicate action or private identity', () => {
  const html = render('components/home/HomeWelcomeHero.tsx', { username: 'irm_fixture', actionLabel: 'Browse modules', actionHref: '/communities/irm/modules' });
  assert.match(html, /Your resources/); assert.match(html, /Your people/); assert.match(html, /EtudSup/);
  assert.match(html, /Signed in as/); assert.match(html, /@irm_fixture/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.doesNotMatch(html, /<img |private@example/);
});

function region(html, labelId) {
  const start = html.indexOf(`aria-labelledby="${labelId}"`);
  assert.ok(start >= 0, `${labelId} exists`);
  return html.slice(start, html.indexOf('</section>', start));
}

test('Quick access follows the account-state route contract without duplicate navigation', () => {
  for (const [name, override, active] of [
    ['none', { membership: null }, false],
    ['pending', { membership: { status: 'PENDING', role: 'MEMBER' } }, false],
    ['rejected', { membership: { status: 'REJECTED', role: 'MEMBER' } }, false],
    ['removed', { membership: { status: 'REMOVED', role: 'MEMBER' } }, false],
    ['banned', { membership: { status: 'BANNED', role: 'MEMBER' } }, false],
    ['error', { membership: null, membershipError: 'Unavailable' }, false],
    ['checking', { membership: null, isRefreshing: true }, false],
    ['refreshing active', { membership: { status: 'ACTIVE', role: 'MEMBER' }, isRefreshing: true }, false],
    ['member', { membership: { status: 'ACTIVE', role: 'MEMBER' } }, true],
    ['moderator', { membership: { status: 'ACTIVE', role: 'MODERATOR' } }, true],
    ['delegate', { membership: { status: 'ACTIVE', role: 'DELEGATE' } }, true],
  ]) {
    account = { ...initial, ...override };
    const quick = region(render('app/page.tsx'), 'home-quick-heading');
    const hrefs = [...quick.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(hrefs, [
      '/communities/irm/documents/saved', '/communities/irm/documents/recent',
      ...(active ? ['/communities/irm/documents/mine', '/communities/irm/documents/pending'] : []),
    ], name);
    assert.doesNotMatch(quick, /Posts|Discussion|Announcements|Modules|Membership|Support|Community management/);
    assert.equal((quick.match(/<a /g) || []).length, active ? 4 : 2);
    assert.doesNotMatch(quick, /<button/);
  }
});

test('IRM access keeps one state-specific action and no active membership CTA', () => {
  for (const [name, override, action] of [
    ['none', { membership: null }, 'Request membership'],
    ['pending', { membership: { status: 'PENDING', role: 'MEMBER' } }, 'Check application'],
    ['rejected', { membership: { status: 'REJECTED', role: 'MEMBER' } }, 'Review or reapply'],
    ['removed', { membership: { status: 'REMOVED', role: 'MEMBER' } }, 'Review or reapply'],
    ['banned', { membership: { status: 'BANNED', role: 'MEMBER' } }, 'Contact Support'],
    ['error', { membership: null, membershipError: 'Unavailable' }, 'Retry verification'],
    ['active', { membership: { status: 'ACTIVE', role: 'MEMBER' } }, 'Need help? Contact Support'],
  ]) {
    account = { ...initial, ...override };
    const access = region(render('app/page.tsx'), 'home-membership-heading');
    assert.match(access, new RegExp(action.replace('?', '\\?')), name);
    assert.equal((access.match(/<a |<button /g) || []).length, 1, name);
    if (name === 'active') assert.doesNotMatch(access, /View membership|Request membership|Review or reapply/);
    if (name === 'error') assert.doesNotMatch(access, /No membership request|Access restricted/);
    if (name === 'banned') assert.doesNotMatch(access, /Request membership|Review or reapply/);
  }
});

test('Dashboard no longer repeats Delegate and capability navigation in Quick access', () => {
  for (const role of ['MEMBER', 'MODERATOR', 'DELEGATE']) {
    for (const canVote of [false, true]) {
      account = { ...initial, membership: { status: 'ACTIVE', role }, capabilities: { manage_document_voting: canVote } };
      const html = render('app/page.tsx');
      assert.doesNotMatch(region(html, 'home-quick-heading'), /membership\/review|membership\/staff|membership\/members|document-voting\/settings/);
    }
  }
});
test('Banned guidance offers Support and never reapplication', () => {
  account = { ...initial, membership: { status: 'BANNED', role: 'DELEGATE' }, capabilities: { manage_document_voting: true } };
  const html = render('app/page.tsx');
  assert.match(html, /Reapplication is unavailable/);
  assert.doesNotMatch(html, />Request membership|>Review or reapply|membership\/review|document-voting\/settings/);
});

test('Feature cards expose one named real destination without nested controls', () => {
  const html = render('components/home/DashboardActionCard.tsx', {
    title: 'Study resources', description: 'Browse approved materials.', action: 'Browse modules',
    href: '/communities/irm/modules', icon: React.createElement('svg', { 'aria-hidden': true }),
  });
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /aria-label="Study resources: Browse modules"/);
  assert.match(html, /href="\/communities\/irm\/modules"/);
  assert.doesNotMatch(html, /<button/);
});
