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

const sendToFixture = (message, options) => extensionPage.evaluate(async ({ url, message, options }) => {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((candidate) => candidate.url && candidate.url.startsWith(url));
  if (!tab) return { error: 'fixture tab not found' };
  try {
    return await chrome.tabs.sendMessage(tab.id, message, options);
  } catch (error) {
    return { error: error.message };
  }
}, { url: baseURL, message, options });

const startPicking = async () => {
  await fixturePage.bringToFront();
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

test('toolbar popup renders the last picked locators', async () => {
  const popup = await context.newPage();
  collectErrors(popup, 'popup', errors);
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await expect(popup).toHaveTitle('DOM Inspector');
  await expect(popup.locator('#pop-pick')).toBeVisible();
  await expect(popup.locator('#pop-open')).toBeVisible();

  const payload = {
    url: 'https://example.test/',
    element: { tag: 'button', id: 'save', role: 'button', accessibleName: 'Save changes' },
    css: { best: { selector: '#save', count: 1, strategy: 'id' } },
    xpath: { best: { xpath: "//*[@id='save']", count: 1, strategy: 'id' }, absolute: '/html/body[1]/button[1]' },
    playwright: [{ selector: "page.getByTestId('save-btn')", count: 1, type: 'getByTestId' }]
  };
  await popup.evaluate((value) => chrome.storage.session.set({ 'di:lastPick': value }), payload);
  await popup.reload();

  await expect(popup.locator('#pop-last-card')).toBeVisible();
  await expect(popup.locator('#pop-status')).toContainText('Last pick: button#save');
  await expect(popup.locator('#pop-last-element')).toContainText('#save');
  await expect(popup.locator('#pop-last-element')).toContainText('Save changes');
  const rows = await popup.locator('#pop-last-rows').innerText();
  expect(rows).toContain('#save');
  expect(rows).toContain("//*[@id='save']");
  expect(rows).toContain("getByTestId('save-btn')");
  expect(rows).toContain('/html/body[1]/button[1]');
  expect(await popup.locator('#pop-last-rows .loc-row').count()).toBe(4);

  const saved = [
    { name: 'Main save', type: 'css', value: '#save', label: 'CSS', count: 1, savedAt: 2 },
    { name: 'Login', type: 'xpath', value: "//input", label: 'XPath', count: 3, savedAt: 1 }
  ];
  await popup.evaluate((entries) => chrome.storage.local.set({ 'di:panel:saved': entries }), saved);
  await popup.locator('#pop-refresh').click();
  await expect(popup.locator('#pop-saved-card')).toBeVisible();
  await expect(popup.locator('#pop-saved-meta')).toHaveText('2');
  expect(await popup.locator('#pop-saved-rows .loc-row').count()).toBe(2);
  await expect(popup.locator('#pop-saved-rows')).toContainText('#save');
  await expect(popup.locator('#pop-saved-rows')).toContainText('//input');

  const history = [
    { at: 20, url: 'https://old.example/', css: '#old-save', cssCount: 1, element: { tag: 'button', id: 'old-save' } },
    { at: 10, url: 'https://older.example/', xpath: '//div[@id="old"]', xpathCount: 2, element: { tag: 'div', id: 'old' } }
  ];
  await popup.evaluate((entries) => chrome.storage.local.set({ 'di:panel:history': entries }), history);
  await popup.locator('#pop-refresh').click();
  await expect(popup.locator('#pop-history-card')).toBeVisible();
  await expect(popup.locator('#pop-history-meta')).toHaveText('2');
  expect(await popup.locator('#pop-history-rows .loc-row').count()).toBe(2);
  await expect(popup.locator('#pop-history-rows')).toContainText('#old-save');
  await expect(popup.locator('#pop-history-rows')).toContainText('//div[@id="old"]');
  await popup.locator('#pop-history-clear').click();
  await expect.poll(() => popup.evaluate(() =>
    document.getElementById('pop-history-card').hidden
  ), { timeout: 5000 }).toBe(true);
  expect(await popup.locator('#pop-history-rows .loc-row').count()).toBe(0);
  await expect(popup.locator('#pop-status')).toContainText('Pick history cleared');
  expect(await popup.evaluate(() => chrome.storage.local.get('di:panel:history'))).toEqual({});

  const linkPayload = {
    url: 'https://example.test/docs',
    element: { tag: 'a', id: 'link' },
    css: { best: { selector: '#link', count: 1, strategy: 'id' } },
    xpath: { best: { xpath: "//*[@id='link']", count: 1, strategy: 'id' } },
    playwright: [{ selector: "page.getByText('Read the docs')", count: 1, type: 'getByText' }]
  };
  await popup.evaluate((value) => chrome.storage.session.set({ 'di:lastPick': value }), linkPayload);
  await popup.keyboard.press('r');
  await expect(popup.locator('#pop-status')).toContainText('Last pick: a#link');
  await expect(popup.locator('#pop-last-rows')).toContainText('#link');

  await popup.evaluate(async () => {
    await chrome.storage.session.remove('di:lastPick');
    await chrome.storage.local.remove('di:panel:saved');
  });
  await popup.reload();
  await expect(popup.locator('#pop-empty')).toBeVisible();
  await expect(popup.locator('#pop-status')).toContainText('Pick an element');
  await popup.locator('body').press('c');
  await expect(popup.locator('#pop-status')).toContainText('No locators to copy');
  await popup.close();
});

test('content script answers the picker bridge', async () => {
  const ping = await waitFor(async () => {
    const response = await sendToFixture({ type: 'DI_PING' }, { frameId: 0 });
    return response && response.ok ? response : null;
  }, 10000);
  expect(ping).toMatchObject({ ok: true, picking: false, url: baseURL });
});

test('copy bridge fails cleanly before any context element is seen', async () => {
  const response = await sendToFixture({ type: 'DI_COPY_BEST' }, { frameId: 0 });
  expect(response).toMatchObject({ ok: false, error: 'No context element recorded' });
});

test('right-click copy bridge returns the best selector for the context element', async () => {
  await fixturePage.locator('#link').dispatchEvent('contextmenu', { bubbles: true, composed: true, button: 2 });
  const copied = await sendToFixture({ type: 'DI_COPY_BEST' }, { frameId: 0 });
  expect(copied).toMatchObject({ ok: true, value: '#link' });

  await fixturePage.locator('.rowbtn').first().dispatchEvent('contextmenu', { bubbles: true, composed: true, button: 2 });
  const duplicate = await sendToFixture({ type: 'DI_COPY_BEST' }, { frameId: 0 });
  expect(duplicate.ok).toBe(true);
  expect(duplicate.value).not.toBe('.rowbtn');
  const resolved = await sendToFixture({ type: 'DI_TEST', locatorType: 'auto', value: duplicate.value }, { frameId: 0 });
  expect(resolved).toMatchObject({ ok: true, count: 1 });

  await fixturePage.locator('#shadowbtn').dispatchEvent('contextmenu', { bubbles: true, composed: true, button: 2 });
  const shadowCopy = await sendToFixture({ type: 'DI_COPY_BEST' }, { frameId: 0 });
  expect(shadowCopy.ok).toBe(true);
  expect(shadowCopy.value).toMatch(/getBy(TestId|Role|Text)/);
  expect(shadowCopy.value).not.toBe('#shadowbtn');
  const shadowResolved = await sendToFixture({ type: 'DI_TEST', locatorType: 'auto', value: shadowCopy.value }, { frameId: 0 });
  expect(shadowResolved).toMatchObject({ ok: true, count: 1 });
});

test('repair bridge fixes single, batch and in-frame selectors', async () => {
  const single = await sendToFixture({ type: 'DI_FIX', value: '#sav' }, { frameId: 0 });
  expect(single).toMatchObject({ ok: true, fixed: '#save', count: 1, type: 'css' });
  expect(single.element).toMatchObject({ tag: 'button', id: 'save' });
  expect(single.locators.css).toBe('#save');

  const batch = await sendToFixture({ type: 'DI_FIX', values: ['#sav', '.does-not-exist-anywhere'] }, { frameId: 0 });
  expect(batch.ok).toBe(true);
  expect(batch.results.length).toBe(2);
  expect(batch.results[0]).toMatchObject({ ok: true, fixed: '#save' });
  expect(batch.results[1].ok).toBe(false);

  const frame = await sendToFixture({ type: 'DI_FIX', value: '#inne' }, { frameId: 0 });
  expect(frame).toMatchObject({ ok: true, repaired: true });
  expect(frame.element).toMatchObject({ tag: 'button', id: 'inner' });
  expect(frame.fixed).toBe('#inner');
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
  expect(payload.formats.some((item) => item.type === 'testRigor' && item.code === '"Save changes"')).toBe(true);

  const overlay = await waitFor(() => fixturePage.evaluate(() => {
    const node = document.getElementById('di-picker-overlay');
    return node && node.classList.contains('di-picked') ? true : null;
  }), 3000);
  expect(overlay).toBe(true);

  const validated = await sendToFixture({ type: 'DI_TEST', locatorType: 'css', value: payload.css.best.selector, highlight: true }, { frameId: 0 });
  expect(validated).toMatchObject({ ok: true, type: 'css', count: 1 });

  const restored = await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'DI_GET_LAST' }));
  expect(restored).toMatchObject({ ok: true });
  expect(restored.payload.css.best.selector).toBe(payload.css.best.selector);

  await expect(extensionPage.locator('#di-css code').first()).toContainText('#save');
  await expect(extensionPage.locator('#di-xpath code').first()).toContainText("//*[@id='save']");
});

test('panel filters rows and exports picked locators as JSON', async () => {
  await fixturePage.bringToFront();
  await startPicking();
  await clickElement(fixturePage.locator('#save'));
  await waitFor(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    return stored['di:lastPick'] && stored['di:lastPick'].element.id === 'save';
  }, 10000);
  await expect(extensionPage.locator('#di-css code').first()).toContainText('#save');
  await extensionPage.evaluate(() => {
    const filter = document.getElementById('di-filter');
    filter.value = '#save';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(extensionPage.locator('#di-css code').first()).toContainText('#save');
  await extensionPage.evaluate(() => {
    const filter = document.getElementById('di-filter');
    filter.value = '';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const downloadPromise = extensionPage.waitForEvent('download');
  await extensionPage.evaluate(() => document.getElementById('di-export').click());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dom-inspector-.*\.json$/);
  const report = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(report.extension).toBe('DOM Inspector');
  expect(report.element).toMatchObject({ tag: 'button', id: 'save' });
  expect(report.locators.some((row) => row.value === '#save')).toBe(true);
  expect(report.locators.some((row) => row.type === 'xpath' && row.value === "//*[@id='save']")).toBe(true);
});

test('panel filters locators by strategy', async () => {
  await fixturePage.bringToFront();
  await startPicking();
  await clickElement(fixturePage.locator('#save'));
  await waitFor(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    return stored['di:lastPick'] && stored['di:lastPick'].element.id === 'save';
  }, 10000);
  await expect(extensionPage.locator('#di-css code').first()).toContainText('#save');

  await extensionPage.evaluate(() => {
    const select = document.getElementById('di-strategy');
    select.value = 'id';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(extensionPage.locator('#di-css code').first()).toContainText('#save');
  await expect(extensionPage.locator('#di-css')).not.toContainText('data-testid');

  await extensionPage.evaluate(() => {
    const select = document.getElementById('di-strategy');
    select.value = 'text';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.querySelectorAll('#di-css code').length
  ), { timeout: 5000 }).toBe(0);

  await extensionPage.evaluate(() => {
    const select = document.getElementById('di-strategy');
    select.value = 'all';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.querySelectorAll('#di-css code').length
  ), { timeout: 5000 }).toBeGreaterThan(0);
});

test('panel live tester badges valid and invalid locators as you type', async () => {
  await fixturePage.bringToFront();

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '#save';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => extensionPage.evaluate(() => {
    const badge = document.getElementById('di-live-badge');
    return badge.hidden ? '' : badge.textContent;
  }), { timeout: 8000 }).toContain('css');

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '#does-not-exist';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => extensionPage.evaluate(() => {
    const badge = document.getElementById('di-live-badge');
    return badge.hidden ? '' : badge.textContent;
  }), { timeout: 8000 }).toBe('invalid');

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-live-badge').hidden
  ), { timeout: 5000 }).toBe(true);
});

test('panel driver template substitutes the picked CSS and XPath values', async () => {
  await fixturePage.bringToFront();
  await startPicking();
  await clickElement(fixturePage.locator('#save'));
  await waitFor(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    return stored['di:lastPick'] && stored['di:lastPick'].element.id === 'save';
  }, 10000);

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-driver-template');
    input.value = 'driver.findElement(By.cssSelector("{selector}"))';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(extensionPage.locator('#di-driver-output')).toContainText('#save');
  await expect(extensionPage.locator('#di-driver-output')).toContainText('cssSelector');

  await extensionPage.evaluate(() => {
    const base = document.getElementById('di-driver-base');
    base.value = 'xpath';
    base.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(extensionPage.locator('#di-driver-output')).toContainText("//*[@id='save']");
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

test('continuous picking survives multiple picks and Escape cancels it', async () => {
  await startPicking();
  const continuous = await sendToFixture({ type: 'DI_START', continuous: true });
  expect(continuous.ok).toBe(true);

  await clickElement(fixturePage.locator('#save'));
  await expect.poll(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    return stored['di:lastPick'] && stored['di:lastPick'].element.id;
  }, { timeout: 5000 }).toBe('save');

  await clickElement(fixturePage.locator('#shadowbtn'));
  await expect.poll(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    return stored['di:lastPick'] && stored['di:lastPick'].element.id;
  }, { timeout: 5000 }).toBe('shadowbtn');

  await fixturePage.keyboard.press('Escape');
  await expect.poll(() => fixturePage.evaluate(() => !document.getElementById('di-picker-overlay')), { timeout: 5000 }).toBe(true);
});

test('reference mode adds axes locators to the next pick', async () => {
  await fixturePage.bringToFront();
  const referenceStart = await sendToFixture({ type: 'DI_START', mode: 'reference' });
  expect(referenceStart.ok).toBe(true);
  await clickElement(fixturePage.locator('label[for="email"]'));
  await fixturePage.waitForTimeout(150);

  await startPicking();
  await clickElement(fixturePage.locator('#email'));

  const payload = await waitFor(async () => {
    const stored = await extensionPage.evaluate(() => chrome.storage.session.get('di:lastPick'));
    const value = stored['di:lastPick'];
    return value && value.element.id === 'email' ? value : null;
  }, 10000);
  expect(payload).toBeTruthy();
  expect(payload.reference).toMatchObject({ tag: 'label', text: 'Email address' });
  expect(payload.axes.length).toBeGreaterThan(0);
  expect(payload.axes.some((axis) => axis.strategy === 'following-sibling' && axis.count > 0)).toBe(true);
  await sendToFixture({ type: 'DI_STOP' });
});

test('panel tester validates, highlights and clears a locator', async () => {
  await fixturePage.bringToFront();
  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '#save';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const type = document.getElementById('di-type');
    type.value = 'css';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('di-test').click();
  });

  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-result').textContent
  ), { timeout: 5000 }).toMatch(/valid/i);
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-result').textContent
  ), { timeout: 5000 }).toContain('1 match');

  expect(await fixturePage.evaluate(() => document.getElementById('save').style.outline)).toContain('2px solid');

  await extensionPage.evaluate(() => document.getElementById('di-clear').click());
  await expect.poll(() => fixturePage.evaluate(() =>
    document.getElementById('save').style.outline
  ), { timeout: 5000 }).toBe('');

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '#does-not-exist';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('di-test').click();
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-result').textContent
  ), { timeout: 5000 }).toMatch(/invalid|no elements/i);
});

test('panel tester Fix repairs, accepts valid and reports unfixable locators', async () => {
  await fixturePage.bringToFront();

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '#sav';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('di-fix').click();
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-input').value
  ), { timeout: 5000 }).toBe('#save');
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-result').textContent
  ), { timeout: 5000 }).toContain('1 match');

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '#save';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('di-fix').click();
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-input').value
  ), { timeout: 5000 }).toBe('#save');
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-result').textContent
  ), { timeout: 5000 }).toMatch(/valid/i);

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-input');
    input.value = '.definitely-not-here';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('di-fix').click();
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.getElementById('di-result').textContent
  ), { timeout: 5000 }).toMatch(/could not fix/i);
});

test('panel exports saved locators as a Playwright POM snippet', async () => {
  const saved = [
    {
      id: 'pom-1', key: 'pw::save', name: 'Save button', type: 'playwright',
      value: "page.getByTestId('save-btn')", testType: 'playwright', testValue: "page.getByTestId('save-btn')", count: 1
    },
    {
      id: 'pom-2', key: 'css::save-link', name: 'Save CSS', type: 'css',
      value: '#link', testType: 'css', testValue: '#link', count: 1
    },
    {
      id: 'pom-3', key: 'pw::dup', name: 'Save button', type: 'playwright',
      value: "page.getByRole('button')", testType: 'playwright', testValue: "page.getByRole('button')", count: 2
    },
    {
      id: 'pom-4', key: 'pw::reserved', name: 'constructor', type: 'playwright',
      value: "page.getByText('Hi')", testType: 'playwright', testValue: "page.getByText('Hi')", count: 1
    }
  ];
  await extensionPage.evaluate((entries) => chrome.storage.local.set({ 'di:panel:saved': entries }), saved);
  await extensionPage.reload();
  await expect.poll(() => extensionPage.evaluate(() =>
    document.querySelectorAll('#di-saved .saved-row').length
  ), { timeout: 10000 }).toBe(4);

  const downloadPromise = extensionPage.waitForEvent('download');
  await extensionPage.evaluate(() => document.getElementById('di-saved-pom').click());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dom-inspector-page-locators-.*\.js$/);
  const source = fs.readFileSync(await download.path(), 'utf8');
  expect(source).toContain('export class PageLocators');
  expect(source).toContain('this.page = page;');
  expect(source).toContain('saveButton()');
  expect(source).toContain("this.page.getByTestId('save-btn')");
  expect(source).toContain('saveButton2()');
  expect(source).toContain('saveCSS()');
  expect(source).toContain('this.page.locator("#link")');
  expect(source).toContain('locatorConstructor()');
  expect(source).not.toMatch(/\bconstructor\(\) \{/);
});

test('panel imports saved locators from JSON and skips duplicates', async () => {
  await extensionPage.evaluate(() => chrome.storage.local.remove('di:panel:saved'));
  await extensionPage.reload();
  await expect.poll(() => extensionPage.evaluate(() =>
    document.querySelectorAll('#di-saved .saved-row').length
  ), { timeout: 10000 }).toBe(0);

  const payload = {
    saved: [
      {
        key: 'css::#save', type: 'css', value: '#save', name: 'Imported save', scope: 'CSS',
        testType: 'css', testValue: '#save', count: 1
      }
    ]
  };
  await extensionPage.locator('#di-saved-import-file').setInputFiles({
    name: 'saved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload))
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    document.querySelectorAll('#di-saved .saved-row').length
  ), { timeout: 10000 }).toBe(1);
  await expect(extensionPage.locator('#di-toast')).toContainText('Imported 1 saved locator');
  const stored = await extensionPage.evaluate(async () => {
    const data = await chrome.storage.local.get('di:panel:saved');
    return data['di:panel:saved'];
  });
  expect(stored.length).toBe(1);
  expect(stored[0]).toMatchObject({ key: 'css::#save', type: 'css', value: '#save' });

  await extensionPage.locator('#di-saved-import-file').setInputFiles({
    name: 'saved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload))
  });
  await expect(extensionPage.locator('#di-toast')).toContainText('No new saved locators to import');
  expect(await extensionPage.evaluate(() =>
    document.querySelectorAll('#di-saved .saved-row').length
  )).toBe(1);
});

test('panel batch healing flags a broken selector and verifies its fix', async () => {
  await fixturePage.goto(baseURL);
  await fixturePage.waitForLoadState('domcontentloaded');
  await fixturePage.bringToFront();
  const ready = await waitFor(async () => {
    const response = await sendToFixture({ type: 'DI_PING' }, { frameId: 0 });
    return response && response.ok ? response : null;
  }, 10000);
  expect(ready).toBeTruthy();
  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-heal-input');
    input.value = '#sav\n#save';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('di-heal-check').click();
  });

  await expect.poll(() => extensionPage.evaluate(() => {
    const rows = [...document.querySelectorAll('#di-heal-results .heal-row')];
    return rows.length === 2 && rows.every((row) => !/status-(pending|checking)/.test(row.className));
  }), { timeout: 15000 }).toBe(true);

  const checked = await extensionPage.evaluate(() => [...document.querySelectorAll('#di-heal-results .heal-row')].map((row) => ({
    className: row.className,
    text: row.textContent
  })));
  expect(checked.some((row) => row.className.includes('status-broken'))).toBe(true);
  expect(checked.some((row) => row.className.includes('status-ok'))).toBe(true);

  await extensionPage.evaluate(() => document.getElementById('di-heal-fix').click());
  await expect.poll(() => extensionPage.evaluate(() =>
    [...document.querySelectorAll('#di-heal-results .heal-row')].every((row) => !/status-(pending|checking)/.test(row.className))
  ), { timeout: 15000 }).toBe(true);

  const healed = await extensionPage.evaluate(() => ({
    fixed: [...document.querySelectorAll('#di-heal-results .heal-row.status-fixed')].length,
    fixes: [...document.querySelectorAll('#di-heal-results .heal-fix code')].map((node) => node.textContent),
    meta: document.getElementById('di-heal-meta').textContent
  }));
  expect(healed.fixed).toBe(1);
  expect(healed.fixes).toContain('#save');
  expect(healed.meta).toContain('fixed');
});

test('panel healing exports a JSON report and clears the rows', async () => {
  const downloadPromise = extensionPage.waitForEvent('download');
  await extensionPage.evaluate(() => document.getElementById('di-heal-json').click());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dom-inspector-healing-.*\.json$/);
  const file = await download.path();
  expect(file).toBeTruthy();
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(report.extension).toBe('DOM Inspector');
  expect(Array.isArray(report.results)).toBe(true);
  expect(report.results.length).toBe(2);
  expect(report.results.some((row) => row.fixed === '#save' && row.status === 'fixed')).toBe(true);

  await extensionPage.evaluate(() => document.getElementById('di-heal-clear').click());
  await expect.poll(() => extensionPage.evaluate(() =>
    document.querySelectorAll('#di-heal-results .heal-row').length
  ), { timeout: 5000 }).toBe(0);
  await expect(extensionPage.locator('#di-heal-empty')).toBeVisible();
});

test('panel sanitizes corrupted persisted settings on reload', async () => {
  await extensionPage.evaluate(() => chrome.storage.local.set({
    'di:panel:settings': {
      lang: 'ruby', await: 'yes', unique: 1, continuous: 0,
      driverBase: 'nonsense', driver: 42, healText: {}, collapsed: 'no',
      strategy: 'bogus'
    }
  }));
  await extensionPage.reload();

  await expect.poll(() => extensionPage.evaluate(() => ({
    lang: document.getElementById('di-lang').value,
    await: document.getElementById('di-await').checked,
    unique: document.getElementById('di-unique').checked,
    continuous: document.getElementById('di-continuous').checked,
    driverBase: document.getElementById('di-driver-base').value,
    driver: document.getElementById('di-driver-template').value,
    strategy: document.getElementById('di-strategy').value
  })), { timeout: 10000 }).toEqual({
    lang: 'js', await: true, unique: true, continuous: false,
    driverBase: 'css', driver: '', strategy: 'all'
  });
});

test('panel healing replaces a non-unique selector with a verified unique fix', async () => {
  await fixturePage.goto(baseURL);
  await fixturePage.waitForLoadState('domcontentloaded');
  await fixturePage.bringToFront();
  const ready = await waitFor(async () => {
    const response = await sendToFixture({ type: 'DI_PING' }, { frameId: 0 });
    return response && response.ok ? response : null;
  }, 10000);
  expect(ready).toBeTruthy();

  await extensionPage.evaluate(() => {
    const input = document.getElementById('di-heal-input');
    input.value = '.rowbtn\n#definitely-missing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('di-heal-check').click();
  });
  await expect.poll(() => extensionPage.evaluate(() =>
    [...document.querySelectorAll('#di-heal-results .heal-row')].every((row) => !/status-(pending|checking)/.test(row.className))
  ), { timeout: 15000 }).toBe(true);
  const checked = await extensionPage.evaluate(() =>
    [...document.querySelectorAll('#di-heal-results .heal-row')].map((row) => row.className)
  );
  expect(checked.some((value) => value.includes('status-many'))).toBe(true);
  expect(checked.some((value) => value.includes('status-broken'))).toBe(true);

  await extensionPage.evaluate(() => document.getElementById('di-heal-fix').click());
  await expect.poll(() => extensionPage.evaluate(() =>
    [...document.querySelectorAll('#di-heal-results .heal-row')].every((row) => !/status-(pending|checking)/.test(row.className))
  ), { timeout: 15000 }).toBe(true);

  const result = await extensionPage.evaluate(() => {
    const fixedRow = document.querySelector('#di-heal-results .heal-row.status-fixed');
    return {
      fixedRows: document.querySelectorAll('#di-heal-results .heal-row.status-fixed').length,
      original: fixedRow ? fixedRow.querySelector('.heal-selector').textContent : null,
      fix: fixedRow && fixedRow.querySelector('.heal-fix code') ? fixedRow.querySelector('.heal-fix code').textContent : null,
      failedRows: document.querySelectorAll('#di-heal-results .heal-row.status-fix-failed').length
    };
  });
  expect(result.fixedRows).toBe(1);
  expect(result.original).toBe('.rowbtn');
  expect(result.fix).toBeTruthy();
  expect(result.fix).not.toBe('.rowbtn');
  expect(result.failedRows).toBe(1);

  const verified = await sendToFixture({ type: 'DI_TEST', locatorType: 'auto', value: result.fix }, { frameId: 0 });
  expect(verified).toMatchObject({ ok: true, count: 1 });
});

test('no page errors accumulated during the run', async () => {
  expect(errors).toEqual([]);
});
