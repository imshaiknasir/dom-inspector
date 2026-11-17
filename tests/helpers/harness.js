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

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

/**
 * Launch Chromium, preferring Playwright's bundled build but falling back to
 * DI_CHROME_PATH or a system Chrome when the browser download is unavailable.
 */
const launchBrowser = async (options = {}) => {
  const base = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...options
  };
  const candidates = [];
  if (base.executablePath) {
    candidates.push(base);
  } else {
    if (process.env.DI_CHROME_PATH) candidates.push({ ...base, executablePath: process.env.DI_CHROME_PATH });
    candidates.push(base);
    for (const executablePath of CHROME_CANDIDATES) candidates.push({ ...base, executablePath });
  }
  let failure;
  for (const candidate of candidates) {
    try {
      return await chromium.launch(candidate);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
};

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

module.exports = {
  ROOT,
  GENERATOR_SCRIPTS,
  fixtureUrl,
  launchBrowser,
  injectGenerators,
  openFixture
};
