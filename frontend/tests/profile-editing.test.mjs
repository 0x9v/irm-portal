import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const filename = path.resolve('src/lib/profileEditing.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, require: name => {
  if (name === './api') return { ApiError };
  throw new Error(`Unexpected import: ${name}`);
} }, { filename });
const { profileChanges, validateProfileChanges, profileServerErrors } = compiledModule.exports;
const saved = { username: 'Sara', first_name: 'سارة', family_name: 'El Mansouri' };

test('partial payload contains only changed normalized fields, preserving Unicode and case', () => {
  assert.deepEqual({ ...profileChanges({ ...saved, first_name: '  آمينة  ' }, saved) }, { first_name: 'آمينة' });
  assert.deepEqual({ ...profileChanges({ ...saved, username: ' Sara ' }, saved) }, {});
  assert.deepEqual({ ...profileChanges({ ...saved, username: 'sara' }, saved) }, { username: 'sara' });
  assert.deepEqual({ ...profileChanges({ ...saved, family_name: ' El Mansouri ' }, saved) }, {});
});

test('validation counts Unicode code points and rejects raw controls before trimming', () => {
  assert.deepEqual({ ...validateProfileChanges({ ...saved, username: '😀😀😀' }, saved) }, {});
  assert.match(validateProfileChanges({ ...saved, username: '😀😀' }, saved).username, /3 to 50/);
  assert.deepEqual({ ...validateProfileChanges({ ...saved, first_name: 'é'.repeat(100) }, saved) }, {});
  assert.match(validateProfileChanges({ ...saved, family_name: '😀'.repeat(101) }, saved).family_name, /1 to 100/);
  for (const value of ['Sara\n', 'Sara\u202E', 'Sara\u2066', 'Sara\u2028']) {
    assert.match(validateProfileChanges({ ...saved, username: value }, saved).username, /control/);
  }
  assert.match(validateProfileChanges({ ...saved, first_name: '  ' }, saved).first_name, /1 to 100/);
});

test('sanitized server 422 maps only profile field locations', () => {
  const details = [
    { loc: ['body', 'username'], type: 'value_error', msg: 'Raw technical text' },
    { loc: ['body', 'family_name'], type: 'value_error', msg: 'Other raw text' },
    { loc: ['body', 'email'], type: 'extra_forbidden', msg: 'Ignored' },
  ];
  const errors = profileServerErrors(new ApiError(422, 'Private response', details));
  assert.deepEqual(Object.keys(errors).sort(), ['family_name', 'username']);
  assert.doesNotMatch(Object.values(errors).join(' '), /Raw|Other|Private/);
});
