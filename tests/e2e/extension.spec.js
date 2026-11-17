'use strict';

const { test, expect } = require('@playwright/test');
const { chromium } = require('playwright-core');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixture.html');

/** Chrome's unpacked-extension id: 128 bits of SHA-256 over the absolute path. */
const extensionIdForPath = (dir) => crypto
  .createHash('sha256')
  .update(dir)
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (hex) => String.fromCharCode(97 + parseInt(hex, 16)));

const collectErrors = (page, label, sink) => {
  page.on('pageerror', (error) => sink.push(`${label} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon/i.test(text)) return;
    sink.push(`${label} console: ${text}`);
  });
};

let context;
let server;
let baseURL;
let userDataDir;
let extensionId;
let extensionPage;
let fixturePage;
const errors = [];

const waitFor = async (fn, timeout = 5000, interval = 100) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return last;
};

const sendToFixture = (message) => extensionPage.evaluate(async ({ url, message }) => {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((candidate) => candidate.url && candidate.url.startsWith(url));
  if (!tab) return { error: 'fixture tab not found' };
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    return { error: error.message };
  }
}, { url: baseURL, message });

const startPicking = async () => {
  const start = await sendToFixture({ type: 'DI_START' });
  expect(start.ok).toBe(true);
};

const clickElement = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await fixturePage.mouse.move(x, y);
  await fixturePage.mouse.click(x, y);
};

test.beforeAll(async () => {
  const html = fs.readFileSync(FIXTURE);
  server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}/`;

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-inspector-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    timeout: 30000,
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  }
  extensionId = new URL(worker.url()).host;
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  extensionPage = await context.newPage();
  collectErrors(extensionPage, 'panel', errors);
  await extensionPage.goto(`chrome-extension://${extensionId}/src/panel/panel.html`);

  fixturePage = await context.newPage();
  collectErrors(fixturePage, 'fixture', errors);
  await fixturePage.goto(baseURL);
  await fixturePage.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  if (context) await context.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('extension loads without runtime errors', async () => {
  await expect(extensionPage).toHaveTitle('DOM Inspector');
  await expect(extensionPage.locator('h1')).toHaveText('DOM Inspector');
  await expect(extensionPage.locator('#di-pick')).toBeVisible();
  await extensionPage.waitForTimeout(300);

  const manifest = await extensionPage.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe('DOM Inspector');
  expect(JSON.stringify(manifest)).not.toContain('SelectorsHub');

  expect(errors).toEqual([]);
});

test('content script answers the picker bridge', async () => {
  const ping = await waitFor(async () => {
    const response = await sendToFixture({ type: 'DI_PING' });
    return response && response.ok ? response : null;
  }, 10000);
  expect(ping).toMatchObject({ ok: true, picking: false, url: baseURL });
});

test('picker generates verified CSS, XPath, Playwright and Selenium locators', async () => {
  await fixturePage.bringToFront();
  await startPicking();
  await clickElement(fixturePage.locator('#save'));

  const payload = await waitFor(() => extensionPage.evaluate(async () => {
    const stored = await chrome.storage.session.get('di:lastPick');
    return stored['di:lastPick'] || null;
  }), 10000);
  expect(payload).toBeTruthy();
  expect(payload.url).toBe(baseURL);
  expect(payload.element).toMatchObject({ tag: 'button', id: 'save' });

  expect(payload.css.best).toMatchObject({ selector: '#save', count: 1 });
  expect(payload.xpath.best).toMatchObject({ xpath: "//*[@id='save']", count: 1 });
  expect(payload.xpath.absolute).toMatch(/^\/html/);
  expect(payload.xpath.indexed).toMatchObject({ count: 1 });

  expect(payload.playwright.some((item) => item.selector.includes("getByTestId('save-btn')") && item.count === 1)).toBe(true);
  expect(payload.playwright.some((item) => item.selector.includes("getByRole('button'") && item.selector.includes('Save changes'))).toBe(true);
  expect(payload.selenium.some((item) => item.type === 'id' && item.value === 'save' && item.count === 1)).toBe(true);
  expect(payload.selenium.some((item) => item.type === 'cssSelector' && item.count === 1)).toBe(true);
  expect(payload.formats.some((item) => item.type === 'cypress-css' && item.code.includes("cy.get('#save')"))).toBe(true);

  const overlay = await waitFor(() => fixturePage.evaluate(() => {
    const node = document.getElementById('di-picker-overlay');
    return node && node.classList.contains('di-picked') ? true : null;
  }), 3000);
  expect(overlay).toBe(true);

  const validated = await sendToFixture({ type: 'DI_TEST', locatorType: 'css', value: payload.css.best.selector, highlight: true });
  expect(validated).toMatchObject({ ok: true, type: 'css', count: 1 });
});

test('picker reports shadow DOM and refuses shadow XPath', async () => {
  await startPicking();
  await clickElement(fixturePage.locator('#shadowbtn'));

  const payload = await waitFor(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    const value = stored['di:lastPick'];
    return value && value.element.id === 'shadowbtn' ? value : null;
  }, 10000);
  expect(payload).toBeTruthy();
  expect(payload.shadow.inShadow).toBe(true);
  expect(payload.shadow.hosts[0]).toMatchObject({ tag: 'div', id: 'host' });
  expect(payload.css.best).toMatchObject({ selector: '#shadowbtn', count: 1 });
  expect(payload.shadow.hostCss).toEqual(['#host']);
  expect(payload.xpath.best).toBe(null);
  expect(payload.xpath.absolute).toBe(null);
});

test('picker reports iframe depth and Playwright frameLocator', async () => {
  const frame = fixturePage.frames().find((candidate) => candidate !== fixturePage.mainFrame() && candidate.url() !== 'about:blank');
  expect(frame).toBeTruthy();
  const inner = frame.locator('#inner');
  await inner.waitFor();
  await startPicking();
  await clickElement(inner);

  const payload = await waitFor(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    const value = stored['di:lastPick'];
    return value && value.element.id === 'inner' ? value : null;
  }, 10000);
  expect(payload).toBeTruthy();
  expect(payload.frame.depth).toBe(1);
  expect(payload.frame.chain[0]).toMatchObject({ tag: 'iframe', id: 'frame' });
  expect(payload.playwright.some((item) => item.selector.includes('frameLocator(') && item.selector.includes("getByTestId('inner-btn')"))).toBe(true);

  const stop = await sendToFixture({ type: 'DI_STOP' });
  expect(stop.ok).toBe(true);
  const removed = await waitFor(() => fixturePage.evaluate(() => !document.getElementById('di-picker-overlay')), 3000);
  expect(removed).toBe(true);
});

test('no page errors accumulated during the run', async () => {
  expect(errors).toEqual([]);
});
