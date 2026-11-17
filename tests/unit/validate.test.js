'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture } = require('../helpers/harness');

let browser;
let page;
let aria;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
  aria = await openFixture(browser, 'fixtures/aria.html');
});

after(async () => { if (browser) await browser.close(); });

test('validate: detects CSS, XPath and Playwright inputs', async () => {
  const out = await page.evaluate(() => ({
    css: DI.validate.detectType('#save'),
    xpath: DI.validate.detectType('//button'),
    indexedXPath: DI.validate.detectType('(//button)[1]'),
    playwright: DI.validate.detectType("page.getByText('x')"),
    shorthandPlaywright: DI.validate.detectType('getByRole("button")'),
    empty: DI.validate.detectType('')
  }));
  assert.equal(out.css, 'css');
  assert.equal(out.xpath, 'xpath');
  assert.equal(out.indexedXPath, 'xpath');
  assert.equal(out.playwright, 'playwright');
  assert.equal(out.shorthandPlaywright, 'playwright');
  assert.equal(out.empty, 'css');
});

test('validate: CSS, XPath and Playwright locators resolve', async () => {
  const out = await page.evaluate(() => ({
    css: DI.validate.test('auto', '#save'),
    xpath: DI.validate.test('auto', '//button[@id="save"]'),
    pw: DI.validate.test('playwright', "page.getByTestId('save-btn')"),
    label: DI.validate.test('playwright', "page.getByLabel('Email address')"),
    role: DI.validate.test('playwright', "page.getByRole('button', { name: 'Save changes', exact: true })")
  }));
  assert.equal(out.css.ok, true);
  assert.equal(out.css.type, 'css');
  assert.equal(out.css.count, 1);
  assert.equal(out.xpath.ok, true);
  assert.equal(out.xpath.type, 'xpath');
  assert.equal(out.xpath.count, 1);
  assert.equal(out.pw.ok, true);
  assert.equal(out.pw.count, 1);
  assert.equal(out.label.ok, true);
  assert.equal(out.label.count, 1);
  assert.equal(out.role.ok, true);
  assert.equal(out.role.count, 1);
});

test('validate: deep selectors find open-shadow descendants', async () => {
  const out = await page.evaluate(() => ({
    css: DI.validate.test('css', '#shadowbtn'),
    pw: DI.validate.test('playwright', "page.getByTestId('shadow-btn')")
  }));
  assert.equal(out.css.ok, true);
  assert.equal(out.css.count, 1);
  assert.equal(out.pw.ok, true);
  assert.equal(out.pw.count, 1);
});

test('validate: ARIA label, role and attribute locators', async () => {
  const out = await aria.evaluate(() => ({
    labelled: DI.validate.test('playwright', "page.getByRole('button', { name: 'Labelled button', exact: true })"),
    placeholder: DI.validate.test('playwright', "page.getByPlaceholder('you@example.com')"),
    alt: DI.validate.test('playwright', "page.getByAltText('Company logo')"),
    title: DI.validate.test('playwright', "page.getByTitle('Wrapped title')")
  }));
  for (const [name, result] of Object.entries(out)) {
    assert.equal(result.ok, true, name);
    assert.equal(result.count, 1, name);
  }
});

test('validate: invalid CSS reports a parser error', async () => {
  const out = await page.evaluate(() => DI.validate.test('css', 'div['));
  assert.equal(out.ok, false);
  assert.ok(out.error);
  assert.equal(out.count, 0);
});

test('validate: invalid XPath reports an error', async () => {
  const out = await page.evaluate(() => DI.validate.test('xpath', '//div['));
  assert.equal(out.ok, false);
  assert.ok(out.error);
  assert.equal(out.count, 0);
});

test('validate: unmatched but valid locator is not ok', async () => {
  const out = await page.evaluate(() => DI.validate.test('css', '.does-not-exist'));
  assert.equal(out.ok, false);
  assert.equal(out.count, 0);
  assert.ok(out.error);
});

test('validate: empty locator is rejected', async () => {
  const out = await page.evaluate(() => DI.validate.test('css', '   '));
  assert.equal(out.ok, false);
  assert.equal(out.count, 0);
  assert.equal(out.error, 'Empty locator');
});

test('validate: highlight applies and clearHighlight restores inline styles', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('link');
    el.style.outline = '1px solid rgb(1, 2, 3)';
    el.style.outlineOffset = '3px';
    DI.validate.highlight([el]);
    const applied = { outline: el.style.outline, offset: el.style.outlineOffset };
    DI.validate.clearHighlight();
    const restored = { outline: el.style.outline, offset: el.style.outlineOffset };
    el.removeAttribute('style');
    return { applied, restored };
  });
  assert.equal(out.applied.outline, '2px solid rgb(255, 90, 31)');
  assert.equal(out.applied.offset, '1px');
  assert.equal(out.restored.outline, '1px solid rgb(1, 2, 3)');
  assert.equal(out.restored.offset, '3px');
});

test('validate: index XPath is detected and counted', async () => {
  const out = await page.evaluate(() => {
    const xpath = DI.xpath.indexed(document.getElementById('link')).xpath;
    return { xpath, result: DI.validate.test('auto', xpath) };
  });
  assert.ok(out.xpath.startsWith('('));
  assert.equal(out.result.type, 'xpath');
  assert.equal(out.result.ok, true);
  assert.equal(out.result.count, 1);
});

test('validate: getByLabel resolves form controls inside shadow roots', async () => {
  const out = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'label-host';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<label for="deep-input">Deep label</label><input id="deep-input">';
    const generated = DI.playwright.countExpr("page.getByLabel('Deep label')");
    const validated = DI.validate.test('playwright', "page.getByLabel('Deep label')");
    host.remove();
    return { generated, validated };
  });
  assert.equal(out.generated, 1);
  assert.equal(out.validated.ok, true);
  assert.equal(out.validated.count, 1);
});

test('validate: resolve returns elements and parser errors directly', async () => {
  const out = await page.evaluate(() => ({
    css: DI.validate.resolve('css', '#save'),
    badCss: DI.validate.resolve('css', 'div['),
    xpath: DI.validate.resolve('xpath', '//button[@id="save"]'),
    pw: DI.validate.resolve('playwright', "page.getByTestId('save-btn')")
  }));
  out.pwId = await page.evaluate(() => DI.validate.resolve('playwright', "page.getByTestId('save-btn')").elements[0].id);
  assert.equal(out.css.error, null);
  assert.equal(out.css.elements.length, 1);
  assert.equal(out.badCss.elements.length, 0);
  assert.ok(out.badCss.error);
  assert.equal(out.xpath.elements.length, 1);
  assert.equal(out.xpath.error, null);
  assert.equal(out.pw.elements.length, 1);
  assert.equal(out.pwId, 'save');
});
