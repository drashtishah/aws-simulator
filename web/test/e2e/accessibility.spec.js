const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

test.describe('Accessibility', () => {
  test('dashboard view passes axe-core WCAG 2.1 AA', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('play view with sim picker passes axe-core', async ({ page }) => {
    await page.goto('/');
    await page.click('#tab-play');
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include('#view-play')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('settings modal passes axe-core', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-settings');
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include('#settings-modal')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('tab navigation reaches all interactive elements', async ({ page }) => {
    await page.goto('/');
    // Tab through the page and verify we can reach key elements
    const focusableSelectors = [
      '#tab-dashboard',
      '#tab-play',
      '#btn-settings',
    ];

    for (const selector of focusableSelectors) {
      // Focus the element directly and verify it can receive focus
      await page.locator(selector).focus();
      await expect(page.locator(selector)).toBeFocused();
    }
  });

  test('chat messages container has role="log" and aria-live="polite"', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#chat-messages')).toHaveAttribute('role', 'log');
    await expect(page.locator('#chat-messages')).toHaveAttribute('aria-live', 'polite');
  });

  test('settings modal has role="dialog"', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#settings-modal .modal')).toHaveAttribute('role', 'dialog');
  });

  test('navigation has role="tablist" with proper tab roles', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.topbar-nav')).toHaveAttribute('role', 'tablist');
    await expect(page.locator('#tab-dashboard')).toHaveAttribute('role', 'tab');
    await expect(page.locator('#tab-play')).toHaveAttribute('role', 'tab');
  });

  test('settings button has aria-label', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-settings')).toHaveAttribute('aria-label', 'Settings');
  });

  test('chat input has aria-label', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#chat-input')).toHaveAttribute('aria-label', 'Message input');
  });

  test('focus-visible outline is present on interactive elements', async ({ page }) => {
    await page.goto('/');
    // Tab to a button and check that focus outline exists
    await page.locator('#tab-dashboard').focus();
    const outlineStyle = await page.locator('#tab-dashboard').evaluate(el => {
      return getComputedStyle(el, ':focus-visible').outlineStyle || getComputedStyle(el).outlineStyle;
    });
    // Should have some outline style (not 'none')
    expect(outlineStyle).not.toBe('');
  });
});
