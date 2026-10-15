import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = await mkdtemp(path.join(os.tmpdir(), 'irm-moderation-regressions-'));
const fixtures = path.join(frontend, 'e2e/moderation-fixtures.ts');
const specs = ['community-posts', 'announcement-replies', 'announcements', 'discussion',
  'header', 'page-layouts', 'manual-testing-logout', 'theme-preference', 'mobile-home'];
for (const spec of specs) {
  const text = await readFile(path.join(frontend, `e2e/${spec}.spec.ts`), 'utf8');
  const isolated = text.replaceAll('http://127.0.0.1:3128', process.env.IRM_ACCEPTANCE_FRONTEND || 'http://127.0.0.1:3128').replace(/from ['"]@playwright\/test['"]/, `from ${JSON.stringify(fixtures)}`);
  if (isolated === text) throw new Error(`No Playwright import found in ${spec}`);
  await writeFile(path.join(destination, `${spec}.spec.ts`), isolated);
}
console.log(`Isolated regression copies: ${destination}`);
const child = spawn(process.execPath, [path.join(frontend, 'node_modules/@playwright/test/cli.js'),
  'test', '--config=playwright.moderation-regressions.config.ts', ...process.argv.slice(2)], {
  cwd: frontend, stdio: 'inherit', env: { ...process.env, IRM_MODERATION_REGRESSION_DIR: destination },
});
child.on('error', async () => { await rm(destination, { recursive: true, force: true }); process.exitCode = 1; });
child.on('exit', async (code, signal) => { await rm(destination, { recursive: true, force: true }); process.exitCode = signal ? 1 : code ?? 1; });
