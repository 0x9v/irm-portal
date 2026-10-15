import { test, expect } from '@playwright/test';

test.describe('Recently opened documents', () => {
  test('supports retry, cursor pagination, and clears rows after an account switch', async ({ page }) => {
    let userId = 'reader-one';
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({
      status: 200,
      json: { id: userId, username: userId, email: `${userId}@example.com`, first_name: 'Reader', family_name: 'One' },
    }));
    await page.route('**/api/v1/communities/irm/membership/me', (route) => route.fulfill({
      status: 200, json: { membership: null, capabilities: {} },
    }));

    let failFirst = true;
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      id: `document-${index + 1}`,
      module_id: 'module-1',
      module_slug: 'systems-programming',
      module_name: 'Systems Programming',
      title: index === 0 ? 'Real Recent Document' : `Document ${index + 1}`,
      type: 'COURSE',
      source: 'OFFICIAL',
      last_page: 3,
      last_opened_at: '2026-10-10T12:00:00Z',
    }));
    await page.route('**/api/v1/communities/irm/documents/recent?*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (userId === 'reader-two') {
        await route.fulfill({ status: 200, json: { items: [], next_cursor: null } });
      } else if (requestUrl.searchParams.has('after')) {
        expect(requestUrl.searchParams.get('after')).toBe('cursor-20');
        await route.fulfill({ status: 200, json: { items: [{ ...firstPage[0], id: 'document-21', title: 'Cursor Page Document' }], next_cursor: null } });
      } else if (failFirst) {
        failFirst = false;
        await route.fulfill({ status: 503, json: { detail: 'temporary failure' } });
      } else {
        await route.fulfill({ status: 200, json: { items: firstPage, next_cursor: 'cursor-20' } });
      }
    });

    await page.goto('/communities/irm/documents/recent');
    await expect(page.getByText(/Could not load recently opened documents/)).toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('heading', { name: 'Real Recent Document' })).toBeVisible();
    await expect(page.getByText('Systems Programming').first()).toBeVisible();
    await expect(page.getByText('Course').first()).toBeVisible();
    await expect(page.getByText('Official').first()).toBeVisible();
    await expect(page.getByText('Last opened')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue reading' })).toHaveAttribute('href', /systems-programming\/documents\/document-1$/);

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByRole('heading', { name: 'Cursor Page Document' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    userId = 'reader-two';
    await page.reload();
    await expect(page.getByText('You have not opened any approved documents yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Real Recent Document' })).toHaveCount(0);
  });

  test('module lists do not create reading opens', async ({ page }) => {
    await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 200, json: { id: 'reader-one', username: 'reader', email: 'reader@example.com', first_name: 'Reader', family_name: 'One' } }));
    await page.route('**/api/v1/communities/irm/membership/me', (route) => route.fulfill({ status: 200, json: { membership: null, capabilities: {} } }));
    let opens = 0;
    await page.route('**/api/v1/communities/irm/documents/*/reading/open', async (route) => {
      opens += 1;
      await route.fulfill({ status: 200, json: { last_page: 1 } });
    });
    await page.route('**/api/v1/communities/irm/modules', (route) => route.fulfill({ status: 200, json: [] }));
    await page.goto('/communities/irm/modules');
    await expect(page.getByText('No modules found.')).toBeVisible();
    expect(opens).toBe(0);
  });
});
