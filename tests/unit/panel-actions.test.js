'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, launchBrowser, openFixture } = require('../helpers/harness');

let browser;
let page;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
  await page.addScriptTag({ path: path.join(ROOT, 'src/panel/panel-actions.js') });
});

after(async () => { if (browser) await browser.close(); });

test('panel actions: resolves CSS without performing by default', async () => {
  const out = await page.evaluate(() => DIPanel.pageAction('click', 'css', '#save', '', false));
  assert.equal(out.matched, 1);
  assert.equal(out.tag, 'button');
  assert.equal(out.typable, false);
  assert.equal(out.performed, false);
  assert.equal(out.error, null);
});

test('panel actions: click performs on the resolved element', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('save');
    let clicks = 0;
    el.addEventListener('click', () => { clicks += 1; });
    const result = DIPanel.pageAction('click', 'css', '#save', '', true);
    return { result, clicks };
  });
  assert.equal(out.result.matched, 1);
  assert.equal(out.result.performed, true);
  assert.equal(out.clicks, 1);
});

test('panel actions: hover dispatches mouse events', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('link');
    let hovers = 0;
    el.addEventListener('mouseover', () => { hovers += 1; });
    const result = DIPanel.pageAction('hover', 'css', '#link', '', true);
    return { result, hovers };
  });
  assert.equal(out.result.performed, true);
  assert.equal(out.hovers, 1);
});

test('panel actions: type fills text fields and rejects buttons', async () => {
  const out = await page.evaluate(() => {
    const input = document.getElementById('email');
    input.value = '';
    const typed = DIPanel.pageAction('type', 'css', '#email', 'hello@example.com', true);
    const button = DIPanel.pageAction('type', 'css', '#save', 'nope', true);
    return { typed, value: input.value, button };
  });
  assert.equal(out.typed.typable, true);
  assert.equal(out.typed.performed, true);
  assert.equal(out.value, 'hello@example.com');
  assert.equal(out.button.performed, false);
  assert.match(out.button.error, /not a text field/i);
});

test('panel actions: Playwright, XPath, shadow and iframe locators resolve', async () => {
  const out = await page.evaluate(() => ({
    playwright: DIPanel.pageAction('click', 'playwright', "page.getByTestId('save-btn')", '', false),
    xpath: DIPanel.pageAction('click', 'xpath', "//button[@id='save']", '', false),
    shadow: DIPanel.pageAction('click', 'css', '#shadowbtn', '', false),
    iframe: DIPanel.pageAction('click', 'css', '#inner', '', false),
    auto: DIPanel.pageAction('click', 'auto', '//button[@id="save"]', '', false)
  }));
  assert.equal(out.playwright.matched, 1);
  assert.equal(out.xpath.matched, 1);
  assert.equal(out.shadow.matched, 1);
  assert.equal(out.shadow.tag, 'button');
  assert.equal(out.iframe.matched, 1);
  assert.equal(out.iframe.tag, 'button');
  assert.equal(out.auto.matched, 1);
});

test('panel actions: invalid selectors report an error', async () => {
  const out = await page.evaluate(() => DIPanel.pageAction('click', 'css', 'div[', '', false));
  assert.equal(out.matched, 0);
  assert.ok(out.error);
  assert.equal(out.performed, false);
});

test('panel actions: auto mode recognises a bare locator() expression', async () => {
  const out = await page.evaluate(() => DIPanel.pageAction('click', 'auto', "locator('#save')", '', false));
  assert.equal(out.matched, 1);
  assert.equal(out.tag, 'button');
  assert.equal(out.error, null);
});

test('panel actions: chained shadow locator targets the inner element', async () => {
  const out = await page.evaluate(() =>
    DIPanel.pageAction('click', 'playwright', "page.locator('#host').locator('#shadowbtn')", '', false)
  );
  assert.equal(out.matched, 1);
  assert.equal(out.tag, 'button');
  assert.equal(out.text, 'Shadow action');
});

test('panel actions: first/last/filter modifiers narrow the match set', async () => {
  const out = await page.evaluate(() => ({
    first: DIPanel.pageAction('click', 'playwright', "page.locator('.rowbtn').first()", '', false),
    last: DIPanel.pageAction('click', 'playwright', "page.locator('.rowbtn').last()", '', false),
    filtered: DIPanel.pageAction('click', 'playwright', "page.locator('.rowbtn').filter({ hasText: 'No such text' })", '', false)
  }));
  assert.equal(out.first.matched, 1);
  assert.equal(out.last.matched, 1);
  assert.equal(out.filtered.matched, 0);
});
