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
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/ContentState.tsx');
const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const compiled = { exports: {} };
const isolatedRequire = name => name.endsWith('.css')
  ? { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) }
  : requireDependency(name);
vm.runInNewContext(code, { module: compiled, exports: compiled.exports, require: isolatedRequire }, { filename: source });
const { ContentLoading, ContentEmpty } = compiled.exports;

test('loading announces one concise status and hides the skeleton geometry', () => {
  const html = renderToStaticMarkup(React.createElement(ContentLoading, { label: 'Loading documents…', kind: 'document', count: 2 }));
  assert.equal((html.match(/role="status"/g) || []).length, 1);
  assert.equal((html.match(/class="skeleton document"/g) || []).length, 2);
  assert.match(html, /aria-hidden="true"/);
  assert.ok(html.indexOf('aria-hidden="true"') > html.indexOf('Loading documents'));
});

test('empty state has a heading, explanation and one real action slot', () => {
  const html = renderToStaticMarkup(React.createElement(ContentEmpty, {
    title: 'No saved documents yet.',
    description: 'Save approved resources from a module.',
    action: React.createElement('a', { href: '/communities/irm/modules' }, 'Browse modules'),
  }));
  assert.match(html, /<h3 class="emptyTitle">No saved documents yet\.<\/h3>/);
  assert.match(html, /Save approved resources from a module\./);
  assert.match(html, /href="\/communities\/irm\/modules"/);
  assert.doesNotMatch(html, /role="alert"|role="status"/);
});
