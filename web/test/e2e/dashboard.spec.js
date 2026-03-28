const { test, expect } = require('@playwright/test');

test.describe('Dashboard', () => {
  test('shows level and completed count from profile API', async ({ page }) => {
    await page.goto('/');
    // Wait for profile data to load
    await expect(page.locator('#stat-level')).not.toHaveText('');
    const level = await page.locator('#stat-level').textContent();
    expect(Number(level)).toBeGreaterThanOrEqual(1);
  });

  test('shows strengths and weaknesses when present in profile', async ({ page }) => {
    // Mock profile with strengths and weaknesses
    await page.route('**/api/profile', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_level: 2,
          strengths: ['networking', 'security'],
          weaknesses: ['data'],
          completed_sims: ['sim-1']
        }),
      });
    });
    await page.goto('/');
    await expect(page.locator('#section-skills')).toBeVisible();
    await expect(page.locator('#skills-content')).toContainText('networking');
    await expect(page.locator('#skills-content')).toContainText('data');
  });

  test('hides skills section when no strengths or weaknesses', async ({ page }) => {
    await page.route('**/api/profile', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_level: 1,
          strengths: [],
          weaknesses: [],
          completed_sims: []
        }),
      });
    });
    await page.goto('/');
    // Give time for dashboard to load
    await page.waitForTimeout(500);
    await expect(page.locator('#section-skills')).not.toBeVisible();
  });

  test('shows journal entries when present', async ({ page }) => {
    await page.route('**/api/journal-summary', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { title: 'S3 Bucket Crisis', date: '2026-03-25', takeaway: 'Always check bucket policies' }
        ]),
      });
    });
    await page.goto('/');
    await expect(page.locator('#section-journal')).toBeVisible();
    await expect(page.locator('#journal-content')).toContainText('S3 Bucket Crisis');
  });

  test('hides journal section when empty', async ({ page }) => {
    await page.route('**/api/journal-summary', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      });
    });
    await page.goto('/');
    await page.waitForTimeout(500);
    await expect(page.locator('#section-journal')).not.toBeVisible();
  });

  test('resume banner visible when in-progress session exists', async ({ page }) => {
    await page.route('**/api/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { sim_id: 'test-sim', status: 'in_progress', criteria_met: ['c1'], criteria_remaining: ['c2', 'c3'] }
        ]),
      });
    });
    await page.goto('/');
    await expect(page.locator('#resume-banner')).toBeVisible();
    await expect(page.locator('#resume-title')).toContainText('test-sim');
    await expect(page.locator('#resume-detail')).toContainText('1 of 3');
  });

  test('resume banner hidden when no sessions', async ({ page }) => {
    await page.route('**/api/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      });
    });
    await page.goto('/');
    await page.waitForTimeout(500);
    await expect(page.locator('#resume-banner')).not.toBeVisible();
  });
});
