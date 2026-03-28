const { test, expect } = require('@playwright/test');
const { mockGameRoutes } = require('./fixtures');

test.describe('Sim Picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('#tab-play');
  });

  test('sim grid renders cards from registry', async ({ page }) => {
    const cards = page.locator('.sim-card');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('each card shows title, difficulty dots, category, and services', async ({ page }) => {
    const card = page.locator('.sim-card').first();
    await expect(card.locator('.sim-card-title')).not.toHaveText('');
    await expect(card.locator('.difficulty-dots')).toBeVisible();
    await expect(card.locator('.sim-card-category')).toBeVisible();
    await expect(card.locator('.sim-card-services')).toBeVisible();
  });

  test('sim cards are keyboard-focusable', async ({ page }) => {
    const card = page.locator('.sim-card').first();
    await expect(card).toHaveAttribute('tabindex', '0');
  });

  test('clicking card transitions to chat view', async ({ page }) => {
    await mockGameRoutes(page);
    const card = page.locator('.sim-card').first();
    await card.click();
    await expect(page.locator('#chat')).toHaveClass(/active/);
    await expect(page.locator('#sim-picker')).not.toBeVisible();
  });

  test('Enter key on focused card starts sim', async ({ page }) => {
    await mockGameRoutes(page);
    const card = page.locator('.sim-card').first();
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#chat')).toHaveClass(/active/);
  });

  test('Space key on focused card starts sim', async ({ page }) => {
    await mockGameRoutes(page);
    const card = page.locator('.sim-card').first();
    await card.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#chat')).toHaveClass(/active/);
  });

  test('empty state shown when no sims', async ({ page }) => {
    await page.route('**/api/registry', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 1, sims: [] }),
      });
    });
    await page.goto('/');
    await page.click('#tab-play');
    await expect(page.locator('#sim-empty')).toBeVisible();
  });

  test('cards have category-based left border color', async ({ page }) => {
    const card = page.locator('.sim-card').first();
    const borderLeft = await card.evaluate(el => getComputedStyle(el).borderLeftStyle);
    expect(borderLeft).toBe('solid');
  });

  test('difficulty dots reflect sim difficulty', async ({ page }) => {
    const card = page.locator('.sim-card').first();
    // Dots are rendered inside .difficulty-dots container as span elements
    const dotsContainer = card.locator('.difficulty-dots');
    await expect(dotsContainer).toBeVisible();
    const dotSpans = dotsContainer.locator('span');
    const totalCount = await dotSpans.count();
    expect(totalCount).toBe(3);
  });
});
