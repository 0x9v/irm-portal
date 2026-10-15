import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/theme.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;
const themeModule = { exports: {} };
vm.runInNewContext(compiled, { module: themeModule, exports: themeModule.exports });
const { THEME_INIT_SCRIPT, createThemeStore } = themeModule.exports;

function environment({ saved = null, dark = false, readFailure = false, writeFailure = false,
  storageFailure = false, media = 'modern' } = {}) {
  const attributes = new Map();
  const applied = [];
  const mediaListeners = new Set();
  const storageListeners = new Set();
  const writes = [];
  const query = {
    matches: dark,
    addEventListener: media === 'legacy' ? undefined : (_, fn) => mediaListeners.add(fn),
    removeEventListener: media === 'legacy' ? undefined : (_, fn) => mediaListeners.delete(fn),
    addListener: fn => mediaListeners.add(fn),
    removeListener: fn => mediaListeners.delete(fn),
  };
  const storage = {
    getItem(key) {
      assert.equal(key, 'irm-theme');
      if (readFailure) throw new Error('Storage read denied');
      return saved;
    },
    setItem(key, value) {
      if (writeFailure) throw new Error('Storage write denied');
      writes.push([key, value]);
      saved = value;
    },
  };
  const root = {
    style: {},
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute(key, value) { attributes.set(key, value); applied.push([key, value]); },
  };
  const browser = {
    document: { documentElement: root },
    get localStorage() {
      if (storageFailure) throw new Error('Storage access denied');
      return storage;
    },
    matchMedia: media === 'missing' ? undefined : name => {
      assert.equal(name, '(prefers-color-scheme: dark)');
      if (media === 'throws') throw new Error('Media query unavailable');
      return query;
    },
    addEventListener(name, fn) { assert.equal(name, 'storage'); storageListeners.add(fn); },
    removeEventListener(name, fn) { assert.equal(name, 'storage'); storageListeners.delete(fn); },
  };
  return {
    browser, root, query, applied, writes, storage, mediaListeners, storageListeners,
    bootstrap: () => vm.runInNewContext(THEME_INIT_SCRIPT, { window: browser, document: browser.document }),
    changeSystem(value) { query.matches = value; mediaListeners.forEach(fn => fn({ matches: value })); },
    storageEvent(key, value, storageArea = storage) {
      storageListeners.forEach(fn => fn({ key, newValue: value, storageArea }));
    },
  };
}

const snapshot = store => ({ ...store.getSnapshot() });

test('Bootstrap and hydrated store agree for first visits, saved choices and corrupt values', () => {
  for (const dark of [false, true]) {
    for (const saved of [null, 'system', 'light', 'dark', '', 'unknown', '{"theme":"dark"}', 'null']) {
      const env = environment({ saved, dark });
      env.bootstrap();
      const store = createThemeStore(env.browser);
      const preference = saved === 'light' || saved === 'dark' ? saved : 'system';
      const resolvedTheme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
      assert.deepEqual(snapshot(store), { preference, resolvedTheme });
      assert.equal(env.root.getAttribute('data-theme'), resolvedTheme);
      assert.equal(env.root.style.colorScheme, resolvedTheme);
      env.applied.length = 0;
      const stop = store.subscribe(() => {});
      assert(env.applied.filter(([key]) => key === 'data-theme').every(([, value]) => value === resolvedTheme));
      assert.equal(env.writes.length, 0);
      stop();
    }
  }
});

test('Storage reads/getter failures still resolve dark System, and writes cannot block selection', () => {
  for (const failure of ['readFailure', 'storageFailure']) {
    const env = environment({ dark: true, [failure]: true, writeFailure: true });
    env.bootstrap();
    assert.equal(env.root.getAttribute('data-theme'), 'dark');
    const store = createThemeStore(env.browser);
    const stop = store.subscribe(() => {});
    assert.deepEqual(snapshot(store), { preference: 'system', resolvedTheme: 'dark' });
    store.setPreference('light');
    assert.equal(env.root.getAttribute('data-theme'), 'light');
    assert.equal(store.getSnapshot().preference, 'light');
    env.changeSystem(true);
    assert.equal(env.root.getAttribute('data-theme'), 'light');
    store.setPreference('system');
    assert.equal(env.root.getAttribute('data-theme'), 'dark');
    stop();
  }
});

test('No temporary light overwrite if storage becomes inaccessible between bootstrap and hydration', () => {
  const env = environment({ saved: 'dark', dark: false });
  env.bootstrap();
  Object.defineProperty(env.browser, 'localStorage', { get() { throw new Error('Denied'); } });
  const store = createThemeStore(env.browser);
  env.applied.length = 0;
  const stop = store.subscribe(() => {});
  assert.deepEqual(snapshot(store), { preference: 'dark', resolvedTheme: 'dark' });
  assert(env.applied.filter(([key]) => key === 'data-theme').every(([, theme]) => theme === 'dark'));
  stop();
});

test('Unavailable/throwing matchMedia falls back safely; explicit preferences still work', () => {
  for (const media of ['missing', 'throws']) {
    for (const saved of [null, 'light', 'dark']) {
      const env = environment({ media, saved });
      env.bootstrap();
      const store = createThemeStore(env.browser);
      const stop = store.subscribe(() => {});
      assert.equal(env.root.getAttribute('data-theme'), saved === 'dark' ? 'dark' : 'light');
      store.setPreference('dark');
      assert.equal(env.root.getAttribute('data-theme'), 'dark');
      store.setPreference('system');
      assert.equal(env.root.getAttribute('data-theme'), 'light');
      stop();
    }
  }
});

test('Only System follows media changes; switching back resolves the live query immediately', () => {
  const env = environment();
  env.bootstrap();
  const store = createThemeStore(env.browser);
  const stop = store.subscribe(() => {});
  env.changeSystem(true);
  assert.deepEqual(snapshot(store), { preference: 'system', resolvedTheme: 'dark' });
  store.setPreference('light');
  env.changeSystem(false);
  env.changeSystem(true);
  assert.deepEqual(snapshot(store), { preference: 'light', resolvedTheme: 'light' });
  store.setPreference('system');
  assert.deepEqual(snapshot(store), { preference: 'system', resolvedTheme: 'dark' });
  store.setPreference('dark');
  env.changeSystem(false);
  assert.deepEqual(snapshot(store), { preference: 'dark', resolvedTheme: 'dark' });
  store.setPreference('system');
  assert.deepEqual(snapshot(store), { preference: 'system', resolvedTheme: 'light' });
  stop();
});

test('Cross-tab changes/removal/clear update without writing back; unrelated storage is ignored', () => {
  const env = environment({ saved: 'light', dark: true });
  const store = createThemeStore(env.browser);
  const stop = store.subscribe(() => {});
  env.storageEvent('unrelated', 'dark');
  env.storageEvent('irm-theme', 'dark', {}); // sessionStorage or another storage area
  assert.equal(store.getSnapshot().preference, 'light');
  env.storageEvent('irm-theme', 'dark');
  assert.equal(env.root.getAttribute('data-theme'), 'dark');
  env.storageEvent('irm-theme', null);
  assert.deepEqual(snapshot(store), { preference: 'system', resolvedTheme: 'dark' });
  env.storageEvent('irm-theme', 'light');
  env.storageEvent(null, null);
  assert.equal(store.getSnapshot().preference, 'system');
  env.storageEvent('irm-theme', 'corrupt');
  assert.equal(store.getSnapshot().preference, 'system');
  assert.equal(env.writes.length, 0);
  stop();
});

test('Shared subscriptions deduplicate events and clean up modern/legacy listeners', () => {
  for (const media of ['modern', 'legacy']) {
    const env = environment({ media });
    const store = createThemeStore(env.browser);
    let first = 0, second = 0;
    const stopFirst = store.subscribe(() => first++);
    const stopSecond = store.subscribe(() => second++);
    assert.equal(env.mediaListeners.size, 1);
    assert.equal(env.storageListeners.size, 1);
    env.changeSystem(true);
    assert.equal(first, 1); assert.equal(second, 1);
    stopFirst(); stopFirst();
    assert.equal(env.mediaListeners.size, 1);
    stopSecond();
    assert.equal(env.mediaListeners.size, 0);
    assert.equal(env.storageListeners.size, 0);
    env.changeSystem(false);
    assert.equal(store.getSnapshot().resolvedTheme, 'dark');
    const stopAgain = store.subscribe(() => {});
    assert.equal(store.getSnapshot().resolvedTheme, 'light');
    stopAgain();
  }
});

test('First subscription reconciles cross-tab changes made during hydration', () => {
  for (const saved of ['dark', null, 'corrupt']) {
    const env = environment({ saved: 'light', dark: true });
    env.bootstrap();
    const store = createThemeStore(env.browser);
    // No listener exists yet: emulate a change between rendering and attachment.
    env.storage.getItem = () => saved;
    const stop = store.subscribe(() => {});
    assert.deepEqual(snapshot(store), {
      preference: saved === 'dark' ? 'dark' : 'system', resolvedTheme: 'dark',
    });
    assert.equal(env.root.getAttribute('data-theme'), 'dark');
    assert.equal(env.writes.length, 0);
    stop();
  }
});

test('Resubscription retains local choices when persistence fails', () => {
  const env = environment({ dark: true, writeFailure: true });
  const store = createThemeStore(env.browser);
  let stop = store.subscribe(() => {});
  store.setPreference('light');
  stop();
  stop = store.subscribe(() => {});
  assert.deepEqual(snapshot(store), { preference: 'light', resolvedTheme: 'light' });
  assert.equal(env.root.getAttribute('data-theme'), 'light');
  stop();

  // A local interaction before the first subscription must also win.
  const early = createThemeStore(env.browser);
  early.setPreference('dark');
  early.setPreference('light');
  stop = early.subscribe(() => {});
  assert.equal(early.getSnapshot().preference, 'light');
  stop();
});

test('Only preference strings persist; reload restores them and repeated choices do not write', () => {
  const env = environment({ dark: true });
  const store = createThemeStore(env.browser);
  const stop = store.subscribe(() => {});
  for (const preference of ['light', 'dark', 'system']) {
    store.setPreference(preference);
    store.setPreference(preference);
    env.bootstrap();
    assert.equal(createThemeStore(env.browser).getSnapshot().preference, preference);
  }
  assert.deepEqual(env.writes, [['irm-theme', 'light'], ['irm-theme', 'dark'], ['irm-theme', 'system']]);
  stop();
});

test('Server snapshot is stable System content and never mutates a browser root', () => {
  const env = environment({ saved: 'dark' });
  env.bootstrap();
  const store = createThemeStore(env.browser);
  assert.deepEqual({ ...store.getServerSnapshot() }, { preference: 'system', resolvedTheme: 'light' });
  assert.equal(store.getServerSnapshot(), store.getServerSnapshot());
  assert.equal(env.root.getAttribute('data-theme'), 'dark');
  assert.equal(createThemeStore().getSnapshot().preference, 'system');
});

test('Actual theme controls SSR expose one toggle and a separate selected System action', () => {
  const loadComponent = (path, imports) => {
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const componentModule = { exports: {} };
    vm.runInNewContext(code, { module: componentModule, exports: componentModule.exports,
      require: name => imports[name] || require(name) });
    return componentModule.exports;
  };
  const context = loadComponent('../src/context/ThemeContext.tsx', { '@/lib/theme': themeModule.exports });
  const { default: selector, SystemAppearanceAction: systemAction } = loadComponent('../src/components/navigation/ThemeSelector.tsx', { '@/context/ThemeContext': context, './ThemeSelector.module.css': { default: {} }, '@/components/ui/Button': loadComponent('../src/components/ui/Button.tsx', {}) });
  const { createElement } = require('react');
  const { renderToString } = require('react-dom/server');
  const html = renderToString(createElement(context.ThemeProvider, null,
    createElement(selector), createElement(systemAction)));
  assert.equal((html.match(/aria-label="Switch to dark mode"/g) || []).length, 1);
  assert.equal((html.match(/Use system appearance/g) || []).length, 1);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.doesNotMatch(html, /<summary|<details|<fieldset|type="radio"/);
});

test('System action reverses to explicit Light; sun/moon exits System', () => {
  const componentSource = readFileSync(new URL('../src/components/navigation/ThemeSelector.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(componentSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const env = environment({ dark: true });
  env.bootstrap();
  const store = createThemeStore(env.browser);
  const stop = store.subscribe(() => {});
  const componentModule = { exports: {} };
  vm.runInNewContext(code, { module: componentModule, exports: componentModule.exports,
    require(name) {
      if (name === '@/context/ThemeContext') return { useTheme: () => ({ ...store.getSnapshot(), setPreference: store.setPreference }) };
      if (name === './ThemeSelector.module.css') return { default: {} };
      if (name === '@/components/ui/Button') return { buttonStyles: () => 'ui-button', iconButtonStyles: () => 'ui-button' };
      return require(name);
    } });
  const { SystemAppearanceAction, default: ThemeSelector } = componentModule.exports;
  let action = SystemAppearanceAction({});
  assert.equal(action.props['aria-pressed'], true);
  assert.equal(action.props.children[0].props.children, '✓');
  action.props.onClick();
  assert.deepEqual(snapshot(store), { preference: 'light', resolvedTheme: 'light' });
  assert.equal(env.root.getAttribute('data-theme-preference'), 'light');
  assert.equal(env.root.getAttribute('data-theme'), 'light');
  assert.equal(env.root.style.colorScheme, 'light');
  assert.deepEqual(env.writes, [['irm-theme', 'light']]);
  env.changeSystem(false); env.changeSystem(true);
  assert.equal(store.getSnapshot().resolvedTheme, 'light');
  env.bootstrap();
  assert.deepEqual(snapshot(createThemeStore(env.browser)), { preference: 'light', resolvedTheme: 'light' });

  action = SystemAppearanceAction({});
  assert.equal(action.props['aria-pressed'], false);
  assert.equal(action.props.children[0].props.children, '');
  action.props.onClick();
  assert.deepEqual(snapshot(store), { preference: 'system', resolvedTheme: 'dark' });
  const toggle = ThemeSelector(); toggle.props.onClick();
  assert.deepEqual(snapshot(store), { preference: 'light', resolvedTheme: 'light' });
  assert.equal(toggle.props['aria-label'], 'Switch to light mode');
  ThemeSelector().props.onClick();
  assert.deepEqual(snapshot(store), { preference: 'dark', resolvedTheme: 'dark' });
  stop();
});
