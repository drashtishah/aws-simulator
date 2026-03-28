const { test, expect } = require('@playwright/test');

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('UI theme dropdown populated from API', async ({ page }) => {
    await page.click('#btn-settings');
    const options = page.locator('#select-ui-theme option');
    await expect(options.first()).toBeAttached();
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('narrative theme dropdown populated from API', async ({ page }) => {
    await page.click('#btn-settings');
    const options = page.locator('#select-narrative-theme option');
    await expect(options.first()).toBeAttached();
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('model dropdown has sonnet, opus, haiku options', async ({ page }) => {
    await page.click('#btn-settings');
    const select = page.locator('#select-model');
    await expect(select.locator('option[value="sonnet"]')).toBeAttached();
    await expect(select.locator('option[value="opus"]')).toBeAttached();
    await expect(select.locator('option[value="haiku"]')).toBeAttached();
  });

  test('changing UI theme updates stylesheet href', async ({ page }) => {
    await page.click('#btn-settings');
    const themeLink = page.locator('#ui-theme');
    // Get the theme select and pick a value
    const select = page.locator('#select-ui-theme');
    const firstOption = await select.locator('option').first().getAttribute('value');
    await select.selectOption(firstOption);
    await expect(themeLink).toHaveAttribute('href', `/ui-themes/${firstOption}.css`);
  });

  test('settings persist in localStorage across page reload', async ({ page }) => {
    await page.click('#btn-settings');
    // Change model to opus
    await page.locator('#select-model').selectOption('opus');
    await page.click('#btn-close-settings');

    // Reload page
    await page.reload();
    await page.click('#btn-settings');

    const modelValue = await page.locator('#select-model').inputValue();
    expect(modelValue).toBe('opus');
  });

  test('default UI theme is dracula', async ({ page }) => {
    const themeLink = page.locator('#ui-theme');
    await expect(themeLink).toHaveAttribute('href', '/ui-themes/dracula.css');
  });

  test('default model is sonnet', async ({ page }) => {
    await page.click('#btn-settings');
    const modelValue = await page.locator('#select-model').inputValue();
    expect(modelValue).toBe('sonnet');
  });
});
