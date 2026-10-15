#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, selectedSpecs, discoveryCounts, browserResultCounts,
  finalExitCode, waitForHttpReady, stopOwnedProcess, writeSummary } from './release-acceptance-core.mjs';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(frontend, '..');
const playwrightCli = path.join(frontend, 'node_modules/@playwright/test/cli.js');
const fixture = path.join(frontend, 'e2e/moderation-fixtures.ts');
const timeout = { discovery: 90_000, lint: 180_000, typescript: 180_000, node: 180_000,
  build: 600_000, browser: 1_800_000 };
const visualPattern = 'capture|screenshot|theme at|conversation geometry|short-message reactions|document loading|announcement network uncertainty';

async function captureLocal(executable, args, limit = 10_000) {
  const child = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  const timer = setTimeout(() => child.kill('SIGTERM'), limit);
  const code = await new Promise(resolve => {
    child.once('error', () => resolve(1));
    child.once('close', value => resolve(value ?? 1));
  });
  clearTimeout(timer);
  if (code !== 0) throw new Error('Git metadata command failed');
  return output;
}

async function gitSnapshot() {
  let gitHead = 'unavailable';
  const dirty = { modified: 0, untracked: 0, other: 0 };
  try {
    gitHead = (await captureLocal('git', ['rev-parse', 'HEAD'], 5000)).trim();
    const porcelain = await captureLocal('git', ['status', '--porcelain', '-z', '--untracked-files=all']);
    for (const entry of porcelain.split('\0').filter(Boolean)) {
      if (entry.startsWith('??')) dirty.untracked++;
      else if (entry.slice(0, 2).includes('M')) dirty.modified++;
      else dirty.other++;
    }
  } catch { /* The summary still records that Git metadata was unavailable. */ }
  return { gitHead, dirty };
}

async function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function isolatedSpecs(specs) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irm-release-specs-'));
  try {
    for (const spec of specs) {
      const original = await readFile(path.join(frontend, 'e2e', `${spec}.spec.ts`), 'utf8');
      if (/https?:\/\/(?:localhost|127\.0\.0\.1):8000|(?:page|context)\.request\.|\brequest\.(?:get|post|put|delete)\(/.test(original)) {
        throw new Error(`Selected spec ${spec} contains a direct backend request; keep it outside mocked acceptance.`);
      }
      const isolated = original
        .replace(/from ['"](?:@playwright\/test|\.\/moderation-fixtures)['"]/, `from ${JSON.stringify(fixture)}`)
        .replaceAll('route.continue()', 'route.fallback()');
      if (isolated === original) throw new Error(`No supported Playwright fixture import in ${spec}`);
      await writeFile(path.join(directory, `${spec}.spec.ts`), isolated);
    }
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function freshScreenshots(directories, since) {
  const found = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && entry.name.endsWith('.png') && (await stat(filename)).mtimeMs >= since) found.push(filename);
    }
  }
  for (const directory of directories) await visit(directory);
  return found.sort();
}

let activeStage = null;
let interrupted = false;
function interrupt() {
  interrupted = true;
  if (activeStage?.pid) { try { process.kill(-activeStage.pid, 'SIGTERM'); } catch { /* Already exited. */ } }
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

async function command(name, executable, args, { env = process.env, limit = 120_000, capture = false } = {}) {
  const started = Date.now();
  process.stdout.write(`Running ${name}...\n`);
  const logDirectory = await mkdtemp(path.join(os.tmpdir(), 'irm-release-stage-'));
  const logFile = path.join(logDirectory, 'output.log');
  const logHandle = await open(logFile, 'w');
  let timedOut = false;
  const child = spawn(executable, args, { cwd: frontend, env, detached: true, stdio: ['ignore', logHandle.fd, logHandle.fd] });
  activeStage = child;
  let killTimer = null;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }, 3000);
    }
  }, limit);
  const exitCode = await new Promise(resolve => {
    child.once('error', () => resolve(1));
    child.once('close', (code, signal) => resolve(timedOut ? 124 : signal ? 130 : code ?? 1));
  });
  clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  if (activeStage === child) activeStage = null;
  await logHandle.close();
  const output = await readFile(logFile, 'utf8');
  await rm(logDirectory, { recursive: true, force: true });
  if (!capture) process.stdout.write(output);
  const blocked = /Operation not permitted|sandbox_host_linux|webServer was not able to start/i.test(output);
  return { name, status: exitCode === 0 ? 'passed' : blocked || timedOut ? 'blocked' : 'failed',
    exitCode, note: timedOut ? 'bounded stage timed out' : blocked ? 'environment process/browser restriction' : null,
    command: `${path.basename(executable)} ${args.map(arg => path.basename(arg) === arg ? arg : path.basename(arg)).join(' ')}`,
    durationMs: Date.now() - started, output };
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\nUsage: npm run release:acceptance -- <list|static|mocked-browser|screenshots|all> [--groups guest,shell,...] [--url http://127.0.0.1:PORT] [--port 3170]\n`);
    process.exitCode = 2;
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.join(frontend, 'test-results/release-acceptance', stamp);
  await mkdir(output, { recursive: true });
  const specs = selectedSpecs(options.groups);
  const { gitHead, dirty } = await gitSnapshot();
  const frontendUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  const summary = { startedAt: new Date().toISOString(), mode: options.mode, groups: options.groups,
    specs, gitHead, dirty, buildMode: options.url ? 'existing server; build not verified' : 'not run',
    frontendUrl, discovery: null, browserExecuted: false, browserCounts: null,
    htmlReport: null, artifacts: path.join(output, 'artifacts'), screenshots: [], cleanup: 'not-started', stages: [], exitCode: 0 };
  let selected = null;
  let server = null;
  const record = stage => {
    summary.stages.push({ name: stage.command ? `${stage.name}: \`${stage.command}\`` : stage.name,
      status: stage.status, exitCode: stage.exitCode, note: stage.note });
    if (stage.status !== 'passed') process.stderr.write(`${stage.name}: ${stage.status} (exit ${stage.exitCode})\n`);
  };
  try {
    selected = await isolatedSpecs(specs);
    const playwrightEnv = { ...process.env, IRM_RELEASE_SPEC_DIR: selected,
      IRM_RELEASE_URL: frontendUrl, IRM_RELEASE_OUTPUT: output };
    process.stdout.write(`Selected groups: ${options.groups.join(', ')}\nSelected suites (${specs.length}): ${specs.join(', ')}\n`);
    const discoverArgs = [playwrightCli, 'test', '--config=playwright.release.config.ts', '--list'];
    if (options.mode === 'screenshots') discoverArgs.push('--grep', visualPattern);
    const discovery = await command('Playwright discovery', process.execPath, discoverArgs,
      { env: playwrightEnv, limit: timeout.discovery, capture: true });
    record(discovery);
    if (discovery.exitCode === 0) {
      summary.discovery = discoveryCounts(discovery.output);
      process.stdout.write(`Discovered ${summary.discovery.cases} cases in ${summary.discovery.files} files (${summary.discovery.scenarioFamilies} scenario families).\n`);
    }
    if (discovery.exitCode !== 0 || options.mode === 'list') return;

    if (options.mode === 'static' || options.mode === 'all') {
      const staticCommands = [
        ['lint', 'npm', ['run', 'lint'], timeout.lint],
        ['TypeScript', path.join(frontend, 'node_modules/.bin/tsc'), ['--noEmit'], timeout.typescript],
        ['Node tests', process.execPath, ['--test', ...(await readdir(path.join(frontend, 'tests')))
          .filter(filename => filename.endsWith('.test.mjs')).sort().map(filename => `tests/${filename}`)], timeout.node],
      ];
      for (const [name, executable, args, limit] of staticCommands) {
        if (interrupted) break;
        record(await command(name, executable, args, { limit }));
      }
      if (options.mode === 'static' || interrupted || summary.stages.some(stage => stage.status === 'failed' || stage.status === 'blocked')) return;
    }

    if (!options.url) {
      summary.buildMode = 'normal production build';
      const build = await command('normal production build', 'npm', ['run', 'build'],
        { env: { ...process.env, NEXT_PUBLIC_API_URL: frontendUrl }, limit: timeout.build });
      record(build);
      if (build.exitCode !== 0 || interrupted) return;
      let available;
      try { available = await portAvailable(options.port); } catch (error) {
        record({ name: 'port ownership', status: 'blocked', exitCode: 1, note: error.code === 'EPERM' ? 'port binding denied' : 'port availability check failed' });
        return;
      }
      if (!available) {
        record({ name: 'port ownership', status: 'failed', exitCode: 2, note: `port ${options.port} is occupied; no service was stopped` });
        return;
      }
      server = spawn(process.execPath, [path.join(frontend, 'node_modules/next/dist/bin/next'), 'start',
        '--hostname', '127.0.0.1', '--port', String(options.port)],
      { cwd: frontend, env: { ...process.env, NEXT_PUBLIC_API_URL: frontendUrl }, detached: true, stdio: 'ignore' });
      let serverSpawnError = false;
      server.once('error', () => { serverSpawnError = true; });
      summary.frontendUrl = frontendUrl;
      try {
        await waitForHttpReady(frontendUrl, { timeoutMs: 60_000, isRunning: () => !interrupted && !serverSpawnError && server.exitCode === null });
        record({ name: 'HTTP readiness', status: 'passed', exitCode: 0, note: 'runner-owned frontend server responded' });
      } catch (error) {
        record({ name: 'HTTP readiness', status: 'blocked', exitCode: 1, note: error.message });
        return;
      }
    } else {
      try {
        await waitForHttpReady(frontendUrl, { timeoutMs: 10_000, isRunning: () => !interrupted });
        record({ name: 'existing server readiness', status: 'passed', exitCode: 0, note: 'build not verified by this run' });
      } catch (error) {
        record({ name: 'existing server readiness', status: 'blocked', exitCode: 1, note: error.message });
        return;
      }
    }

    if (interrupted) return;
    const browserArgs = [playwrightCli, 'test', '--config=playwright.release.config.ts'];
    if (options.mode === 'screenshots') browserArgs.push('--grep', visualPattern);
    const browser = await command('mocked-browser', process.execPath, browserArgs,
      { env: playwrightEnv, limit: timeout.browser });
    record(browser);
    summary.browserExecuted = true;
    summary.browserCounts = browserResultCounts(browser.output);
    summary.htmlReport = path.join(output, 'playwright-report/index.html');
    summary.screenshots = await freshScreenshots([summary.artifacts,
      ...['d1', 'd1-1', 'u5/captures', 'u6/captures'].map(folder => path.join(frontend, 'test-results', folder))],
    Date.parse(summary.startedAt));
  } catch (error) {
    record({ name: 'runner preparation', status: 'failed', exitCode: 1, note: error.message });
  } finally {
    summary.cleanup = await stopOwnedProcess(server);
    if (selected) await rm(selected, { recursive: true, force: true });
    for (const name of ['Playwright discovery', 'lint', 'TypeScript', 'Node tests', 'normal production build', 'HTTP readiness', 'mocked-browser']) {
      if (!summary.stages.some(stage => stage.name === name || stage.name.startsWith(`${name}:`))) {
        summary.stages.push({ name, status: 'not-executed', exitCode: null, note: 'not reached in this mode/run' });
      }
    }
    summary.exitCode = finalExitCode(summary.stages, interrupted);
    const report = path.join(output, 'summary.md');
    await writeSummary(report, summary);
    process.stdout.write(`Acceptance summary: ${report}\n`);
    process.exitCode = summary.exitCode;
  }
}

await main();
