// Exercise the actual shared controls, not copies of their class-name mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const filename = new URL('../src/components/ui/Button.tsx', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const actualModule = { exports: {} };
vm.runInNewContext(compiled, { module: actualModule, exports: actualModule.exports, require });
const { default: Button, PendingLabel, buttonStyles } = actualModule.exports;

test('Operations preserve native type, form association, ref and callback', () => {
  let called = 0;
  const ref = React.createRef();
  const control = Button({ type: 'submit', form: 'membership-request', ref, onClick: () => called++, children: 'Request membership' });
  assert.equal(control.type, 'button');
  assert.equal(control.props.type, 'submit');
  assert.equal(control.props.form, 'membership-request');
  assert.equal(control.props.ref, ref);
  control.props.onClick();
  assert.equal(called, 1);
  assert.equal(control.props.children, 'Request membership');
});

test('Pending prevents native submission while keeping the accessible action name', () => {
  const html = renderToStaticMarkup(React.createElement(Button, { type: 'submit', pending: true }, 'Publish announcement'));
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""[^>]*aria-busy="true"/);
  assert.match(html, />Publish announcement<\/button>/);
  assert.doesNotMatch(html, /<a /);
  const disabled = Button({ disabled: true, pending: false, children: 'Publish announcement' });
  assert.equal(disabled.props.disabled, true);
  assert.equal(disabled.props['aria-busy'], undefined);
});

test('Navigation retains anchors, destinations and external-link protection', () => {
  for (const href of ['/', '/communities/irm/modules', '/support']) {
    const html = renderToStaticMarkup(React.createElement('a', { href, className: buttonStyles('secondary') }, 'Go'));
    assert.ok(html.startsWith(`<a href="${href}"`));
    assert.doesNotMatch(html, /<button|role="button"/);
  }
  const html = renderToStaticMarkup(React.createElement('a', { href: 'https://example.invalid', target: '_blank', rel: 'noopener noreferrer', className: buttonStyles('primary') }, 'Contact'));
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test('Pending labels reserve both copies but expose only the current copy', () => {
  for (const pending of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(PendingLabel, { pending, idle: 'Save document', busy: 'Saving…' }));
    assert.match(html, new RegExp(`aria-hidden="${pending}" style="visibility:${pending ? 'hidden' : 'visible'}">Save document`));
    assert.match(html, new RegExp(`aria-hidden="${!pending}" style="visibility:${pending ? 'visible' : 'hidden'}">Saving…`));
  }
});

test('Icon controls retain name, pressed and expanded state', () => {
  const control = Button({ type: 'button', variant: 'secondary', 'aria-label': 'Zoom out', 'aria-pressed': false, 'aria-expanded': true, children: '−' });
  assert.equal(control.props['aria-label'], 'Zoom out');
  assert.equal(control.props['aria-pressed'], false);
  assert.equal(control.props['aria-expanded'], true);
});

test('Danger foreground contrasts with its actual fill in every light/dark action state', () => {
  const css = fs.readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  const blocks = [css.slice(css.indexOf(':root {'), css.indexOf('html[data-theme="dark"]')), css.slice(css.indexOf('html[data-theme="dark"]'), css.indexOf('@theme inline'))];
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  for (const block of blocks) {
    const value = token => block.match(new RegExp(`--${token}: (#[A-Fa-f0-9]{6});`))[1];
    const fg = luminance(value('on-danger-action'));
    for (const token of ['danger-action', 'danger-action-hover', 'danger-action-pressed']) {
      const bg = luminance(value(token));
      assert.ok((Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) >= 4.5, token);
    }
  }
});
