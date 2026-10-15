import { test, expect, type Page } from '@playwright/test';

const user = { id: '1', username: 'student', email: 'student@example.test', first_name: 'Test', family_name: 'Student' };

async function guest(page: Page) {
  await page.route('**/api/v1/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/auth/me')) return route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    return route.fulfill({ status: 500, json: { detail: 'Unexpected request' } });
  });
}

test('direct guest visits show focused forms, routes, theme, and one main', async ({ page }) => {
  await guest(page);
  for (const path of ['/login', '/register']) {
    await page.goto(path);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('[data-public-account-frame]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'EtudSup home' }).first()).toHaveAttribute('href', '/');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Support', exact: true })).toHaveAttribute('href', '/support');
  }
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('login preserves payload, pending guard, invalid credential feedback, and post-login route', async ({ page }) => {
  await guest(page);
  let submissions = 0;
  let release!: () => void;
  await page.route('**/api/v1/auth/login', async route => {
    submissions++;
    expect(route.request().postDataJSON()).toEqual({ email: 'student@example.test', password: 'secret123' });
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 401, json: { detail: 'Invalid credentials' } });
  });
  await page.goto('/login');
  await expect(page.getByLabel('Email Address')).toHaveAttribute('placeholder', 'e.g. sara@gmail.com');
  await expect(page.getByLabel('Email Address')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#login-email-hint')).toHaveText('Any email provider works; use the address on your account.');
  await page.getByLabel('Email Address').fill('student@example.test');
  await page.getByLabel('Password').fill('secret123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Signing in...' })).toBeDisabled();
  expect(submissions).toBe(1);
  release();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await expect(page.getByLabel('Email Address')).toHaveValue('student@example.test');
  await expect(page.getByLabel('Password')).toHaveValue('secret123');
  await page.unroute('**/api/v1/auth/login');
  await page.route('**/api/v1/auth/login', route => route.fulfill({ json: user }));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: user }));
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ json: { membership: null, capabilities: {} } }));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/communities\/irm\/membership$/);
});

test('register keeps five fields, server validation, and separate membership success', async ({ page }, info) => {
  await guest(page);
  await page.route('**/api/v1/auth/register', route => route.fulfill({ status: 422, json: { detail: [{ loc: ['body', 'password'], msg: 'String should have at least 8 characters', type: 'string_too_short' }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  for (const name of ['Username', 'Email Address', 'First Name', 'Family Name', 'Password']) await expect(page.getByLabel(name, { exact: false })).toBeVisible();
  expect(await page.locator('form input.ui-field').evaluateAll(inputs => inputs.map(input => input.getAttribute('name')))).toEqual(['first_name', 'family_name', 'username', 'email', 'password']);
  for (const [label, placeholder, autocomplete] of [
    ['First Name', 'e.g. Sara', 'given-name'],
    ['Family Name', 'e.g. El Mansouri', 'family-name'],
    ['Username', 'e.g. sara_elm', 'username'],
    ['Email Address', 'e.g. sara@gmail.com', 'email'],
    ['Password', null, 'new-password'],
  ] as const) {
    const input = page.getByLabel(label, { exact: false });
    await expect(input).toHaveAttribute('autocomplete', autocomplete);
    if (placeholder) await expect(input).toHaveAttribute('placeholder', placeholder);
    else await expect(input).not.toHaveAttribute('placeholder');
  }
  await expect(page.locator('#register-username-hint')).toHaveText('Use 3 to 50 characters.');
  await expect(page.locator('#register-email-hint')).toHaveText('Any valid email address works.');
  await expect(page.locator('#register-password-hint')).toHaveText('Use at least 8 characters.');
  await page.getByLabel('Username').fill('student');
  await page.getByLabel('Email Address').fill('student@example.test');
  await page.getByLabel('First Name').fill('Test');
  await page.getByLabel('Family Name').fill('Student');
  await page.getByLabel('Password', { exact: false }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#register-password-error')).toContainText('at least 8 characters');
  await expect(page.getByLabel('First Name')).toHaveValue('Test');
  await expect(page.getByLabel('Password')).toHaveValue('short');
  await expect(page.getByLabel('Password')).toHaveAttribute('aria-describedby', 'register-password-error');
  await page.screenshot({ path: info.outputPath('register-390-validation-error.png'), fullPage: true });
  await page.unroute('**/api/v1/auth/register');
  await page.route('**/api/v1/auth/register', route => {
    expect(route.request().postDataJSON()).toEqual({ username: 'student', email: 'student@example.test', first_name: 'Test', family_name: 'Student', password: 'secret123' });
    return route.fulfill({ status: 201, json: user });
  });
  await page.getByLabel('Password', { exact: false }).fill('secret123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status')).toContainText('request IRM membership');
  await expect(page).toHaveURL(/\/register$/);
});

test('network errors stay in a form summary and preserve registration values', async ({ page }) => {
  await guest(page);
  await page.route('**/api/v1/auth/register', route => route.abort('failed'));
  await page.goto('/register');
  await page.getByLabel('First Name').fill('Sara');
  await page.getByLabel('Family Name').fill('El Mansouri');
  await page.getByLabel('Username').fill('sara_elm');
  await page.getByLabel('Email Address').fill('sara@example.test');
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to connect to the server');
  await expect(page.getByLabel('First Name')).toHaveValue('Sara');
  await expect(page.getByLabel('Email Address')).toHaveValue('sara@example.test');
  await expect(page.getByLabel('Password')).toHaveValue('a-long-password');
});

test('delayed auth, error retry, and signed-in visitor never show guest fields', async ({ page }) => {
  let release!: () => void;
  await page.route('**/api/v1/auth/me', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Checking your account' })).toBeVisible();
  await expect(page.getByLabel('Email Address')).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: "We couldn't check your account" })).toBeVisible();
  await page.unroute('**/api/v1/auth/me');
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: user }));
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ json: { membership: null, capabilities: {} } }));
  await page.getByRole('button', { name: 'Retry account check' }).click();
  await expect(page.getByRole('heading', { name: "You're signed in" })).toBeVisible();
  await expect(page.getByLabel('Email Address')).toHaveCount(0);
});

test('responsive theme, keyboard focus, and overflow', async ({ page }, info) => {
  await guest(page);
  for (const width of [320, 390, 768, 1440]) {
    for (const theme of ['Light', 'Dark']) {
      for (const path of ['/login', '/register']) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await page.getByRole('radio', { name: theme }).check();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
        await expect(page.getByRole('button', { name: path === '/login' ? 'Sign in' : 'Create account' })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: info.outputPath(`${path.slice(1)}-${width}-${theme.toLowerCase()}.png`), fullPage: true });
        }
      }
    }
  }
  await page.goto('/login');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus-visible')).toHaveCount(1);
});
