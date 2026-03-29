const { test, expect } = require('@playwright/test');

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('settings dropdowns use custom styled components, not native select', async ({ page }) => {
    await page.click('#btn-settings');
    const nativeSelects = page.locator('.modal select');
    await expect(nativeSelects).toHaveCount(0);
    const customDropdowns = page.locator('.modal .custom-select');
    await expect(customDropdowns).toHaveCount(3);
  });

  test('UI theme dropdown populated from API', async ({ page }) => {
    await page.click('#btn-settings');
    const trigger = page.locator('#select-ui-theme .custom-select-trigger');
    await expect(trigger).toBeVisible();
    const text = await trigger.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('narrative theme dropdown populated from API', async ({ page }) => {
    await page.click('#btn-settings');
    const trigger = page.locator('#select-narrative-theme .custom-select-trigger');
    await expect(trigger).toBeVisible();
    const text = await trigger.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('custom dropdown opens and selects option', async ({ page }) => {
    await page.click('#btn-settings');
    const dropdown = page.locator('#select-model');
    const trigger = dropdown.locator('.custom-select-trigger');

    // Click to open
    await trigger.click();
    await expect(dropdown).toHaveClass(/open/);
    const options = dropdown.locator('.custom-select-options');
    await expect(options).toBeVisible();

    // Select an option
    const option = dropdown.locator('.custom-select-option').first();
    await option.click();
    await expect(dropdown).not.toHaveClass(/open/);
  });

  test('model dropdown has sonnet, opus, haiku options', async ({ page }) => {
    await page.click('#btn-settings');
    const dropdown = page.locator('#select-model');
    const trigger = dropdown.locator('.custom-select-trigger');
    await trigger.click();
    const options = dropdown.locator('.custom-select-option');
    const count = await options.count();
    expect(count).toBe(3);
    const texts = [];
    for (let i = 0; i < count; i++) {
      texts.push(await options.nth(i).textContent());
    }
    expect(texts).toContain('Sonnet');
    expect(texts).toContain('Opus');
    expect(texts).toContain('Haiku');
  });

  test('changing UI theme updates stylesheet href', async ({ page }) => {
    await page.click('#btn-settings');
    const themeLink = page.locator('#ui-theme');
    const dropdown = page.locator('#select-ui-theme');
    const trigger = dropdown.locator('.custom-select-trigger');

    await trigger.click();
    const firstOption = dropdown.locator('.custom-select-option').first();
    const themeValue = await firstOption.getAttribute('data-value');
    await firstOption.click();
    await expect(themeLink).toHaveAttribute('href', `/ui-themes/${themeValue}.css`);
  });

  test('default UI theme is dracula', async ({ page }) => {
    const themeLink = page.locator('#ui-theme');
    await expect(themeLink).toHaveAttribute('href', '/ui-themes/dracula.css');
  });

  test('keyboard navigation works on dropdowns', async ({ page }) => {
    await page.click('#btn-settings');
    const trigger = page.locator('#select-model .custom-select-trigger');
    await trigger.focus();
    // Enter opens dropdown
    await page.keyboard.press('Enter');
    await expect(page.locator('#select-model')).toHaveClass(/open/);
    // Escape closes
    await page.keyboard.press('Escape');
    await expect(page.locator('#select-model')).not.toHaveClass(/open/);
  });
});
