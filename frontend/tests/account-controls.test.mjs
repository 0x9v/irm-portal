// Render actual shell components and exercise the actual logout caller without HTTP.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');
const styles = new Proxy({}, { get: (_, key) => key });
let account;
let pathname = '/';
function loader(react = React, router = { push() {} }) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const compiledModule = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const isolatedRequire = name => {
      if (name === 'react') return react;
      if (name === '@/context/AuthContext') return { useAuth: () => account };
      if (name === '@/context/ThemeContext') return { useTheme: () => ({ preference: 'system', resolvedTheme: 'light', setPreference() {} }) };
      if (name === 'next/navigation') return { usePathname: () => pathname, useRouter: () => router };
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'prefetch')), children) };
      if (name.endsWith('.css')) return { __esModule: true, default: styles };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const resolved = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load([resolved, resolved + '.tsx', resolved + '.ts'].find(p => fs.existsSync(p)));
      }
      return require(name);
    };
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: isolatedRequire, Error, process }, { filename });
    cache.set(filename, compiledModule.exports); return compiledModule.exports;
  }
  return relative => load(path.join(src, relative));
}
const load = loader();
const user = { id: 'f8-user', username: 'actual_account_name', email: 'private-email', first_name: 'PrivateFirst', family_name: 'PrivateFamily' };
const initial = { user, membership: { status: 'ACTIVE', role: 'DELEGATE', cne: 'private-cne', promotion: 'private-promotion', applicant_first_name: 'private-applicant' }, capabilities: { manage_document_voting: true }, isLoading: false, isRefreshing: false, isLoggingOut: false, error: null, membershipError: null, logout: async () => {} };
function render(relative, props) { return renderToStaticMarkup(React.createElement(load(relative).default, props)); }

test('Signed-in member, pending and Delegate shell retain navigation while actions move to headers', () => {
  pathname = '/';
  for (const [status, role] of [['ACTIVE', 'MEMBER'], ['PENDING', 'MEMBER'], ['ACTIVE', 'DELEGATE']]) {
    account = { ...initial, membership: { ...initial.membership, status, role } };
    const html = render('components/layout/ApplicationShell.tsx', { copyrightYear: new Date().getFullYear(), children: React.createElement('main', null, 'Route content') });
    assert.match(html, /aria-label="Context Bar"/);
    assert.match(html, /aria-label="Mobile bottom navigation"/);
    const sidebar = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    assert.doesNotMatch(sidebar, /Account options|Appearance options|Logout|href="\/support"/);
    assert.match(sidebar, /href="\/account"/);
    assert.match(sidebar, /actual_account_name.*View account/);
    assert.equal(sidebar.includes('Review applications'), status === 'ACTIVE' && role === 'DELEGATE');
    assert.equal(sidebar.includes('Announcements'), status === 'ACTIVE');
    assert.doesNotMatch(html, /private-email|PrivateFirst|PrivateFamily|private-cne|private-promotion|private-applicant/);
  }
});

test('Guest, initial loading, login and register retain their public shell selection', () => {
  for (const route of ['/', '/support', '/login', '/register']) {
    pathname = route;
    for (const override of [{ user: null, isLoading: false }, { user: null, isLoading: true }]) {
      account = { ...initial, ...override };
      const html = render('components/layout/ApplicationShell.tsx', { copyrightYear: new Date().getFullYear(), children: React.createElement('main', null, 'Public content') });
      assert.doesNotMatch(html, /Desktop Sidebar|Account options|Mobile bottom navigation/);
      if (route === '/login' || route === '/register') assert.match(html, /data-public-account-frame/);
      if (route === '/') assert.match(html, /data-public-home-frame/);
    }
  }
});

test('Long identity is fully present in the associated disclosure; no private or fake profile actions', () => {
  account = { ...initial, user: { ...user, username: 'long_actual_name_'.repeat(30) } };
  const html = render('components/navigation/AccountControls.tsx', { open: true, onOpenChange() {} });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /role="region" aria-label="Account options"/);
  assert.match(html, /<strong>long_actual_name_/);
  assert.match(html, /href="\/support"/);
  assert.match(html, /href="\/account"/);
  assert.equal((html.match(/href="\/account"/g) || []).length, 1);
  assert.doesNotMatch(html, />My account</);
  assert.match(html, /aria-label="Logout"/);
  assert.match(html, /Use system appearance/);
  assert.doesNotMatch(html, /Appearance options|<summary|<details/);
  assert.doesNotMatch(html, /role="menu|private-email|private-cne|<img/);
  const id = html.match(/aria-controls="([^"]+)"/)[1];
  assert.ok(html.includes(`id="${id}"`));
});

test('Account trigger reserves a compact decorative avatar and keeps its accessible button name', () => {
  account = { ...initial, user: { ...user, avatar_url: `/api/v1/users/${user.id}/avatar/version-one` } };
  const html = render('components/navigation/AccountControls.tsx', { open: false, onOpenChange() {} });
  const trigger = html.match(/<button[^>]*aria-label="Account options"[\s\S]*?<\/button>/)?.[0];
  assert.ok(trigger);
  assert.match(trigger, /class="avatar compact" aria-hidden="true"/);
  assert.match(trigger, /actual_account_name/);
  assert.doesNotMatch(trigger, /role="img"|aria-label="actual_account_name/);
  assert.match(html, /Use system appearance/);
});

test('Account page shows only owner identity and separates checking, guest and error states', () => {
  pathname = '/account';
  account = { ...initial, user: { ...user, avatar_url: null } };
  let html = render('app/account/page.tsx', {});
  for (const detail of ['actual_account_name', 'PrivateFirst', 'PrivateFamily', 'private-email']) assert.match(html, new RegExp(detail));
  assert.match(html, /aria-label="actual_account_name&#x27;s avatar"/);
  assert.match(html, /Security.*Change password/);
  assert.doesNotMatch(html, /f8-user|private-cne|private-applicant|current_password|new_password|<img/);

  for (const membership of [null, { status: 'BANNED', role: 'MEMBER' }]) {
    account = { ...initial, user: { ...user, avatar_url: null }, membership };
    html = render('app/account/page.tsx', {});
    assert.match(html, /private-email/);
    assert.doesNotMatch(html, /Sign in to view your account/);
  }

  account = { ...initial, user: { ...user, avatar_url: null, first_name: '', family_name: '' } };
  html = render('app/account/page.tsx', {});
  assert.equal((html.match(/Not provided/g) || []).length, 2);

  for (const override of [
    { user: null, isLoading: true },
    { user, isRefreshing: true },
    { user, isLoggingOut: true },
  ]) {
    account = { ...initial, ...override };
    html = render('app/account/page.tsx', {});
    assert.match(html, /Checking your account/);
    assert.doesNotMatch(html, /href="\/login"/);
    if (override.user) assert.match(html, /<div hidden="" class="profileContent">/);
    else assert.doesNotMatch(html, /private-email|PrivateFirst|PrivateFamily/);
  }
  account = { ...initial, user: null };
  html = render('app/account/page.tsx', {});
  assert.match(html, /Sign in to view your account/);
  assert.match(html, /href="\/login"/);
  assert.doesNotMatch(html, /private-email/);
  account = { ...initial, error: 'raw private exception' };
  html = render('app/account/page.tsx', {});
  assert.match(html, /Retry account check/);
  assert.doesNotMatch(html, /raw private exception/);
  assert.match(html, /<div hidden="" class="profileContent">/);
});

test('Account shell withholds the prior identity during refresh, logout and auth errors', () => {
  pathname = '/account';
  for (const override of [{ isRefreshing: true }, { isLoggingOut: true }, { error: 'network failure' }]) {
    account = { ...initial, ...override };
    const html = render('components/layout/ApplicationShell.tsx', { copyrightYear: 2026, children: React.createElement('main', null, 'Checking') });
    assert.doesNotMatch(html, /actual_account_name|Account options|private-email|href="\/login"/);
    assert.match(html, /data-guest-home-shell/);
  }
});

test('Sidebar profile uses the current account and hides it during transitions', () => {
  pathname = '/';
  account = initial;
  let html = render('components/navigation/SidebarNav.tsx', {});
  assert.match(html, /href="\/account"/);
  assert.match(html, /actual_account_name.*View account/);
  account = { ...initial, user: { ...user, id: 'next-account', username: 'next_student', avatar_url: null } };
  html = render('components/navigation/SidebarNav.tsx', {});
  assert.match(html, /next_student.*View account/);
  assert.doesNotMatch(html, /actual_account_name/);
  for (const override of [{ user: null }, { isLoading: true }, { isRefreshing: true }, { isLoggingOut: true }, { error: 'Session failed' }]) {
    account = { ...initial, ...override };
    assert.doesNotMatch(render('components/navigation/SidebarNav.tsx', {}), /href="\/account"|View account/);
  }
});

test('Mobile header DOM begins with Menu and guests keep System in their navigation shell', () => {
  account = initial;
  pathname = '/';
  const header = render('components/navigation/MobileHeader.tsx', {});
  assert.ok(header.indexOf('aria-label="Open navigation menu"') < header.indexOf('aria-label="EtudSup Home"'));
  assert.ok(header.indexOf('aria-label="EtudSup Home"') < header.indexOf('data-theme-control'));
  assert.ok(header.indexOf('data-theme-control') < header.indexOf('aria-label="Account options"'));
  assert.equal((header.match(/data-theme-control/g) || []).length, 1);
  const guest = render('components/home/GuestHomeShell.tsx', { confirmed: true, children: React.createElement('main', null, 'Help') });
  assert.match(guest, /Use system appearance/);
  assert.doesNotMatch(guest, /aria-label="Account options"/);
});

// Minimal state/ref adapter for the actual AccountPanel function, preserving state
// across renders. No copy of its pending/error/logout logic is implemented here.
function panelHarness(logout) {
  const slots = []; let cursor = 0; let navigated = 0; const pushes = [];
  const hooks = { ...React,
    useState(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = initialValue; return [slots[index], value => { slots[index] = value; }]; },
    useRef(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initialValue }; return slots[index]; },
  };
  account = { ...initial, logout };
  const Panel = loader(hooks, { push: href => pushes.push(href) })('components/navigation/AccountPanel.tsx').default;
  const renderPanel = () => { cursor = 0; return Panel({ onNavigate: () => { navigated++; } }); };
  function elements(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(elements)]; }
  const find = match => elements(renderPanel()).find(match);
  return { find, pushes, navigated: () => navigated, text: () => renderToStaticMarkup(renderPanel()) };
}

test('Actual logout caller blocks duplicate submits, exposes pending and navigates after success', async () => {
  let release; let calls = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const panel = panelHarness(async () => { calls++; await wait; });
  const action = panel.find(node => node.props?.['aria-label'] === 'Logout').props.onClick;
  const pending = action();
  await action();
  assert.equal(calls, 1);
  assert.equal(panel.find(node => node.props?.['aria-label'] === 'Logout').props.disabled, true);
  assert.match(panel.text(), /role="status"[^>]*>Signing out/);
  assert.deepEqual(panel.pushes, []);
  release(); await pending;
  assert.equal(panel.navigated(), 1);
  assert.deepEqual(panel.pushes, ['/login']);
});

for (const timeout of [false, true]) {
  test(`Actual logout ${timeout ? 'timeout' : 'failure'} retains retry feedback and succeeds on retry`, async () => {
    let calls = 0;
    const panel = panelHarness(async () => {
      if (++calls === 1) { const failure = new Error('private technical detail'); if (timeout) failure.name = 'AbortError'; throw failure; }
    });
    await panel.find(node => node.props?.['aria-label'] === 'Logout').props.onClick();
    assert.equal(panel.navigated(), 0);
    assert.deepEqual(panel.pushes, []);
    assert.match(panel.text(), timeout ? /Logout request timed out/ : /Logout failed/);
    assert.doesNotMatch(panel.text(), /private technical detail/);
    assert.equal(panel.find(node => node.props?.['aria-label'] === 'Logout').props.disabled, false);
    await panel.find(node => node.type === 'button' && node.props.children === 'Retry logout').props.onClick();
    assert.equal(calls, 2);
    assert.equal(panel.navigated(), 1);
    assert.deepEqual(panel.pushes, ['/login']);
  });
}
