'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = require(path.join(ROOT, 'playwright.config.js'));

test('config: e2e runs serially from tests/e2e', () => {
  assert.equal(config.testDir, './tests/e2e');
  assert.equal(config.workers, 1);
  assert.equal(config.fullyParallel, false);
  assert.ok(config.timeout >= 30000);
  assert.equal(config.use.headless, true);
});

test('config: package scripts wire the unit and e2e suites', () => {
  assert.match(pkg.scripts.test, /test:unit/);
  assert.match(pkg.scripts.test, /test:e2e/);
  assert.match(pkg.scripts['test:unit'], /tests\/unit\/\*\.test\.js/);
  assert.equal(pkg.scripts['test:e2e'], 'playwright test');
  assert.match(pkg.scripts['install:browsers'], /playwright install chromium/);
});

test('config: no browser download is required for unit tests', () => {
  const harness = fs.readFileSync(path.join(ROOT, 'tests', 'helpers', 'harness.js'), 'utf8');
  assert.match(harness, /playwright-core/);
  assert.match(harness, /DI_CHROME_PATH/);
  assert.match(harness, /CHROME_CANDIDATES/);
});
