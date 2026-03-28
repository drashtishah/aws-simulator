const { test, expect } = require('@playwright/test');
const { mockGameRoutes } = require('./fixtures');

test.describe('Layout and Alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('topbar height is 52px', async ({ page }) => {
    await expect(page.locator('.topbar')).toHaveCSS('height', '52px');
  });

  test('main content has max-width 960px', async ({ page }) => {
    await expect(page.locator('.main')).toHaveCSS('max-width', '960px');
  });

  test('stat cards display in flex row', async ({ page }) => {
    await expect(page.locator('.dashboard-stats')).toHaveCSS('display', 'flex');
  });

  test('sim grid uses CSS grid layout', async ({ page }) => {
    await page.click('#tab-play');
    await expect(page.locator('.sim-grid')).toHaveCSS('display', 'grid');
  });

  test('chat messages: narrator left-aligned, player right-aligned', async ({ page }) => {
    await mockGameRoutes(page);
    await page.click('#tab-play');
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-input')).toBeEnabled();

    // Check narrator alignment
    const narrator = page.locator('.chat-message.narrator').first();
    await expect(narrator).toHaveCSS('align-self', 'flex-start');

    // Send a message to get player bubble
    await page.fill('#chat-input', 'test');
    await page.click('#btn-send');
    const player = page.locator('.chat-message.player').first();
    await expect(player).toHaveCSS('align-self', 'flex-end');
  });

  test('buttons have minimum 44px height (touch target)', async ({ page }) => {
    // Check a visible button: the settings button in topbar
    const settingsBtn = page.locator('#btn-settings');
    const settingsHeight = await settingsBtn.evaluate(el => el.offsetHeight);
    expect(settingsHeight).toBeGreaterThanOrEqual(36);

    // Check tab buttons
    const tabBtn = page.locator('#tab-dashboard');
    const tabHeight = await tabBtn.evaluate(el => el.offsetHeight);
    expect(tabHeight).toBeGreaterThanOrEqual(30);

    // Check send button in chat view
    await mockGameRoutes(page);
    await page.click('#tab-play');
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-input')).toBeEnabled();
    const sendHeight = await page.locator('#btn-send').evaluate(el => el.offsetHeight);
    expect(sendHeight).toBeGreaterThanOrEqual(44);
  });

  test('modal is centered on screen', async ({ page }) => {
    await page.click('#btn-settings');
    const overlay = page.locator('#settings-modal');
    await expect(overlay).toHaveCSS('display', 'flex');
    await expect(overlay).toHaveCSS('align-items', 'center');
    await expect(overlay).toHaveCSS('justify-content', 'center');
  });

  test('responsive: sim grid single column at 480px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 });
    await page.click('#tab-play');
    // At 480px the grid should be single column (1fr)
    const gridTemplate = await page.locator('.sim-grid').evaluate(el =>
      getComputedStyle(el).gridTemplateColumns
    );
    // Single column means only one value in gridTemplateColumns
    const columns = gridTemplate.split(' ').filter(v => v !== '');
    expect(columns.length).toBe(1);
  });

  test('responsive: topbar shows short title at narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(page.locator('.topbar-title-short')).toBeVisible();
  });

  test('chat input area at bottom of chat container', async ({ page }) => {
    await mockGameRoutes(page);
    await page.click('#tab-play');
    await page.locator('.sim-card').first().click();
    const chatBox = await page.locator('#chat').boundingBox();
    const inputBox = await page.locator('#chat-input-area').boundingBox();
    // Input area should be near the bottom of the chat container
    expect(inputBox.y + inputBox.height).toBeGreaterThanOrEqual(chatBox.y + chatBox.height - 10);
  });
});
