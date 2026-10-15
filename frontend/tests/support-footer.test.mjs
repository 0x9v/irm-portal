// Actual component rendering with local configuration/auth fixtures; no backend.
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
let pathname = '/support';
let account;
const styles = new Proxy({}, { get: (_, key) => key });
function loader(number) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const compiledModule = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const isolatedRequire = name => {
      if (name === '@/context/AuthContext') return { useAuth: () => account };
      if (name === '@/context/ThemeContext') return { useTheme: () => ({ preference: 'system', resolvedTheme: 'light', setPreference() {} }) };
      if (name === 'next/navigation') return { usePathname: () => pathname, useRouter: () => ({ push() {} }) };
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'prefetch')), children) };
      if (name.endsWith('.css')) return { __esModule: true, default: styles };
      if (name === '@/lib/api') return { fetchApi() { throw new Error('Unexpected request in rendering test'); }, ApiError: class extends Error {} };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const resolved = name.startsWith('@/') ? path.join(src, name.slice(2)) : path.resolve(path.dirname(filename), name);
        return load([resolved, resolved + '.tsx', resolved + '.ts'].find(p => fs.existsSync(p)));
      }
      return require(name);
    };
    vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: isolatedRequire,
      process: { env: { NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER: number } } }, { filename });
    cache.set(filename, compiledModule.exports); return compiledModule.exports;
  }
  return relative => load(path.join(src, relative)).default;
}
const user = { id: 'f9', username: 'actual_student', email: 'private-email', first_name: 'PrivateFirst', family_name: 'PrivateFamily' };
const initial = { user, membership: { status: 'ACTIVE', role: 'MEMBER', cne: 'private-cne' }, isLoading: false, isRefreshing: false, isLoggingOut: false, error: null, membershipError: null, capabilities: {}, refresh: async () => {}, logout: async () => {} };
function support(number, override = {}) {
  pathname = '/support'; account = { ...initial, ...override };
  const load = loader(number);
  return renderToStaticMarkup(React.createElement(load('components/layout/ApplicationShell.tsx'), { copyrightYear: 2031 }, React.createElement(load('app/support/page.tsx'))));
}
for (const number of [undefined, '', '+212600000000', 'invalid', '123456', '1'.repeat(16), '1234567?text=other']) {
  test(`Unavailable/malformed contact ${JSON.stringify(number)} has no dead contribution link`, () => {
    const html = support(number, { user: null, membership: null });
    assert.match(html, /Support <span>EtudSup/);
    assert.match(html, /Contribution details are not yet available/);
    assert.match(html, /Online contact details are not yet available/);
    assert.doesNotMatch(html, /https:\/\/wa.me|Donate now|Support IRM Hub|tax-deductible|registered charity/);
    const nav = html.slice(html.indexOf('<nav aria-label="Support page navigation"'), html.indexOf('</nav>', html.indexOf('<nav aria-label="Support page navigation"')));
    assert.match(nav, /href="\/login"/);
    assert.doesNotMatch(nav, /communities\/irm\/modules/);
  });
}

test('Configured existing WhatsApp uses safe, distinct supporting/help conversations', () => {
  // Synthetic test data; never written to application environment/configuration.
  const html = support(' 212600000000 ');
  const links = [...html.replaceAll('&#x27;', "'").replaceAll('&amp;', '&').matchAll(/<a href="(https:\/\/wa\.me\/[^\"]+)"[^>]+>/g)];
  assert.equal(links.length, 2);
  assert.ok(links[0][1].includes(encodeURIComponent("Hi! I'd like to support EtudSup. How can I contribute?")));
  assert.ok(links[1][1].includes(encodeURIComponent('Hi! I need help with my EtudSup account or IRM community access.')));
  for (const [anchor] of links) { assert.match(anchor, /target="_blank"/); assert.match(anchor, /rel="noopener noreferrer"/); }
  assert.match(html, /Contact us about supporting EtudSup/);
  assert.match(html, /does not process a payment/);
  assert.doesNotMatch(html, /Contribution details are not yet available/);
  assert.doesNotMatch(links.map(link => link[1]).join(''), /actual_student|private-email|private-cne/);
});

for (const [label, override, destination] of [
  ['guest', { user: null, membership: null }, '/login'],
  ['signed in', {}, '/communities/irm/modules'],
  ['pending', { membership: { status: 'PENDING', role: 'MEMBER' } }, '/communities/irm/modules'],
  ['restricted', { membership: { status: 'BANNED', role: 'MEMBER' } }, '/communities/irm/modules'],
  ['loading', { user: null, isLoading: true }, null],
  ['auth error', { user: null, error: 'Unavailable' }, null],
]) {
  test(`${label} keeps help separate and uses real bottom destinations`, () => {
    const html = support(undefined, override);
    const start = html.indexOf('<nav aria-label="Support page navigation"');
    const nav = html.slice(start, html.indexOf('</nav>', start));
    assert.match(nav, /href="\/"[^>]*class="ui-button ui-button--secondary/);
    assert.match(nav, /Back to Home/);
    if (destination) assert.ok(nav.includes(`href="${destination}"`));
    else assert.equal((nav.match(/<a /g) || []).length, 1);
    assert.match(html, /Help is available independently of contributions/);
    assert.doesNotMatch(html, /private-email|PrivateFirst|private-cne/);
    if (label === 'pending') { assert.match(html, /awaiting manual review/); assert.match(html, /Check application status/); }
    if (label === 'restricted') { assert.match(html, /contributing does not change that decision/); assert.doesNotMatch(html, /Check application status|View IRM membership|Reapply/); }
  });
}

test('All ordinary shell branches render one generated-year footer after main content', () => {
  for (const route of ['/', '/support', '/login', '/register', '/communities/irm/modules']) {
    for (const signedIn of [false, true]) {
      pathname = route; account = { ...initial, user: signedIn ? user : null };
      const load = loader();
      const child = route === '/' ? React.createElement(load(signedIn ? 'app/page.tsx' : 'components/home/GuestHome.tsx'))
        : route === '/login' || route === '/register'
          ? React.createElement(load('components/auth/AccountPage.tsx'), { kind: route.slice(1) }, React.createElement('h1', null, 'Account form'))
          : React.createElement('main', null, 'All route content');
      const html = renderToStaticMarkup(React.createElement(load('components/layout/ApplicationShell.tsx'), { copyrightYear: 2031 }, child));
      assert.equal((html.match(/data-site-footer/g) || []).length, 1, `${route} ${signedIn}`);
      assert.equal((html.match(/<footer/g) || []).length, 1);
      assert.equal((html.match(/<main/g) || []).length, 1);
      assert.match(html, /© 2031 EtudSup · v0.1 · All rights reserved./);
      assert.ok(html.indexOf('data-site-footer') > html.indexOf('</main>'));
      if (route === '/' && signedIn) {
        for (const section of ['Your resources.', 'Your modules', 'Quick access', 'Your IRM access']) assert.ok(html.indexOf(section) < html.indexOf('data-site-footer'));
      }
    }
  }
});

test('Document reading and Discussion omit copyright in every auth state', () => {
  for (const route of ['/communities/irm/discussion', '/communities/irm/modules/algo/documents/doc-1']) {
    for (const signedIn of [false, true]) {
      pathname = route; account = { ...initial, user: signedIn ? user : null };
      const html = renderToStaticMarkup(React.createElement(loader()('components/layout/ApplicationShell.tsx'), { copyrightYear: 2031 }, React.createElement('main', null, 'Reader or composer')));
      assert.doesNotMatch(html, /data-site-footer|All rights reserved/);
    }
  }
});
