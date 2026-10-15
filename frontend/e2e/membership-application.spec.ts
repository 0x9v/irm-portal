import { test, expect, Page } from '@playwright/test';

const support = '/support';
const options = {
  current_academic_year_start: 2026,
  applicant_types: ['STUDENT', 'LAUREATE'],
  student_identifier_types: ['MASSAR', 'FOREIGN'],
  promotion_options: ['2025/2026', '2024/2025', '2023/2024', '2022/2023', '2021/2022', '2020/2021'],
  custom_promotion_formats: ['YYYY', 'YY', 'YYYY/YYYY', 'YY/YY'],
};
const legacy = { id: 'm-1', status: 'REJECTED', role: 'MEMBER', cne: '001234567', applicant_type: null, applicant_first_name: null, applicant_family_name: null, identifier_type: null, promotion: null };

async function fixture(page: Page, mode: 'apply' | 'none' | 'pending' | 'active' | 'removed' | 'banned' | 'review' = 'apply', optionsFail = false) {
  const state = { posts: [] as unknown[], membership: (mode === 'none' ? null
    : mode === 'pending' ? { ...legacy, status: 'PENDING', applicant_type: 'STUDENT', applicant_first_name: 'Élodie', applicant_family_name: 'Ben Ali', identifier_type: 'MASSAR', cne: 'R123456789' }
    : mode === 'active' || mode === 'review' ? { id: 'delegate', status: 'ACTIVE', role: mode === 'review' ? 'DELEGATE' : 'MEMBER' }
    : mode === 'removed' || mode === 'banned' ? { ...legacy, status: mode.toUpperCase() } : legacy) as Record<string, unknown> | null,
    postStatus: 201, optionsFail, membershipFail: false };
  const headers = { 'Access-Control-Allow-Origin': process.env.IRM_ACCEPTANCE_FRONTEND || 'http://127.0.0.1:3128', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status, headers: { ...headers, 'Cache-Control': 'private, no-store' } });
    if (url.pathname.endsWith('/auth/me')) return json({ id: 'u-1', username: 'account-user', first_name: 'Account', family_name: 'Name', email: 'fixture@example.invalid' });
    if (url.pathname.endsWith('/membership/me')) return state.membershipFail ? json({ detail: 'Verification unavailable' }, 503) : json({ membership: state.membership, capabilities: {} });
    if (url.pathname.endsWith('/membership/application-options')) return state.optionsFail ? json({ detail: 'Unavailable' }, 503) : json(options);
    if (url.pathname.endsWith('/membership/pending')) return json([{ id: 'pending-1', status: 'PENDING', role: 'MEMBER', cne: '001234567', applicant_type: 'STUDENT', applicant_first_name: 'Élodie', applicant_family_name: 'Ben Ali', identifier_type: 'FOREIGN', promotion: null, created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T10:00:00Z', username: 'account-user', first_name: 'Account', family_name: 'Name' }]);
    if (url.pathname.endsWith('/memberships')) return json({ items: [{ id: 'safe-row', status: 'ACTIVE', role: 'MEMBER', username: 'directory-user', created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T10:00:00Z' }], next_cursor: null });
    if (url.pathname.endsWith('/membership') && method === 'POST') {
      state.posts.push(route.request().postDataJSON());
      if (state.postStatus !== 201) return json({ detail: [{ loc: ['body', 'cne'], msg: 'Invalid identifier' }] }, state.postStatus);
      state.membership = { ...legacy, status: 'PENDING', applicant_type: 'STUDENT', applicant_first_name: "Élodie O'Neil-Smith", applicant_family_name: 'Ben Ali', identifier_type: 'MASSAR', cne: 'R123456789' };
      return json({ id: 'new-m', status: 'PENDING', role: 'MEMBER', community_id: 'c', created_at: '2026-10-11T10:00:00Z', updated_at: '2026-10-11T10:00:00Z' }, state.postStatus);
    }
    if (url.pathname.endsWith('/membership/pending-1/approve') || url.pathname.endsWith('/membership/pending-1/reject')) return json({ status: 'ACTIVE', role: 'MEMBER' });
    if (url.pathname.endsWith('/membership/pending-1')) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/membership/me') && method === 'GET') return json({ membership: state.membership, capabilities: {} });
    if (url.pathname.endsWith('/membership/active')) return json([]);
    return route.fulfill({ status: 204 });
  });
  return state;
}

test('legacy personal route redirects to the Account membership section', async ({ page }) => {
  await fixture(page, 'none');
  await page.goto('/communities/irm/membership');
  await expect(page).toHaveURL(/\/account#community-membership$/);
  await expect(page.getByRole('region', { name: 'Community membership' })).toBeVisible();
});

for (const [mode, status, canApply] of [
  ['none', null, true], ['pending', 'PENDING', false], ['active', 'ACTIVE', false],
  ['apply', 'REJECTED', true], ['removed', 'REMOVED', true], ['banned', 'BANNED', false],
] as const) {
  test(`${mode} membership is composed in Account with its actual permitted action`, async ({ page }) => {
    const state = await fixture(page, mode);
    await page.goto('/account#community-membership');
    const section = page.getByRole('region', { name: 'Community membership' });
    await expect(section).toBeVisible();
    if (status) {
      await expect(section).toContainText(`Status: ${status}`);
      await expect(section).toContainText('Role: MEMBER');
    } else await expect(section).not.toContainText('Role:');
    await expect(section.locator('form')).toHaveCount(canApply ? 1 : 0);
    if (mode === 'banned') await expect(section).toContainText('Community Access Restricted');
    expect(state.posts).toHaveLength(0);
  });
}

test('verification failure shows Retry and hides stale application details', async ({ page }) => {
  const state = await fixture(page, 'pending');
  state.membershipFail = true;
  await page.goto('/account#community-membership');
  const section = page.getByRole('region', { name: 'Community membership' });
  await expect(section.getByRole('button', { name: 'Retry Verification' })).toBeVisible();
  await expect(section).not.toContainText('Élodie');
  await expect(section.locator('form')).toHaveCount(0);
});

test('Student submits Massar payload and refreshes applicant membership state', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/account#community-membership');
  await page.getByLabel('Applicant type').selectOption('STUDENT');
  await page.getByLabel('Real first name').fill(" Élodie O'Neil-Smith ");
  await page.getByLabel('Real family name').fill('Ben Ali');
  await page.getByLabel('Student identifier').fill('r123456789');
  await page.getByRole('button', { name: 'Reapply for membership' }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toEqual({ applicant_type: 'STUDENT', applicant_first_name: "Élodie O'Neil-Smith", applicant_family_name: 'Ben Ali', identifier_type: 'MASSAR', cne: 'R123456789' });
  await expect(page.getByText('Your request is usually reviewed within approximately 6 hours.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Support' })).toHaveAttribute('href', support);
  await expect(page.getByRole('region', { name: 'Your submitted application details' })).toContainText('Élodie');
});

test('Laureate promotion options are backend-provided and custom promotion is submitted without a sentinel', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/account#community-membership');
  await page.getByLabel('Applicant type').selectOption('LAUREATE');
  await expect(page.getByRole('option', { name: '2025/2026' })).toBeAttached();
  await expect(page.getByRole('option', { name: '2026/2027' })).toHaveCount(0);
  await page.getByLabel('Real first name').fill('José');
  await page.getByLabel('Real family name').fill("D'Arcy");
  await page.getByRole('button', { name: 'Older / Other' }).click();
  await page.getByLabel('Custom promotion').fill('23/24');
  await page.getByRole('button', { name: 'Reapply for membership' }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toEqual({ applicant_type: 'LAUREATE', applicant_first_name: 'José', applicant_family_name: "D'Arcy", promotion: '23/24' });
});

test('Laureate options error blocks an invalid submit and required fields show feedback', async ({ page }) => {
  const state = await fixture(page, 'apply', true);
  await page.goto('/account#community-membership');
  await page.getByLabel('Applicant type').selectOption('LAUREATE');
  await expect(page.getByText(/Promotion options could not be loaded/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request membership' })).toBeDisabled();
  expect(state.posts).toHaveLength(0);
  state.optionsFail = false;
  await page.getByRole('button', { name: 'Retry options' }).click();
  await expect(page.getByLabel('Completed promotion')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request membership' })).toBeDisabled();
});

test('Foreign Student sends a numeric/alphanumeric identifier string with leading zeros unchanged', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/account#community-membership');
  await page.getByLabel('Applicant type').selectOption('STUDENT');
  await page.getByLabel('Real first name').fill('Meryem');
  await page.getByLabel('Real family name').fill('El Amrani');
  await page.getByLabel('Student identifier type').selectOption('FOREIGN');
  await page.getByLabel('Student identifier').fill('00123ab');
  await page.getByRole('button', { name: 'Reapply for membership' }).click();
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toEqual({ applicant_type: 'STUDENT', applicant_first_name: 'Meryem', applicant_family_name: 'El Amrani', identifier_type: 'FOREIGN', cne: '00123ab' });
});

test('Student client boundaries reject invalid names and identifiers; server errors preserve drafts', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/account#community-membership');
  await page.getByLabel('Applicant type').selectOption('STUDENT');
  await page.getByLabel('Real first name').fill('A'.repeat(101));
  await page.getByLabel('Real family name').fill('Family');
  await page.getByLabel('Student identifier').fill('R12345678\n');
  await page.getByRole('button', { name: 'Reapply for membership' }).click();
  await expect(page.getByText('Use no more than 100 characters.')).toBeVisible();
  await expect(page.getByText('Use one letter followed by nine digits.')).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await page.getByLabel('Real first name').fill('Aïcha');
  await page.getByLabel('Student identifier').fill('R123456789');
  state.postStatus = 422;
  await page.getByRole('button', { name: 'Reapply for membership' }).click();
  await expect(page.getByText(/CNE|cne/i)).toBeVisible();
  await expect(page.getByLabel('Real first name')).toHaveValue('Aïcha');
  await expect(page.getByLabel('Student identifier')).toHaveValue('R123456789');
});

test('Pending applicant details and legacy NULL details render without inference', async ({ page }) => {
  await fixture(page, 'pending');
  await page.goto('/account#community-membership');
  await expect(page.getByRole('region', { name: 'Your submitted application details' })).toContainText('STUDENT');
  await expect(page.getByRole('region', { name: 'Your submitted application details' })).toContainText('R123456789');
  await page.unroute('**/api/v1/communities/irm/membership/me');
  await page.route('**/api/v1/communities/irm/membership/me', route => route.fulfill({ json: { membership: legacy, capabilities: {} } }));
  await page.reload();
  await expect(page.getByText('Application details are unavailable for this membership.')).toBeVisible();
  await expect(page.getByText('STUDENT', { exact: true })).toHaveCount(0);
});

test('Delegate review separates account profile and submitted names and leaves legacy details honest', async ({ page }) => {
  const state = await fixture(page, 'review');
  await page.goto('/communities/irm/membership/review');
  const card = page.locator('div').filter({ hasText: 'Submitted application name: Élodie Ben Ali' }).last();
  await expect(card).toContainText('Account: Account Name');
  await expect(card).toContainText('Submitted application name: Élodie Ben Ali');
  await expect(card).toContainText('FOREIGN');
  expect(state.posts).toHaveLength(0);
});

test('membership form fits all required widths, adapts to both themes, and supports keyboard use', async ({ page }) => {
  await fixture(page);
  await page.goto('/account#community-membership');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 820 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => localStorage.setItem('irm-theme', value), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }
  await page.getByLabel('Applicant type').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Real first name')).toBeFocused();
});

test('directory and staff views receive no application fields', async ({ page }) => {
  await fixture(page, 'review');
  await page.goto('/communities/irm/membership/members');
  await expect(page.getByText('@directory-user')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Élodie');
  await page.goto('/communities/irm/membership/staff');
  await expect(page.getByRole('heading', { name: 'Staff Management' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Élodie');
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storage).not.toContain('Élodie');
  expect(storage).not.toContain('001234567');
});

