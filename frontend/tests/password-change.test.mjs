import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const filename = path.resolve('src/lib/passwordChange.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: name => {
  if (name === './api') return { ApiError };
  throw new Error(`Unexpected import: ${name}`);
} }, { filename });
const { validatePasswordChange, passwordServerErrors } = compiledModule.exports;

const apiFilename = path.resolve('src/lib/api.ts');
const apiCode = ts.transpileModule(fs.readFileSync(apiFilename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const apiModule = { exports: {} };
let response = new Response(null, { status: 204 });
let request;
vm.runInNewContext(apiCode, {
  module: apiModule, exports: apiModule.exports,
  process: { env: { NEXT_PUBLIC_API_URL: 'https://api.example.test' } },
  Headers, FormData,
  fetch: async (url, options) => { request = { url, options }; return response; },
}, { filename: apiFilename });

test('password validation counts code points and preserves significant whitespace', () => {
  assert.deepEqual({ ...validatePasswordChange({ current_password: ' old ', new_password: '😀😀😀😀😀😀😀😀', confirm_password: '😀😀😀😀😀😀😀😀' }) }, {});
  assert.match(validatePasswordChange({ current_password: '', new_password: '😀😀😀😀😀😀😀', confirm_password: '😀😀😀😀😀😀😀' }).current_password, /current password/);
  assert.match(validatePasswordChange({ current_password: 'samepass', new_password: 'samepass', confirm_password: 'samepass' }).new_password, /different/);
  assert.match(validatePasswordChange({ current_password: 'oldpass!', new_password: ' newpass! ', confirm_password: 'newpass!' }).confirm_password, /do not match/);
});

test('sanitized backend errors map only password field locations without echoing secrets', () => {
  assert.deepEqual({ ...passwordServerErrors(new ApiError(400, 'Private error')) }, { current_password: 'Your current password is incorrect.' });
  const details = [
    { loc: ['body', 'new_password'], type: 'password_unchanged', msg: 'Secret value' },
    { loc: ['body', 'current_password'], type: 'string_too_short', msg: 'Secret value' },
    { loc: ['body', 'confirm_password'], type: 'extra_forbidden', msg: 'Ignored' },
  ];
  const errors = passwordServerErrors(new ApiError(422, 'Private error', details));
  assert.deepEqual(Object.keys(errors).sort(), ['current_password', 'new_password']);
  assert.doesNotMatch(Object.values(errors).join(' '), /Secret|Private/);
});

test('credentialed JSON API confirms only an exact empty 204 for password change', async () => {
  const payload = { current_password: ' old pass ', new_password: '😀😀😀😀😀😀😀😀' };
  assert.equal(await apiModule.exports.fetchApi('/api/v1/auth/me/password', {
    method: 'POST', body: JSON.stringify(payload),
  }, 204), undefined);
  assert.equal(request.url, 'https://api.example.test/api/v1/auth/me/password');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.headers.get('Content-Type'), 'application/json');
  assert.equal(request.options.headers.has('Origin'), false);
  assert.deepEqual(JSON.parse(request.options.body), payload);
  response = new Response('{}', { status: 200 });
  await assert.rejects(apiModule.exports.fetchApi('/api/v1/auth/me/password', { method: 'POST', body: JSON.stringify(payload) }, 204), /Unexpected response status/);
});
