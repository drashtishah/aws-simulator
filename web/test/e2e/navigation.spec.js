const { test, expect } = require('@playwright/test');

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads with dashboard active', async ({ page }) => {
    await expect(page.locator('#view-dashboard')).toHaveClass(/active/);
    await expect(page.locator('#view-play')).not.toHaveClass(/active/);
  });

  test('dashboard tab has aria-selected true on load', async ({ page }) => {
    await expect(page.locator('#tab-dashboard')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-play')).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking Play tab switches view and updates aria-selected', async ({ page }) => {
    await page.click('#tab-play');
    await expect(page.locator('#view-play')).toHaveClass(/active/);
    await expect(page.locator('#view-dashboard')).not.toHaveClass(/active/);
    await expect(page.locator('#tab-play')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-dashboard')).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking Dashboard tab switches back', async ({ page }) => {
    await page.click('#tab-play');
    await page.click('#tab-dashboard');
    await expect(page.locator('#view-dashboard')).toHaveClass(/active/);
    await expect(page.locator('#tab-dashboard')).toHaveAttribute('aria-selected', 'true');
  });

  test('settings button opens modal', async ({ page }) => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-modal')).toHaveClass(/active/);
  });

  test('clicking outside modal closes it', async ({ page }) => {
    await page.click('#btn-settings');
    await expect(page.locator('#settings-modal')).toHaveClass(/active/);
    // Click the overlay (outside the modal content)
    await page.locator('#settings-modal').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#settings-modal')).not.toHaveClass(/active/);
  });

  test('close button closes modal', async ({ page }) => {
    await page.click('#btn-settings');
    await page.click('#btn-close-settings');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/active/);
  });

  test('topbar is visible and contains title', async ({ page }) => {
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.topbar-title-full')).toHaveText('AWS Incident Simulator');
  });
});
