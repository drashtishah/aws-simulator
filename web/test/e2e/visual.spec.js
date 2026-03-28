const { test, expect } = require('@playwright/test');
const { mockGameRoutes } = require('./fixtures');

test.describe('Visual Regression', () => {
  test('dashboard at desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    // Mask dynamic content that changes between runs
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('dashboard-desktop.png', {
      mask: [page.locator('#stat-level'), page.locator('#stat-completed')],
    });
  });

  test('dashboard at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('dashboard-mobile.png', {
      mask: [page.locator('#stat-level'), page.locator('#stat-completed')],
    });
  });

  test('sim picker grid at desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.click('#tab-play');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('sim-picker-desktop.png');
  });

  test('sim picker at mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.click('#tab-play');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('sim-picker-mobile.png');
  });

  test('settings modal', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.click('#btn-settings');
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('settings-modal.png');
  });

  test('chat with mixed message types', async ({ page }) => {
    await mockGameRoutes(page, {
      narratorText: 'A critical incident has been reported at FinCorp. The API gateway is returning 503 errors.',
      consoleText: '{"Status": "UNHEALTHY", "TargetGroup": "api-tg", "HealthyHosts": 0}',
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.click('#tab-play');
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-input')).toBeEnabled();
    // Send a player message
    await page.fill('#chat-input', 'Show me the CloudWatch alarms for the last hour');
    await page.click('#btn-send');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('chat-messages.png');
  });

  test('topbar at desktop and mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await expect(page.locator('.topbar')).toHaveScreenshot('topbar-desktop.png');

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await expect(page.locator('.topbar')).toHaveScreenshot('topbar-mobile.png');
  });

  test('sim card close-up', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await page.click('#tab-play');
    await page.waitForTimeout(500);
    const card = page.locator('.sim-card').first();
    await expect(card).toHaveScreenshot('sim-card.png');
  });
});
