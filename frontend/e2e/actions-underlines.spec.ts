import { test, expect, type Page, type Locator } from './moderation-fixtures';

const moduleFixture = { id: 'mod-u1', community_id: 'irm', name: 'Algorithms and a deliberately long module label', slug: 'algorithms', created_at: '2026-01-01', updated_at: '2026-01-01' };
const notice = { id: 'notice-u1', title: 'Community study notice', content: 'A representative announcement description.', created_at: '2026-10-01', author_username: 'delegate' };
async function mock(page: Page, persona = 'member') {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/auth/me')) return persona === 'guest' ? json({ detail: 'Not authenticated' }, 401) : json({ id: 'u1', username: 'long_actual_account_name_for_responsive_checks' });
    if (path.endsWith('/membership/me')) return json({ membership: { id: 'membership-u1', status: persona === 'pending' ? 'PENDING' : 'ACTIVE', role: persona === 'delegate' ? 'DELEGATE' : 'MEMBER' }, capabilities: {} });
    if (path.endsWith('/application-options')) return json({ promotion_options: ['2025-2026'], custom_promotion_formats: ['YYYY-YYYY'] });
    if (path.endsWith('/modules')) return json([moduleFixture]);
    if (path.endsWith('/modules/algorithms')) return json(moduleFixture);
    if (path.endsWith('/modules/algorithms/documents')) return json([]);
    if (path.endsWith('/announcements')) return json([notice]);
    if (path.endsWith('/documents/recent')) return json({ items: [{ id: 'doc-u1', module_id: moduleFixture.id, module_slug: moduleFixture.slug, module_name: moduleFixture.name, title: 'Study notes', type: 'COURSE', source: 'STUDENT', last_page: 1, last_opened_at: '2026-10-01' }], next_cursor: null });
    return json({ detail: 'No frontend fixture' }, 404);
  });
}

async function decorationEvidence(locator: Locator) {
  return locator.evaluate(element => {
    const chain = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const rules: { source: string; selector: string; declaration: string }[] = [];
      const visit = (list: CSSRuleList, source: string) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSStyleRule) {
            try {
              if (node!.matches(rule.selectorText) && (rule.style.textDecoration || rule.style.textDecorationLine)) rules.push({ source, selector: rule.selectorText, declaration: rule.style.textDecoration || rule.style.textDecorationLine });
            } catch { /* Selectors unsupported by matches are recorded by computed style. */ }
          } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules, source);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try { visit(sheet.cssRules, sheet.href || 'inline stylesheet'); } catch { /* Cross-origin rules may be inaccessible. */ }
      }
      chain.push({ tag: node.tagName, className: node.className, line: getComputedStyle(node).textDecorationLine, rules });
    }
    return chain;
  });
}

async function contrast(locator: Locator) {
  const value = await locator.evaluate(element => {
    const luminance = (color: string) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(v => v / 255)
      .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    let surface: Element | null = element;
    while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
    if (!surface) throw new Error('No adjacent backing surface');
    const a = luminance(getComputedStyle(element).color), b = luminance(getComputedStyle(surface).backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  expect(value).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['light', 'dark']) for (const width of [320, 390, 768, 1024, 1440]) {
  test(`${theme} ${width}: actual actions, cards, ancestor decoration, focus and captures`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
    await page.setViewportSize({ width, height: 900 });
    await mock(page);
    for (const [name, path] of [['home', '/'], ['modules', '/communities/irm/modules/algorithms'], ['announcements', '/communities/irm/announcements'], ['membership', '/account#community-membership'], ['support', '/support']] as const) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('main h1')).toBeVisible();
      if (name === 'home') {
        await expect(page.getByRole('link', { name: 'All modules' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'All announcements' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Module: ' + moduleFixture.name })).toBeVisible();
      }
      if (name === 'modules') await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const findings = [];
      for (const item of await page.locator('.ui-button, .ui-nav-link, .ui-card-link').all()) {
        if (!await item.isVisible()) continue;
        expect(await item.evaluate(el => ['A', 'BUTTON', 'SPAN', 'SUMMARY'].includes(el.tagName))).toBe(true);
        const states = [];
        for (const state of ['normal', 'hover', 'focus', 'active'] as const) {
          if (state === 'hover') await item.hover();
          if (state === 'focus' && await item.evaluate(el => el.matches('a,button:not(:disabled),summary'))) {
            await page.keyboard.press('Tab'); await item.focus();
            await expect(item).toHaveCSS('outline-style', 'solid');
          }
          if (state === 'active') {
            await item.hover(); await page.mouse.down();
          }
          const chain = await decorationEvidence(item);
          if (state === 'active') { await page.mouse.move(0, 0); await page.mouse.up(); }
          for (const ancestor of chain) expect(ancestor.line, `${name} ${state}: ${ancestor.tag}.${ancestor.className}`).not.toContain('underline');
          // Check card titles/descriptions as well as the anchor boundary.
          for (const child of await item.locator('h2,h3,p,small').all()) await expect(child).toHaveCSS('text-decoration-line', 'none');
          states.push({ state, chain });
        }
        if (await item.evaluate(el => el.matches('a,button,summary'))) {
          const bounds = (await item.boundingBox())!;
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          if (await item.evaluate(el => el.matches('.ui-button:not(:disabled)'))) await contrast(item);
        }
        findings.push({ text: await item.innerText(), states });
      }
      await info.attach(`${name}-${theme}-${width}-decoration.json`, { body: JSON.stringify(findings, null, 2), contentType: 'application/json' });
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`${name}-${theme}-${width}.png`), fullPage: true });
      await expect(page.locator('[data-site-footer]')).toHaveCount(1);
    }
  });
}

test('Prose module link stays underlined while its neighboring navigation button does not', async ({ page }) => {
  await mock(page); await page.goto('/communities/irm/documents/recent');
  const prose = page.locator('main p').getByRole('link', { name: moduleFixture.name });
  await expect(prose).toHaveCSS('text-decoration-line', 'underline');
  await expect(page.getByRole('link', { name: 'Continue reading' })).toHaveCSS('text-decoration-line', 'none');
});

for (const theme of ['light', 'dark']) test(`${theme}: existing account submission stays disabled/busy, named and stable`, async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('irm-theme', value), theme);
  await mock(page, 'guest');
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let submissions = 0;
  await page.route('**/api/v1/auth/login', async route => { submissions++; await waiting; await route.fulfill({ status: 401, json: { detail: 'Invalid credentials' } }); });
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('fixture@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  const action = page.getByRole('button', { name: 'Sign in', exact: true });
  const before = (await action.boundingBox())!;
  await action.click();
  const pending = page.getByRole('button', { name: 'Signing in...' });
  await expect(pending).toBeDisabled(); await expect(pending).toHaveAttribute('aria-busy', 'true');
  expect((await pending.boundingBox())!.width).toBe(before.width);
  expect((await pending.boundingBox())!.height).toBe(before.height);
  expect(submissions).toBe(1); release();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
});

test('Existing destructive confirmation remains keyboard contained and sends nothing on cancel', async ({ page }) => {
  await mock(page, 'delegate');
  await page.route('**/api/v1/communities/irm/memberships?**', route => route.fulfill({ json: { items: [{ id: 'target-u1', username: 'target_student', role: 'MEMBER', status: 'ACTIVE', created_at: '2026-01-01', updated_at: '2026-01-01' }], next_cursor: null } }));
  const mutations: string[] = [];
  page.on('request', request => { if (['PUT', 'DELETE'].includes(request.method())) mutations.push(request.url()); });
  await page.goto('/communities/irm/membership/members');
  await page.getByRole('region', { name: 'Membership directory' }).locator('li summary').click();
  await page.getByRole('button', { name: 'Ban member', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  const action = dialog.getByRole('button', { name: 'Ban member', exact: true });
  await contrast(action);
  await page.keyboard.press('Shift+Tab'); await expect(action).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ban member', exact: true })).toBeFocused();
  expect(mutations).toEqual([]);
});

test('Previously visited navigation remains undecorated after actual route navigation', async ({ page }, info) => {
  await mock(page); await page.goto('/');
  await page.getByRole('link', { name: 'All modules' }).click();
  await expect(page).toHaveURL(/\/communities\/irm\/modules$/);
  await page.goBack();
  const item = page.getByRole('link', { name: 'All modules' });
  const chain = await decorationEvidence(item);
  for (const ancestor of chain) expect(ancestor.line).not.toContain('underline');
  await info.attach('visited-navigation-decoration.json', { body: JSON.stringify(chain, null, 2), contentType: 'application/json' });
});
