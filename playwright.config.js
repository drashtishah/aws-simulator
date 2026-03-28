const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './web/test/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3200',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  webServer: {
    command: 'node web/server.js',
    url: 'http://localhost:3200',
    reuseExistingServer: true,
    timeout: 10000,
  },
  reporter: 'list',
  outputDir: 'web/test/e2e/test-results',
});
