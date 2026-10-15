import { test, expect, type Page, type Locator } from '@playwright/test';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type Button from '../src/components/ui/Button';

const usernames = ['amina_irm_mohammedia_2026_student', 'a'.repeat(50)];

async function portal(page: Page, role: 'GUEST' | 'MEMBER' | 'DELEGATE', username = usernames[0]) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ status: role === 'GUEST' ? 401 : 200,
      json: role === 'GUEST' ? { detail: 'Not authenticated' } : {
        id: 'acceptance-user', username, email: 'fixture@example.com', first_name: 'Amina', family_name: 'Student',
      } });
    if (path.endsWith('/membership/me')) return route.fulfill({ json: {
      membership: { id: 'acceptance-member', status: 'ACTIVE', role }, capabilities: {
        create_announcements: role === 'DELEGATE', manage_document_voting: role === 'DELEGATE',
        upload_official_documents: role === 'DELEGATE',
      },
    } });
    if (path.endsWith('/modules')) return route.fulfill({ json: [{ id: 'module-fixture', name: 'Operating Systems', slug: 'os-sys', community_id: 'irm' }] });
    if (path.endsWith('/announcements')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { detail: 'No acceptance fixture' } });
  });
}

async function noOverflow(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth));
}

function contrast(a: string, b: string) {
  const luminance = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    .map((c) => c / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}

async function keyboardFocus(control: Locator) {
  await control.focus();
  await control.page().keyboard.press('Tab');
  await control.page().keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS('outline-style', 'solid');
  await expect(control).toHaveCSS('outline-width', '2px');
}

test.describe('Foundation acceptance', () => {
  for (const width of [320, 390, 768, 1024, 1279, 1280, 1440]) {
    for (const role of ['GUEST', 'MEMBER', 'DELEGATE'] as const) {
      test(`Header ${role} at ${width}px: density, active state, keyboard and dismissal`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 480 });
        await portal(page, role, usernames[1]);
        await page.goto('/communities/irm/modules');
        const header = page.locator('header');
        await expect(header.getByRole('link', { name: 'IRM Hub', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'IRM Modules' })).toBeVisible();
        const mobile = width < 1024;
        const nav = page.getByRole('navigation', { name: mobile ? 'Mobile Navigation' : 'Main Navigation', exact: true });
        if (mobile) {
          const toggle = header.getByRole('button', { name: /^(Open|Close) navigation menu$/ });
          await keyboardFocus(toggle);
          await page.keyboard.press('Enter');
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        } else {
          await expect(header.getByRole('button', { name: 'Open navigation menu' })).toBeHidden();
          await expect(nav).toBeVisible();
        }
        const active = nav.getByRole('link', { name: 'Modules', exact: true });
        await expect(active).toHaveAttribute('aria-current', 'page');
        await expect(active).toHaveCSS('font-size', mobile ? '16px' : '14px');
        await keyboardFocus(active);
        await expect(nav.getByRole('link', { name: 'Home', exact: true })).not.toHaveAttribute('aria-current', 'page');
        if (role !== 'GUEST') {
          const logout = (mobile ? nav : header).getByRole('button', { name: 'Logout', exact: true });
          await expect(logout).toBeEnabled();
          await logout.scrollIntoViewIfNeeded();
          await expect(logout).toBeInViewport();
          await expect((mobile ? nav : header).getByText(usernames[1], { exact: true })).toHaveAttribute('title', usernames[1]);
        } else {
          await expect((mobile ? nav : header).getByRole('link', { name: 'Register', exact: true })).toBeVisible();
        }
        if (!mobile) {
          const brand = (await header.getByRole('link', { name: 'IRM Hub', exact: true }).boundingBox())!;
          const links = await nav.getByRole('link').all();
          const rows = new Set<number>();
          for (const link of links) {
            const box = (await link.boundingBox())!;
            rows.add(Math.round(box.y));
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
          }
          expect(rows.size, 'Navigation must actually fit on one navigation row').toBe(1);
          const navBox = (await nav.boundingBox())!;
          if (width < 1280) expect(navBox.y).toBeGreaterThanOrEqual(brand.y + brand.height);
          else expect(navBox.y).toBeLessThan(brand.y + brand.height);
        }
        if (role === 'DELEGATE') {
          if (mobile) {
            for (const name of ['Review Applications', 'Manage Staff', 'Voting Settings']) {
              await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
            }
          } else {
            const manage = header.getByRole('button', { name: 'Manage', exact: true });
            await keyboardFocus(manage);
            await page.keyboard.press('Enter');
            const menu = page.getByRole('menu', { name: 'Management destinations' });
            await expect(menu.getByRole('menuitem')).toHaveCount(3);
            await page.screenshot({ path: info.outputPath(`manage-${width}.png`), fullPage: true });
            await page.keyboard.press('Escape');
            await expect(manage).toBeFocused();
            await expect(menu).toHaveCount(0);
            await manage.click();
            await page.getByRole('heading', { name: 'IRM Modules' }).click();
            await expect(menu).toHaveCount(0);
            await manage.click();
            await menu.getByRole('menuitem', { name: 'Manage Staff' }).click();
            await expect(page).toHaveURL(/\/membership\/staff$/);
            await expect(menu).toHaveCount(0);
            await manage.click();
            await nav.getByRole('link', { name: 'Support', exact: true }).click();
            await expect(page).toHaveURL(/\/support$/);
            await expect(menu).toHaveCount(0);
          }
        } else if (!mobile) {
          await expect(header.getByRole('button', { name: 'Manage', exact: true })).toHaveCount(0);
        }
        await noOverflow(page);
        await page.screenshot({ path: info.outputPath(`header-${role.toLowerCase()}-${width}.png`), fullPage: true });
        if (mobile) {
          await page.keyboard.press('Escape');
          const toggle = header.getByRole('button', { name: 'Open navigation menu' });
          await expect(toggle).toBeFocused();
          await expect(nav).toHaveCount(0);
          await toggle.click();
          await nav.getByRole('link', { name: 'Support', exact: true }).click();
          await expect(page).toHaveURL(/\/support$/);
          await expect(nav).toHaveCount(0);
        }
      });
    }
  }

  test('Home keeps realistic and unbroken usernames complete, readable, and actions reachable', async ({ page }, info) => {
    for (const username of usernames) {
      await page.unrouteAll();
      await portal(page, 'DELEGATE', username);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 480 });
        await page.goto('/');
        const identity = page.locator('main').getByText(/Signed in as/);
        await expect(identity).toContainText(`(@${username})`);
        await expect(identity).toHaveCSS('font-size', '14px');
        await expect(identity).toHaveCSS('overflow-x', 'visible');
        await noOverflow(page);
        for (const label of ['Browse Modules', 'Membership status']) {
          const action = page.locator('main').getByRole('link', { name: label, exact: true });
          await action.scrollIntoViewIfNeeded();
          await expect(action).toBeInViewport();
          expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: info.outputPath(`home-${username === usernames[0] ? 'realistic' : 'unbroken'}-${width}.png`), fullPage: true });
      }
    }
  });

  test('Empty invalid field placeholders retain compliant contrast and simultaneous error/focus borders', async ({ page }, info) => {
    await portal(page, 'GUEST');
    await page.route('**/api/v1/auth/login', (route) => route.fulfill({ status: 422, json: {
      detail: [{ loc: ['body', 'email'], msg: 'Invalid email', type: 'value_error' }],
    } }));
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const email = page.locator('#email');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    const colours = await email.evaluate((element) => ({
      placeholder: getComputedStyle(element, '::placeholder').color,
      background: getComputedStyle(element).backgroundColor,
    }));
    await email.focus();
    await expect(email).toHaveCSS('border-top-color', 'rgb(185, 28, 28)');
    await expect(email).toHaveCSS('outline-color', 'rgb(37, 99, 235)');
    await expect(email).toHaveCSS('outline-width', '2px');
    await page.screenshot({ path: info.outputPath('invalid-empty-field-focus.png'), fullPage: true });
    expect(contrast(colours.placeholder, colours.background)).toBeGreaterThanOrEqual(4.5);
  });

  test('Focus is visible on white, warm page, blue and feedback surfaces without changing field errors', async ({ page }, info) => {
    await portal(page, 'GUEST');
    await page.goto('/login');
    // Presentation specimens only, in the browser DOM; no application route or state changes.
    await page.locator('main').evaluate((main) => {
      const surfaces = ['var(--surface)', 'var(--page)', 'var(--accent)', 'var(--error-surface)'];
      for (const [index, background] of surfaces.entries()) {
        const panel = document.createElement('div');
        panel.style.cssText = `background:${background};padding:16px;margin-top:8px`;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ui-button ui-button--secondary';
        button.id = `focus-surface-${index}`; button.textContent = 'Keyboard action';
        panel.append(button); main.append(panel);
      }
    });
    for (let index = 0; index < 4; index++) {
      const control = page.locator(`#focus-surface-${index}`);
      await keyboardFocus(control);
      const colours = await control.evaluate((element) => ({
        ring: getComputedStyle(element).outlineColor,
        halo: getComputedStyle(element).boxShadow,
        background: getComputedStyle(element.parentElement!).backgroundColor,
      }));
      const haloColour = colours.halo.match(/rgba?\([^)]+\)/)?.[0];
      const ringContrast = contrast(colours.ring, colours.background);
      const haloContrast = haloColour ? contrast(haloColour, colours.background) : 0;
      await page.screenshot({ path: info.outputPath(`focus-surface-${index}.png`), fullPage: true });
      expect(Math.max(ringContrast, haloContrast)).toBeGreaterThanOrEqual(3);
    }
    await keyboardFocus(page.locator('main').getByRole('link', { name: /Back to Home/ }));
  });

  for (const form of ['login', 'register']) {
    test(`${form}: network failures preserve drafts and native field associations`, async ({ page }, info) => {
      await page.setViewportSize({ width: 320, height: 480 });
      await portal(page, 'GUEST');
      await page.route(`**/api/v1/auth/${form}`, (route) => route.abort('failed'));
      await page.goto(`/${form}`);
      const fields = page.locator('main input.ui-field');
      for (const input of await fields.all()) {
        const id = (await input.getAttribute('id'))!;
        await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
        await expect(input).toHaveCSS('font-size', '16px');
        await input.fill(id === 'email' ? 'student@example.com' : 'student-fixture');
      }
      await page.getByRole('button', { name: form === 'login' ? 'Sign in' : 'Create account', exact: true }).click();
      await expect(page.locator('main').getByRole('alert')).toBeVisible();
      for (const input of await fields.all()) {
        const id = await input.getAttribute('id');
        await expect(input).toBeEnabled();
        await expect(input).toHaveValue(id === 'email' ? 'student@example.com' : 'student-fixture');
        await expect(input).toHaveAttribute('aria-invalid', 'false');
        await expect(input).not.toHaveAttribute('aria-describedby', /.+/);
      }
      expect(await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
        return ids.length === new Set(ids).size;
      })).toBe(true);
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath(`${form}-network-failure-320.png`), fullPage: true });
    });
  }

  test('Button forwards native type, ref, attributes, disabled state and handler without adding state', () => {
    // Compile with React's JSX runtime, not Playwright's serializable JSX transform.
    const filename = path.resolve(__dirname, '../src/components/ui/Button.tsx');
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    } }).outputText;
    const moduleExports = {} as { default: typeof Button };
    runInNewContext(compiled, { exports: moduleExports, require: createRequire(filename) });
    const NativeButton = moduleExports.default;
    const ref = createRef<HTMLButtonElement>();
    const onClick = () => {};
    const element = NativeButton({ ref, type: 'button', disabled: true, onClick, name: 'retry',
      'aria-label': 'Retry safely', children: 'Retry', variant: 'secondary' });
    expect(element.type).toBe('button');
    expect(element.props).toMatchObject({ ref, type: 'button', disabled: true, onClick, name: 'retry', 'aria-label': 'Retry safely' });
    expect(renderToStaticMarkup(element)).toContain('disabled=""');
    expect(NativeButton({ type: 'submit', children: 'Submit' }).props.type).toBe('submit');
  });

  test('Support private helper preserves number validation and encoded URL construction', () => {
    // Exercise the actual private function without adding an application export.
    const filename = path.resolve(__dirname, '../src/app/support/page.tsx');
    const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const helper = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'getWhatsAppSupportUrl');
    expect(helper).toBeDefined();
    const compiled = ts.transpileModule(`${helper!.getText(source)}\nexports.helper = getWhatsAppSupportUrl;`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const moduleExports = {} as { helper: (number: string | undefined) => string | null };
    runInNewContext(compiled, { exports: moduleExports });
    for (const number of [undefined, '', '+212600000000', 'abc', '123456', '1'.repeat(16)]) {
      expect(moduleExports.helper(number)).toBeNull();
    }
    for (const number of ['1234567', ' 212600000000 ', '1'.repeat(15)]) {
      expect(moduleExports.helper(number)).toBe(`https://wa.me/${number.trim()}?text=${encodeURIComponent("Hi! I'd like to support EtudSup. How can I contribute?")}`);
    }
  });
});
