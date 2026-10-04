import { test, expect } from '@playwright/test';

test.describe('Support Page Functionality', () => {
  test('Anonymous visitor can access /support and see honest copy and fallback', async ({ page }) => {
    await page.goto('/support');
    await expect(page.locator('h1')).toHaveText('Support IRM Hub');
    await expect(page.getByText('Independent Student Project')).toBeVisible();

    // Verify copy
    await expect(page.getByText('IRM Hub helps IRM students share study resources')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What We Have Built' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Supporting the Platform' })).toBeVisible();
    await expect(page.getByText('Support contact details will be available soon.')).toBeVisible();

    // Verify breadcrumbs and return links
    await expect(page.locator("nav[aria-label='Breadcrumb']").getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: /Back to Homepage/i })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: /Explore IRM Modules/i })).toHaveAttribute('href', '/communities/irm/modules');
  });

  test('Shared Header navigation includes Support link', async ({ page }) => {
    await page.goto('/');
    const supportLink = page.locator("nav[aria-label='Main Navigation']").getByRole('link', { name: 'Support' });
    await expect(supportLink).toBeVisible();
    await expect(supportLink).toHaveAttribute('href', '/support');

    await supportLink.click();
    await page.waitForURL('/support');
    await expect(page.locator('h1')).toHaveText('Support IRM Hub');
  });

  test('Mobile viewport renders without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/support');
    await expect(page.locator('h1')).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
