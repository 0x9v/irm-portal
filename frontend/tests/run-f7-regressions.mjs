import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = await mkdtemp(path.join(os.tmpdir(), 'irm-f7-regressions-'));
const fixture = path.join(frontend, 'e2e/moderation-fixtures.ts');
const specs = ['f7-feature-theme-mobile', 'theme-preference', 'theme-account-surfaces', 'navigation-shell',
  'signed-in-home', 'announcements', 'announcement-replies', 'module-document-search',
  'document-metadata-navigation', 'document-reader'];
for (const spec of specs) {
  const original = await readFile(path.join(frontend, `e2e/${spec}.spec.ts`), 'utf8');
  const isolated = original.replace(/from ['"](?:@playwright\/test|\.\/moderation-fixtures)['"]/, `from ${JSON.stringify(fixture)}`);
  if (original === isolated) throw new Error(`Playwright fixture import missing in ${spec}`);
  await writeFile(path.join(destination, `${spec}.spec.ts`), isolated);
}
const child = spawn(process.execPath, [path.join(frontend, 'node_modules/@playwright/test/cli.js'),
  'test', '--config=playwright.f7.config.ts', ...process.argv.slice(2)], {
  cwd: frontend, stdio: 'inherit', env: { ...process.env, IRM_F7_REGRESSION_DIR: destination },
});
const code = await new Promise(resolve => child.once('exit', resolve));
await rm(destination, { recursive: true, force: true });
process.exitCode = code ?? 1;
