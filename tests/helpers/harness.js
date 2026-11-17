'use strict';

/* Shared Playwright-core harness for DOM generator unit tests.
   Each unit test file launches one Chromium, loads a fixture page from
   tests/, and injects the content-script generators in manifest order. */

const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');
const GENERATOR_SCRIPTS = [
  'src/content/util.js',
  'src/content/css.js',
  'src/content/xpath.js',
  'src/content/playwright.js',
  'src/content/formats.js',
  'src/content/validate.js',
  'src/content/repair.js'
].map((file) => path.join(ROOT, file));

const fixtureUrl = (name = 'fixture.html') => {
  const file = path.join(ROOT, 'tests', name);
  return 'file://' + file.split(path.sep).join('/');
};

const launchBrowser = (options = {}) => chromium.launch({
  headless: true,
  executablePath: process.env.DI_CHROME_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...options
});

const injectGenerators = async (frame) => {
  for (const script of GENERATOR_SCRIPTS) {
    await frame.addScriptTag({ path: script });
  }
};

/** Open a fixture and install the DI generators in the page's main world. */
const openFixture = async (browser, name) => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(fixtureUrl(name));
  await injectGenerators(page);
  page.diErrors = errors;
  return page;
};

/** Resolve a CSS selector against the element's own tree scope. */
const resolveCss = (page, selector, elementId) => page.evaluate(({ selector, elementId }) => {
  const el = elementId ? document.getElementById(elementId) : null;
  const root = el && el.getRootNode ? el.getRootNode() : document;
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch (_) {
    return [];
  }
}, { selector, elementId });

module.exports = {
  ROOT,
  GENERATOR_SCRIPTS,
  fixtureUrl,
  launchBrowser,
  injectGenerators,
  openFixture,
  resolveCss
};
