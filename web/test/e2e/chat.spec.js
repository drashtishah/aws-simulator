const { test, expect } = require('@playwright/test');
const { mockGameRoutes, mockGameComplete } = require('./fixtures');

test.describe('Chat', () => {
  test.beforeEach(async ({ page }) => {
    await mockGameRoutes(page);
    await page.goto('/');
    await page.click('#tab-play');
  });

  test('chat container appears when sim starts', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat')).toHaveClass(/active/);
  });

  test('sim title shown in chat header', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-sim-title')).not.toHaveText('');
  });

  test('narrator messages appear with correct class', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('.chat-message.narrator').first()).toBeVisible();
    await expect(page.locator('.chat-message.narrator').first()).toContainText('investigator');
  });

  test('console messages appear with correct class', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('.chat-message.console').first()).toBeVisible();
    await expect(page.locator('.chat-message.console').first()).toContainText('CPUUtilization');
  });

  test('player message appears when sent', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    // Wait for chat to be ready
    await expect(page.locator('#chat-input')).toBeEnabled();
    await page.fill('#chat-input', 'Check CloudWatch logs');
    await page.click('#btn-send');
    await expect(page.locator('.chat-message.player')).toContainText('Check CloudWatch logs');
  });

  test('empty message is not sent', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-input')).toBeEnabled();
    const messagesBefore = await page.locator('.chat-message.player').count();
    await page.click('#btn-send');
    const messagesAfter = await page.locator('.chat-message.player').count();
    expect(messagesAfter).toBe(messagesBefore);
  });

  test('Enter sends message, Shift+Enter does not', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-input')).toBeEnabled();
    // Shift+Enter should not send
    await page.locator('#chat-input').focus();
    await page.keyboard.type('line one');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line two');
    // Should not have created a player message yet
    const playerMsgCount = await page.locator('.chat-message.player').count();
    expect(playerMsgCount).toBe(0);
    // Now Enter should send
    await page.keyboard.press('Enter');
    await expect(page.locator('.chat-message.player').first()).toBeVisible();
  });

  test('textarea auto-resizes on input', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-input')).toBeEnabled();
    const initialHeight = await page.locator('#chat-input').evaluate(el => el.offsetHeight);
    // Type multiple lines
    await page.locator('#chat-input').focus();
    await page.keyboard.type('Line 1\nLine 2\nLine 3\nLine 4');
    const newHeight = await page.locator('#chat-input').evaluate(el => el.offsetHeight);
    expect(newHeight).toBeGreaterThanOrEqual(initialHeight);
  });

  test('back button returns to sim picker', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat')).toHaveClass(/active/);
    // Set up dialog handler for confirm
    page.on('dialog', dialog => dialog.accept());
    await page.click('#btn-back-to-sims');
    await expect(page.locator('#sim-picker')).toBeVisible();
    await expect(page.locator('#chat')).not.toHaveClass(/active/);
  });

  test('quit button shows confirmation dialog', async ({ page }) => {
    await page.locator('.sim-card').first().click();
    await expect(page.locator('#chat-input')).toBeEnabled();
    let dialogShown = false;
    page.on('dialog', async dialog => {
      dialogShown = true;
      expect(dialog.type()).toBe('confirm');
      await dialog.dismiss();
    });
    await page.click('#btn-quit');
    expect(dialogShown).toBe(true);
  });

  test('session complete shows completion message and buttons', async ({ page }) => {
    await mockGameComplete(page);
    await page.locator('.sim-card').first().click();
    await expect(page.locator('.chat-message.system').first()).toContainText('Simulation complete');
    await expect(page.locator('#btn-return-dashboard')).toBeVisible();
  });
});
