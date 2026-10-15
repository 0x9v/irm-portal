import { writeFile } from 'node:fs/promises';

export const DEFAULT_PORT = 3170;
export const GROUPS = Object.freeze({
  guest: ['guest-home', 'account-pages', 'support'],
  shell: ['signed-in-home', 'home-composition', 'navigation-shell', 'theme-preference', 'u2-mobile-header-theme', 'actions-underlines'],
  content: ['u4-announcements', 'announcement-replies', 'community-posts', 'delegate-moderation'],
  documents: ['module-document-search', 'document-metadata-navigation', 'u5-document-rows', 'saved-documents', 'recent-documents', 'my-document-submissions', 'document-reader', 'page-layouts'],
  membership: ['membership-application', 'member-directory'],
  discussion: ['discussion', 'discussion-redesign', 'discussion-stickers'],
  account: ['account-foundation', 'profile-editing', 'password-security', 'avatar-management'],
  feedback: ['u6-feedback-states'],
  visual: ['f7-feature-theme-mobile', 'theme-account-surfaces'],
});

export function parseArgs(argv) {
  const modes = new Set(['list', 'static', 'mocked-browser', 'screenshots', 'all']);
  const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';
  if (!modes.has(mode)) throw new Error(`Unknown mode: ${mode}`);
  const options = { mode, groups: Object.keys(GROUPS), url: null, port: DEFAULT_PORT };
  for (let index = mode === argv[0] ? 1 : 0; index < argv.length; index++) {
    const [flag, attached] = argv[index].split('=', 2);
    if (!['--groups', '--url', '--port'].includes(flag)) throw new Error(`Unknown argument: ${argv[index]}`);
    const value = attached ?? argv[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === '--groups') {
      const groups = value.split(',');
      if (groups.some(group => !Object.hasOwn(GROUPS, group)) || new Set(groups).size !== groups.length) {
        throw new Error(`Groups must be distinct names from: ${Object.keys(GROUPS).join(', ')}`);
      }
      options.groups = groups;
    } else if (flag === '--port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535');
      options.port = port;
    } else {
      let parsed;
      try { parsed = new URL(value); } catch { throw new Error('Existing frontend URL must be a valid URL'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
          parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
        throw new Error('Existing frontend URL must be a loopback HTTP(S) origin with no credentials, path, query or fragment');
      }
      options.url = parsed.origin;
    }
  }
  if (options.url && options.port !== DEFAULT_PORT) throw new Error('--port applies only to a runner-owned server');
  return options;
}

export function selectedSpecs(groups) {
  return [...new Set(groups.flatMap(group => GROUPS[group]))];
}

export function discoveryCounts(output) {
  const cases = output.split('\n').filter(line => /\.spec\.ts:\d+:\d+\s+›/.test(line));
  const names = cases.map(line => line.replace(/^.*?([^/ ]+\.spec\.ts):\d+:\d+\s+›\s*/, '$1 › '));
  const normalized = names.map(name => name
    .replace(/\b(?:light|dark)\b/gi, '{theme}')
    .replace(/\b(?:320|390|768|1024|1440)(?:px)?\b/gi, '{width}'));
  return {
    cases: cases.length,
    scenarioFamilies: new Set(normalized).size,
    viewportThemeCases: names.filter(name => /\b(?:light|dark)\b/i.test(name) && /\b(?:320|390|768|1024|1440)(?:px)?\b/i.test(name)).length,
    files: new Set(names.map(name => name.split(' › ')[0])).size,
  };
}

export function finalExitCode(stages, interrupted = false) {
  if (interrupted) return 130;
  const failure = stages.find(stage => stage.exitCode !== null && stage.exitCode !== 0);
  return failure?.exitCode ?? 0;
}

export function browserResultCounts(output) {
  const counts = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const [, count, kind] of output.matchAll(/^\s*(\d+) (passed|failed|skipped|flaky)(?: \(|$)/gm)) {
    counts[kind] = Number(count);
  }
  return counts;
}

export async function waitForHttpReady(url, { fetchFn = fetch, timeoutMs = 60000, intervalMs = 250,
  now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), isRunning = () => true } = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (!isRunning()) throw new Error('Owned frontend server exited before readiness');
    try {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      if (response.status >= 200 && response.status < 400) return response.status;
    } catch { /* Retry only until the bounded deadline. */ }
    await sleep(intervalMs);
  }
  throw new Error('Frontend did not become HTTP-ready before the deadline');
}

export async function stopOwnedProcess(child, { killGroup = (pid, signal) => process.kill(-pid, signal),
  graceMs = 3000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!child) return 'not-started';
  if (child.exitCode !== null || child.signalCode !== null) return 'already-exited';
  if (!child.pid) return 'spawn-failed';
  try { killGroup(child.pid, 'SIGTERM'); } catch (error) {
    if (error?.code !== 'ESRCH') return 'cleanup-failed';
  }
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(graceMs)]);
  if (child.exitCode !== null || child.signalCode !== null) return 'stopped';
  try { killGroup(child.pid, 'SIGKILL'); } catch (error) {
    if (error?.code !== 'ESRCH') return 'cleanup-failed';
  }
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1000)]);
  return child.exitCode !== null || child.signalCode !== null ? 'stopped-after-kill' : 'cleanup-unconfirmed';
}

export function renderSummary(summary) {
  const rows = summary.stages.map(stage =>
    `| ${stage.name} | ${stage.status} | ${stage.exitCode ?? '—'} | ${stage.note ?? '—'} |`).join('\n');
  return `# Frontend release acceptance — ${summary.startedAt}\n\n` +
    `- Git HEAD: \`${summary.gitHead}\`\n` +
    `- Dirty snapshot: ${summary.dirty.modified} modified, ${summary.dirty.untracked} untracked, ${summary.dirty.other} other entries\n` +
    `- Mode: \`${summary.mode}\`; groups: ${summary.groups.join(', ')}\n` +
    `- Build mode: ${summary.buildMode}; frontend URL: ${summary.frontendUrl ?? 'not started'}\n` +
    `- Selected suites: ${summary.specs.length}; discovered Playwright cases: ${summary.discovery?.cases ?? 0}; scenario families after viewport/theme normalization: ${summary.discovery?.scenarioFamilies ?? 0}; viewport/theme cases: ${summary.discovery?.viewportThemeCases ?? 0}\n` +
    `- Browser command: ${summary.browserExecuted ? 'invoked; inspect Playwright report for assertion results' : 'not invoked'}\n` +
    `- Reported browser results: ${summary.browserCounts ? Object.entries(summary.browserCounts).map(([name, count]) => `${count} ${name}`).join(', ') : 'none'}\n` +
    `- Playwright report: ${summary.htmlReport ?? 'not generated'}; artifacts: ${summary.artifacts}\n` +
    `- Captured screenshots: ${summary.screenshots?.length ? summary.screenshots.join(', ') : 'none produced by this run'}\n` +
    `- Owned-process cleanup: ${summary.cleanup}\n` +
    `- Final exit code: ${summary.exitCode}\n\n` +
    `| Stage / command | Status | Exit code | Detail |\n| --- | --- | ---: | --- |\n${rows}\n\n` +
    `Discovery lists tests only; it is not browser execution. This summary contains no credentials, cookies or API bodies.\n`;
}

export async function writeSummary(filename, summary) {
  await writeFile(filename, renderSummary(summary), 'utf8');
}
