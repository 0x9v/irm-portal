import { test as base } from '@playwright/test';
export * from '@playwright/test';

// Auto fixture for copied existing specs. Context-level deny routes precede
// each suite's mocks, cover extra tabs, and keep hooks isolated per spec file.
export const test = base.extend<{ blockedBackend: void }>({
  blockedBackend: [async ({ context }, use) => {
    await context.route('**/api/**', route => route.abort());
    await context.routeWebSocket(/.*/, socket => { socket.onMessage(() => {}); });
    await use();
  }, { auto: true }],
});
