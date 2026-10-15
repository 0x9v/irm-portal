import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');
const styles = new Proxy({}, { get: (_, key) => key });

function composerHarness() {
  const slots = [];
  let cursor = 0;
  let nextId = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect() {},
    useCallback(callback) { cursor++; return callback; },
    useId() { return `picker-${++nextId}`; },
  };
  const filename = path.join(src, 'components/discussion/DiscussionComposer.tsx');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const compiledModule = { exports: {} };
  const isolatedRequire = name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '@/components/ui/Button') return { PendingLabel: () => null };
    if (name === '@/types/discussion') return {};
    if (name === '@/lib/discussion') return { STATIC_STICKERS: [] };
    if (name === '@/lib/api') return { fetchApi: async () => ({ items: [], next_cursor: null }), ApiError: class ApiError extends Error {} };
    if (name === './StickerAsset' || name === './AuthenticatedStickerImage') return { [name.slice(2)]: () => null };
    if (name === '@/components/moderation/ConfirmationDialog') return { __esModule: true, default: () => null };
    if (name.endsWith('.css')) return { __esModule: true, default: styles };
    return require(name);
  };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: isolatedRequire }, { filename });
  const Component = compiledModule.exports.DiscussionComposer;
  const render = props => { cursor = 0; return Component(props); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
  return { render, nodes };
}

test('custom-message Retry synchronously blocks repeated clicks and exposes truthful busy state', async () => {
  const harness = composerHarness();
  const pending = {
    client_message_id: '70000000-0000-4000-8000-000000000001',
    kind: 'CUSTOM_STICKER', content: null, sticker_id: null,
    custom_sticker_id: '80000000-0000-4000-8000-000000000001', error: 'Network outcome unknown',
  };
  let calls = 0;
  let release;
  const request = new Promise(resolve => { release = resolve; });
  const received = [];
  const props = {
    userId: 'user-one', pendingSubmission: pending,
    onSendText: async () => true, onSendSticker: async () => true, onSendCustomSticker: async () => true,
    onRetrySubmission: async value => { calls++; received.push(value); await request; return true; },
  };
  const button = () => harness.nodes(harness.render(props)).find(node => node.type === 'button' && ['Retry', 'Retrying...'].includes(node.props.children));
  const retry = button();
  retry.props.onClick();
  retry.props.onClick();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(received[0], pending);

  const busy = button();
  assert.equal(busy.props.disabled, true);
  assert.equal(busy.props['aria-busy'], true);
  assert.equal(busy.props.children, 'Retrying...');

  release();
  await new Promise(resolve => setImmediate(resolve));
  const ready = button();
  assert.equal(ready.props.disabled, false);
  assert.equal(ready.props['aria-busy'], false);
  assert.equal(ready.props.children, 'Retry');
  assert.equal(pending.client_message_id, '70000000-0000-4000-8000-000000000001');
  assert.equal(pending.custom_sticker_id, '80000000-0000-4000-8000-000000000001');
});
