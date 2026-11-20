'use strict';

/* Browser lifecycle and page setup for the DOM Inspector MCP server.
 * The extension's content modules are injected verbatim into every frame, so
 * locator generation, validation, and repair run against the real page. */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..', '..');

const SOURCE_FILES = [
  'src/content/util.js',
  'src/content/css.js',
  'src/content/xpath.js',
  'src/content/playwright.js',
  'src/content/formats.js',
  'src/content/validate.js',
  'src/content/repair.js'
].map((file) => path.join(ROOT, file));

const PROBE_FILE = path.join(__dirname, 'probe.js');

const buildBundle = () => {
  const sources = [...SOURCE_FILES, PROBE_FILE].map((file) => fs.readFileSync(file, 'utf8'));
  // A single expression keeps the injection independent of inline-script CSP.
  return '(() => {\n' + sources.join('\n;\n') + '\n;return globalThis.DIMCP;\n})()';
};

const BUNDLE = buildBundle();

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

let browserPromise = null;

const launch = async () => {
  const base = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  };
  const candidates = [];
  if (process.env.DI_CHROME_PATH) candidates.push({ ...base, executablePath: process.env.DI_CHROME_PATH });
  candidates.push(base);
  for (const executablePath of CHROME_CANDIDATES) candidates.push({ ...base, executablePath });
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

const getBrowser = async () => {
  if (!browserPromise) {
    browserPromise = launch().then((browser) => {
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    }).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
};

const closeBrowser = async () => {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch (_) {
    /* the browser was never started or already closed */
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const frameAccess = new WeakMap();

/* A frame reached only through cross-origin ancestors cannot be addressed by
 * a top-level locator, so treat it as out of scope rather than return a
 * locator that would not resolve in a test runner. */
const frameIsAccessible = async (frame) => {
  const cached = frameAccess.get(frame);
  const url = frame.url();
  if (cached && cached.url === url) return cached.accessible;
  let accessible = false;
  try {
    accessible = await frame.evaluate(() => !!window.frameElement);
  } catch (_) {
    accessible = false;
  }
  frameAccess.set(frame, { url, accessible });
  return accessible;
};

const usableFrames = async (page) => {
  const main = page.mainFrame();
  const out = [main];
  for (const frame of page.frames()) {
    if (frame === main) continue;
    let node = frame;
    let accessible = true;
    while (node && node !== main) {
      if (!(await frameIsAccessible(node))) {
        accessible = false;
        break;
      }
      node = node.parentFrame();
    }
    if (accessible) out.push(frame);
  }
  return out;
};

const injectFrame = async (frame) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ready = await frame.evaluate(() => !!(globalThis.DI && DI.repair && globalThis.DIMCP));
      if (ready) return;
      await frame.evaluate(BUNDLE);
      return;
    } catch (error) {
      if (attempt === 1) throw new Error(`Could not inject locator modules into ${frame.url()}: ${error.message}`);
      await sleep(50);
    }
  }
};

/* Late or lazily created frames may miss the eager injection pass. Retry
 * once after injecting the shared modules into that frame. */
const evaluateFrame = async (frame, fn, arg) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await frame.evaluate(fn, arg);
    } catch (error) {
      if (attempt === 1) throw error;
      try { await injectFrame(frame); } catch (_) { /* still try the call once more */ }
      await sleep(50);
    }
  }
  return undefined;
};

const waitForStableFrames = async (page, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  let previous = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const count = page.frames().length;
    if (count === previous) stable += 1;
    else stable = 0;
    previous = count;
    if (stable >= 2) return;
    await sleep(50);
  }
};

const injectAllFrames = async (page) => {
  await waitForStableFrames(page);
  for (const frame of page.frames()) await injectFrame(frame);
};

const normalizeWaitUntil = (waitUntil) => {
  if (!waitUntil) return 'domcontentloaded';
  return ['load', 'domcontentloaded', 'networkidle', 'commit'].includes(waitUntil) ? waitUntil : 'domcontentloaded';
};

/**
 * Open one isolated page from a URL or raw HTML, inject the shared modules in
 * every frame, and pass the page to `fn`. The context is always closed.
 */
const withPage = async (input, fn) => {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: {
      width: input.viewport && input.viewport.width ? input.viewport.width : 1280,
      height: input.viewport && input.viewport.height ? input.viewport.height : 800
    }
  });
  const page = await context.newPage();
  const timeout = input.timeoutMs || 15000;
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  try {
    if (input.url) {
      await page.goto(input.url, { waitUntil: normalizeWaitUntil(input.waitUntil), timeout });
    } else {
      await page.setContent(input.html, { waitUntil: normalizeWaitUntil(input.waitUntil), timeout });
    }
    await injectAllFrames(page);
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
};

/**
 * Locate a target in the first frame that contains it and analyze the element
 * there, so frame-aware Playwright locators are generated in their own frame.
 */
const findTarget = async (page, target) => {
  const limit = Number.isInteger(target.maxCandidates) ? target.maxCandidates : 12;
  let lastError = null;
  for (const frame of await usableFrames(page)) {
    const isMain = frame === page.mainFrame();
    if (target.coordinates && !isMain) continue;
    let result;
    try {
      result = await evaluateFrame(frame, ({ target: raw, limit: max }) =>
        globalThis.DIMCP.analyzeTarget(raw, max), { target, limit });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (result && result.found) {
      return {
        frame,
        frameIndex: isMain ? 0 : page.frames().indexOf(frame),
        matchCount: result.matchCount,
        selectedIndex: result.selectedIndex,
        type: result.type,
        analysis: result.analysis
      };
    }
    if (result && result.error) lastError = new Error(result.error);
  }
  const error = new Error(
    target.coordinates
      ? `No element found at (${target.coordinates.x}, ${target.coordinates.y})`
      : 'No element matched the target'
  );
  if (lastError) error.cause = lastError;
  throw error;
};

const verifyInPage = async (page, type, locator, maxMatches) => {
  for (const frame of await usableFrames(page)) {
    let result;
    try {
      result = await evaluateFrame(frame, ({ type: rawType, locator: rawLocator, maxMatches: max }) =>
        globalThis.DIMCP.verify(rawType, rawLocator, max), { type, locator, maxMatches });
    } catch (_) {
      continue;
    }
    if (result && (result.count > 0 || result.error)) {
      return { ...result, frame: frame === page.mainFrame() ? null : frame.url() };
    }
  }
  return {
    ok: false,
    type: 'auto',
    count: 0,
    unique: false,
    error: 'No elements matched',
    matches: [],
    frame: null
  };
};

const healInPage = async (page, locator, type, index, prefer) => {
  let last = null;
  for (const frame of await usableFrames(page)) {
    let result;
    try {
      result = await evaluateFrame(frame, ({ locator: rawLocator, type: rawType, index: at, prefer: chosen }) =>
        globalThis.DIMCP.heal(rawLocator, rawType, at, chosen), { locator, type, index, prefer });
    } catch (error) {
      last = { ok: false, status: 'error', error: error.message };
      continue;
    }
    if (result && (result.status !== 'not-found' || result.repair)) {
      return { ...result, frame: frame === page.mainFrame() ? null : frame.url() };
    }
    last = result;
  }
  return last || { ok: false, status: 'not-found', error: 'No matching element found' };
};

const listInPage = async (page, selector, limit, includeHidden) => {
  const elements = [];
  let total = 0;
  let framesScanned = 0;
  const errors = [];
  for (const frame of await usableFrames(page)) {
    const remaining = limit - elements.length;
    let result;
    try {
      result = await evaluateFrame(frame, ({ selector: rawSelector, limit: max, includeHidden: hidden }) =>
        globalThis.DIMCP.list(rawSelector, Math.max(1, max), hidden),
      { selector, limit: remaining > 0 ? remaining : 1, includeHidden });
    } catch (_) {
      continue;
    }
    framesScanned += 1;
    if (result.error) errors.push(result.error);
    total += result.count;
    if (remaining <= 0) continue;
    for (const element of result.elements.slice(0, remaining)) {
      elements.push({
        ...element,
        index: elements.length + 1,
        frame: frame === page.mainFrame() ? null : frame.url()
      });
    }
  }
  return { total, elements, framesScanned, selector, errors };
};

module.exports = {
  ROOT,
  SOURCE_FILES,
  BUNDLE,
  getBrowser,
  closeBrowser,
  withPage,
  findTarget,
  verifyInPage,
  healInPage,
  listInPage
};
