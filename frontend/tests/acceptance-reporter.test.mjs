import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
test('acceptance JSON redacts credential-bearing errors before writing evidence', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'irm-reporter-test-'));
  try {
    const manifest = path.join(directory, 'actors.json'), outputFile = path.join(directory, 'report.json');
    writeFileSync(manifest, JSON.stringify({ actors: { member: { password: 'synthetic-secret' } } }), { mode: 0o600 });
    const source = readFileSync(new URL('../e2e/acceptance-reporter.ts', import.meta.url), 'utf8');
    const compiled = require('typescript').transpileModule(source, { compilerOptions: { module: require('typescript').ModuleKind.CommonJS } }).outputText;
    const compiledModule = { exports: {} };
    vm.runInNewContext(compiled, { exports: compiledModule.exports, require, process: { env: {} } });
    const reporter = new compiledModule.exports.default({ outputFile, manifestPath: manifest });
    const error = { message: 'fill synthetic-secret\npostgresql+psycopg://role:secret@host/db\nCookie: session=private-token\nHTTP 403' };
    reporter.onError(error);
    reporter.onTestEnd({ titlePath: () => ['synthetic lifecycle'] }, { status: 'failed', duration: 5, errors: [error], attachments: [] });
    reporter.onEnd({ status: 'failed', duration: 5 });
    const result = readFileSync(outputFile, 'utf8');
    for (const value of ['synthetic-secret', 'secret@host', 'private-token']) assert.ok(!result.includes(value));
    assert.equal(JSON.parse(result).tests[0].status, 'failed');
    assert.ok(result.includes('HTTP 403'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
