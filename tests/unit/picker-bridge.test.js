'use strict';

/* Drives the content-script message bridge directly with a chrome stub. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, launchBrowser, injectGenerators, fixtureUrl } = require('../helpers/harness');

const PICKER = path.join(ROOT, 'src/content/picker.js');

let browser;
let page;
let child;

const installChromeStub = async (frame) => frame.evaluate(() => {
  window.__diListener = null;
  const stub = {
    runtime: {
      onMessage: {
        addListener(listener) { window.__diListener = listener; }
      },
      sendMessage() {}
    }
  };
  Object.defineProperty(window, 'chrome', { value: stub, configurable: true });
});

const send = (frame, message) => frame.evaluate((value) => {
  const listener = window.__diListener;
  if (!listener) return { error: 'no listener' };
  const response = { called: false, value: null };
  const returned = listener(value, {}, (payload) => {
    response.called = true;
    response.value = payload;
  });
  return { returned: returned === true, response };
}, message);

before(async () => {
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.goto(fixtureUrl());
  await injectGenerators(page);
  await installChromeStub(page);
  await page.addScriptTag({ path: PICKER });

  await page.waitForSelector('#frame');
  const handle = await page.$('#frame');
  child = await handle.contentFrame();
  await child.waitForSelector('#inner');
  await injectGenerators(child);
  await installChromeStub(child);
  await child.addScriptTag({ path: PICKER });
});

after(async () => { if (browser) await browser.close(); });

test('picker bridge: top frame answers ping, test and fix', async () => {
  const ping = await send(page, { type: 'DI_PING' });
  assert.equal(ping.returned, true);
  assert.equal(ping.response.value.ok, true);
  assert.equal(ping.response.value.picking, false);
  assert.match(ping.response.value.url, /fixture\.html$/);

  const tested = await send(page, { type: 'DI_TEST', locatorType: 'css', value: '#save' });
  assert.equal(tested.returned, true);
  assert.deepEqual(tested.response.value, { ok: true, type: 'css', count: 1, error: null });

  const fixed = await send(page, { type: 'DI_FIX', value: '#sav' });
  assert.equal(fixed.returned, true);
  assert.equal(fixed.response.value.ok, true);
  assert.equal(fixed.response.value.fixed, '#save');

  const batch = await send(page, { type: 'DI_FIX', values: ['#sav', '.nope-not-here'] });
  assert.equal(batch.response.value.ok, true);
  assert.equal(batch.response.value.results.length, 2);
  assert.equal(batch.response.value.results[1].ok, false);
});

test('picker bridge: unknown and clear messages behave', async () => {
  const unknown = await send(page, { type: 'DI_UNKNOWN' });
  assert.equal(unknown.returned, false);
  assert.equal(unknown.response.called, false);

  const cleared = await send(page, { type: 'DI_CLEAR' });
  assert.equal(cleared.returned, true);
  assert.deepEqual(cleared.response.value, { ok: true });
});

test('picker bridge: child frames stay silent unless allowFrames is set', async () => {
  const ignored = await send(child, { type: 'DI_TEST', locatorType: 'css', value: '#inner' });
  assert.notEqual(ignored.error, 'no listener');
  assert.equal(ignored.returned, false);
  assert.equal(ignored.response.called, false);

  const allowed = await send(child, { type: 'DI_TEST', locatorType: 'css', value: '#inner', allowFrames: true });
  assert.equal(allowed.returned, true);
  assert.equal(allowed.response.value.ok, true);
  assert.equal(allowed.response.value.count, 1);
});

test('picker bridge: start and stop toggle picking state', async () => {
  const started = await send(page, { type: 'DI_START' });
  assert.equal(started.returned, true);
  assert.equal(started.response.value.ok, true);
  assert.match(started.response.value.frame, /fixture\.html$/);

  const picking = await send(page, { type: 'DI_PING' });
  assert.equal(picking.response.value.picking, true);
  assert.equal(await page.evaluate(() => !!document.getElementById('di-picker-overlay')), true);

  const stopped = await send(page, { type: 'DI_STOP' });
  assert.equal(stopped.returned, true);
  assert.equal(stopped.response.value.ok, true);

  const idle = await send(page, { type: 'DI_PING' });
  assert.equal(idle.response.value.picking, false);
  assert.equal(await page.evaluate(() => !!document.getElementById('di-picker-overlay')), false);
});
