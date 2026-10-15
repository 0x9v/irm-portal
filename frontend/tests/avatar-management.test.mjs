import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function load(filename, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, ...globals }, { filename });
  return compiledModule.exports;
}

const avatar = load(path.resolve('src/lib/avatarManagement.ts'));
const userId = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';

test('avatar picker checks empty, 2 MiB and declared JPEG/PNG without trusting extensions', () => {
  assert.match(avatar.avatarFileError({ size: 0, type: 'image/png' }), /nonempty/);
  assert.match(avatar.avatarFileError({ size: 2_097_153, type: 'image/png' }), /2 MiB/);
  assert.match(avatar.avatarFileError({ size: 100, type: 'image/gif' }), /JPEG or PNG/);
  assert.equal(avatar.avatarFileError({ size: 2_097_152, type: 'image/jpeg' }), null);
  assert.equal(avatar.avatarFileError({ size: 100, type: 'image/png' }), null);
});

test('response URLs are scoped to the current account and one immutable version path', () => {
  assert.equal(avatar.isOwnedAvatarUrl(`/api/v1/users/${userId}/avatar/${version}`, userId), true);
  assert.equal(avatar.isOwnedAvatarUrl(`/api/v1/users/${version}/avatar/${version}`, userId), false);
  assert.equal(avatar.isOwnedAvatarUrl(`/api/v1/users/${userId}/avatar/${version}?x=1`, userId), false);
  assert.equal(avatar.isOwnedAvatarUrl('https://other.test/image.jpg', userId), false);
  assert.equal(avatar.hasAvatarResponse({ avatar_url: null }), true);
  assert.equal(avatar.hasAvatarResponse({}), false);
});

let response = new Response(JSON.stringify({ avatar_url: `/api/v1/users/${userId}/avatar/${version}` }), { status: 200 });
let request;
const api = load(path.resolve('src/lib/api.ts'), {
  process: { env: { NEXT_PUBLIC_API_URL: 'https://api.example.test' } },
  Headers, FormData,
  fetch: async (url, options) => { request = { url, options }; return response; },
});

test('avatar upload is credentialed multipart with browser boundary; DELETE has no body or JSON header', async () => {
  const form = new FormData();
  form.append('file', new Blob(['image'], { type: 'image/png' }), 'photo.png');
  await api.fetchApi('/api/v1/auth/me/avatar', { method: 'PUT', body: form }, 200);
  assert.equal(request.url, 'https://api.example.test/api/v1/auth/me/avatar');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.body, form);
  assert.equal(request.options.headers.has('Content-Type'), false);
  assert.equal(request.options.headers.has('Origin'), false);
  response = new Response(JSON.stringify({ avatar_url: null }), { status: 200 });
  await api.fetchApi('/api/v1/auth/me/avatar', { method: 'DELETE' }, 200, 'none');
  assert.equal(request.options.body, undefined);
  assert.equal(request.options.headers.has('Content-Type'), false);
});
