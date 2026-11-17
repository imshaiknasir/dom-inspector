'use strict';

const { defineConfig } = require('@playwright/test');

/**
 * Playwright runs the end-to-end extension suite in tests/e2e.
 * The spec launches its own persistent Chromium context because unpacked
 * MV3 extensions require --load-extension and a user data directory, which
 * the regular Playwright `page` fixture does not provide.
 *
 * Install the browser once with: npm run install:browsers
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    headless: true,
    channel: 'chromium',
    trace: 'retain-on-failure'
  }
});
