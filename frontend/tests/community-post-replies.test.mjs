import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/postReplyImages.ts');
const moduleObject = { exports: {} };
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
vm.runInNewContext(js, {
  module: moduleObject,
  exports: moduleObject.exports,
  require(name) {
    if (name === '@/lib/api') return { API_URL: 'https://api.example.test' };
    if (name === '@/types/posts') return {};
    throw new Error(`Unexpected import ${name}`);
  },
  crypto: webcrypto,
  URL,
  Date,
});
const { createPostReplyRequestId, isValidPostReplyResponse, MAX_POST_REPLY_IMAGE_BYTES } = moduleObject.exports;

const postId = 'a0000000-0000-4000-8000-000000000001';
const replyId = 'b0000000-0000-4000-8000-000000000002';
const baseReply = {
  id: replyId,
  post_id: postId,
  author_username: 'member',
  content: 'reply text',
  created_at: '2026-10-14T12:00:00Z',
  image_url: null,
};

test('reply image picker limit matches the 5 MiB backend cap', () => {
  assert.equal(MAX_POST_REPLY_IMAGE_BYTES, 5_242_880);
});

test('each new logical reply receives a canonical UUIDv4', () => {
  assert.match(createPostReplyRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('validates text-only and image reply confirmations against the exact private route', () => {
  assert.equal(isValidPostReplyResponse(baseReply, 'irm', postId, 'reply text', false), true);
  const withImage = {
    ...baseReply,
    image_url: `/api/v1/communities/irm/posts/${postId}/replies/${replyId}/image`,
  };
  assert.equal(isValidPostReplyResponse(withImage, 'irm', postId, 'reply text', true), true);
  assert.equal(isValidPostReplyResponse({ ...withImage, image_url: 'https://evil.test/image' }, 'irm', postId, 'reply text', true), false);
  assert.equal(isValidPostReplyResponse({ ...withImage, image_url: `${withImage.image_url}?cache=1` }, 'irm', postId, 'reply text', true), false);
});

test('rejects mismatched parent, text, malformed reply IDs and missing expected media', () => {
  assert.equal(isValidPostReplyResponse({ ...baseReply, post_id: 'c0000000-0000-4000-8000-000000000003' }, 'irm', postId, 'reply text', false), false);
  assert.equal(isValidPostReplyResponse({ ...baseReply, content: 'other' }, 'irm', postId, 'reply text', false), false);
  assert.equal(isValidPostReplyResponse({ ...baseReply, id: 'not-a-uuid' }, 'irm', postId, 'reply text', false), false);
  assert.equal(isValidPostReplyResponse(baseReply, 'irm', postId, 'reply text', true), false);
});
