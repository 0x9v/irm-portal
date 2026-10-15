import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, selectedSpecs, discoveryCounts, browserResultCounts, finalExitCode,
  waitForHttpReady, stopOwnedProcess, writeSummary } from '../scripts/release-acceptance-core.mjs';

test('mode and focused suite parsing reject unsafe or ambiguous inputs', () => {
  assert.equal(parseArgs([]).mode, 'list');
  assert.deepEqual(parseArgs(['mocked-browser', '--groups=account,documents']).groups, ['account', 'documents']);
  assert.equal(parseArgs(['all', '--url', 'http://127.0.0.1:3200']).url, 'http://127.0.0.1:3200');
  assert.throws(() => parseArgs(['all', '--groups=unknown']), /Groups/);
  assert.throws(() => parseArgs(['all', '--groups=account,account']), /distinct/);
  assert.throws(() => parseArgs(['all', '--url=https://example.com']), /loopback/);
  assert.throws(() => parseArgs(['all', '--url=http://user:secret@127.0.0.1:3000']), /loopback/);
  assert.throws(() => parseArgs(['all', '--port=80']), /Port/);
});

test('suite selection deduplicates and discovery separates viewport/theme variants', () => {
  const specs = selectedSpecs(['guest', 'account']);
  assert.equal(new Set(specs).size, specs.length);
  assert.ok(specs.includes('guest-home'));
  assert.ok(specs.includes('avatar-management'));
  const counts = discoveryCounts('  [chromium] › account-foundation.spec.ts:10:1 › light 390px account capture\n' +
    '  [chromium] › account-foundation.spec.ts:10:1 › dark 390px account capture\n' +
    '  [chromium] › avatar-management.spec.ts:20:1 › removal\nTotal: 3 tests in 2 files\n');
  assert.deepEqual(counts, { cases: 3, scenarioFamilies: 2, viewportThemeCases: 2, files: 2 });
});

test('nonzero stages retain their exit code and interruption is nonzero', () => {
  assert.equal(finalExitCode([{ exitCode: 0 }, { exitCode: 17 }, { exitCode: 0 }]), 17);
  assert.equal(finalExitCode([{ exitCode: 0 }]), 0);
  assert.equal(finalExitCode([{ exitCode: 0 }], true), 130);
});

test('browser totals are read from actual execution output, not discovery', () => {
  assert.deepEqual(browserResultCounts('Running 5 tests\n  1 failed\n  4 passed (8.1s)\n'),
    { passed: 4, failed: 1, skipped: 0, flaky: 0 });
  assert.deepEqual(browserResultCounts('Listing tests:\nTotal: 5 tests in 2 files'),
    { passed: 0, failed: 0, skipped: 0, flaky: 0 });
});

test('summary generation records evidence without raw request data', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'irm-release-summary-test-'));
  try {
    const filename = path.join(folder, 'summary.md');
    await writeSummary(filename, { startedAt: '2026-10-13T00:00:00Z', gitHead: 'abc123',
      dirty: { modified: 1, untracked: 2, other: 0 }, mode: 'static', groups: ['account'],
      buildMode: 'not run', frontendUrl: null, specs: ['account-foundation'], discovery: { cases: 8, scenarioFamilies: 5, viewportThemeCases: 4 },
      browserExecuted: false, htmlReport: null, artifacts: 'test-results/artifacts', cleanup: 'not-started', exitCode: 17,
      stages: [{ name: 'lint', status: 'failed', exitCode: 17, note: 'source check failed', output: 'supersecret-private-value' }] });
    const report = await readFile(filename, 'utf8');
    assert.match(report, /Final exit code: 17/);
    assert.match(report, /8; scenario families/);
    assert.doesNotMatch(report, /supersecret-private-value/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('HTTP readiness fails after its bounded deadline', async () => {
  let tick = 0;
  await assert.rejects(waitForHttpReady('http://127.0.0.1:3170', {
    fetchFn: async () => { throw new Error('offline'); }, now: () => ++tick * 10,
    timeoutMs: 25, intervalMs: 0, sleep: async () => {},
  }), /HTTP-ready/);
  let tick404 = 0;
  await assert.rejects(waitForHttpReady('http://127.0.0.1:3170', {
    fetchFn: async () => ({ status: 404 }), now: () => ++tick404 * 10,
    timeoutMs: 25, intervalMs: 0, sleep: async () => {},
  }), /HTTP-ready/);
});

test('cleanup signals only the tracked owned process group', async () => {
  const child = new EventEmitter();
  child.pid = 4242; child.exitCode = null; child.signalCode = null;
  const calls = [];
  const outcome = await stopOwnedProcess(child, { killGroup: (pid, signal) => {
    calls.push([pid, signal]); child.signalCode = signal; child.emit('exit', null, signal);
  }, sleep: async () => {} });
  assert.equal(outcome, 'stopped');
  assert.deepEqual(calls, [[4242, 'SIGTERM']]);
  const failedSpawn = new EventEmitter();
  failedSpawn.pid = undefined; failedSpawn.exitCode = null; failedSpawn.signalCode = null;
  assert.equal(await stopOwnedProcess(failedSpawn), 'spawn-failed');
});
