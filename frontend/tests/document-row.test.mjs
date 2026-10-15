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
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/DocumentRow.tsx');
const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const compiled = { exports: {} };
const isolatedRequire = name => {
  if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
  if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
  return requireDependency(name);
};
vm.runInNewContext(code, { module: compiled, exports: compiled.exports, require: isolatedRequire }, { filename: source });
const DocumentRow = compiled.exports.default;

test('document row keeps an escaped title link and sibling action with page-specific metadata', () => {
  const html = renderToStaticMarkup(React.createElement(DocumentRow, {
    title: '<private path> Long title',
    openHref: '/communities/irm/modules/algebra/documents/approved-1',
    context: React.createElement('span', null, 'Algebra'),
    metadata: React.createElement('time', { dateTime: '2026-04-02T10:30:00Z' }, 'Last opened'),
    actions: React.createElement('button', { type: 'button' }, 'Remove from saved'),
  }));
  assert.match(html, /<article class="row">/);
  assert.match(html, /&lt;private path&gt; Long title/);
  assert.match(html, /<\/a><\/h3>/);
  assert.match(html, /<\/div><div class="metadata">/);
  assert.match(html, /<button type="button">Remove from saved<\/button>/);
  assert.match(html, /dateTime="2026-04-02T10:30:00Z"/i);
  assert.ok(html.indexOf('<button') > html.indexOf('</a>'));
});

test('pending and rejected presentation can omit a reader link or all file actions', () => {
  const html = renderToStaticMarkup(React.createElement(DocumentRow, {
    title: 'Rejected upload',
    metadata: React.createElement('span', null, 'Not approved'),
    status: React.createElement('span', null, 'Not approved'),
  }));
  assert.match(html, /Rejected upload/);
  assert.doesNotMatch(html, /<a |<button|class="actions"/);
});
