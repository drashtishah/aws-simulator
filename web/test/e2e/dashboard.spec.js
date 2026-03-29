const { test, expect } = require('@playwright/test');

test.describe('Dashboard', () => {
  test('shows rank title and completed count', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#stat-rank-title')).not.toHaveText('');
    const title = await page.locator('#stat-rank-title').textContent();
    expect(title.length).toBeGreaterThan(0);
  });

  test('shows hexagon SVG visualization', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hexagon-svg')).toBeVisible();
    // Should have grid rings, axis lines, and labels
    const polygons = page.locator('#hexagon-svg polygon');
    await expect(polygons.first()).toBeAttached();
    const labels = page.locator('#hexagon-svg text');
    const labelCount = await labels.count();
    expect(labelCount).toBe(6);
  });

  test('shows services encountered section', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#section-services')).toBeVisible();
  });

  test('shows services from progress API', async ({ page }) => {
    await page.route('**/api/progress', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rank: 'Config Whisperer',
          rankTitle: 'Config Whisperer',
          hexagon: { gather: 5, diagnose: 5, correlate: 0, impact: 0, trace: 0, fix: 0 },
          rawHexagon: { gather: 5, diagnose: 5 },
          simsCompleted: 3,
          servicesEncountered: ['Amazon EC2', 'AWS Lambda']
        }),
      });
    });
    await page.goto('/');
    await expect(page.locator('#stat-rank-title')).toHaveText('Config Whisperer');
    await expect(page.locator('#stat-completed')).toHaveText('3');
    await expect(page.locator('#services-list')).toContainText('Amazon EC2');
    await expect(page.locator('#services-list')).toContainText('AWS Lambda');
  });

  test('does not show old removed elements', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#section-skills')).not.toBeAttached();
    await expect(page.locator('#section-journal')).not.toBeAttached();
    await expect(page.locator('#resume-banner')).not.toBeAttached();
    await expect(page.locator('#stat-level')).not.toBeAttached();
  });
});
