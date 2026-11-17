'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture } = require('../helpers/harness');

let browser;
let page;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
});

after(async () => { if (browser) await browser.close(); });

test('repair: normalize cleans quotes, whitespace and unbalanced delimiters', async () => {
  const out = await page.evaluate(() => {
    const input = [
      ' #save ',
      '\u201c#save\u201d',
      'button[data-testid="save-btn"',
      'button#save >  ',
      '.btn;',
      '\u200b#save\u00a0',
      'div[',
      'div[title=\'x',
      'button[data-testid=\'save-btn\'',
      'a[href="x',
      'div[title="a]b"]',
      'div[title="a[b"]',
      "div[title=']']",
      'div:not([title="a)b"])',
      '  ',
      ''
    ];
    return input.map((value) => [value, DI.repair.normalize(value)]);
  });
  const byInput = Object.fromEntries(out);
  assert.equal(byInput[' #save '], '#save');
  assert.equal(byInput['\u201c#save\u201d'], '#save');
  assert.equal(byInput['button[data-testid="save-btn"'], 'button[data-testid="save-btn"]');
  assert.equal(byInput['button#save >  '], 'button#save');
  assert.equal(byInput['.btn;'], '.btn');
  assert.equal(byInput['\u200b#save\u00a0'], '#save');
  assert.equal(byInput['div['], 'div[]');
  assert.equal(byInput['div[title=\'x'], "div[title='x']");
  assert.equal(byInput['button[data-testid=\'save-btn\''], "button[data-testid='save-btn']");
  assert.equal(byInput['a[href="x'], 'a[href="x"]');
  assert.equal(byInput['div[title="a]b"]'], 'div[title="a]b"]');
  assert.equal(byInput['div[title="a[b"]'], 'div[title="a[b"]');
  assert.equal(byInput["div[title=']']"], "div[title=']']");
  assert.equal(byInput['div:not([title="a)b"])'], 'div:not([title="a)b"])');
  assert.equal(byInput['  '], '');
  assert.equal(byInput[''], '');
});

test('repair: tokens expose ids, classes, attributes, tags and text', async () => {
  const out = await page.evaluate(() => ({
    id: DI.repair.tokens('#save'),
    cls: DI.repair.tokens('.btn'),
    attr: DI.repair.tokens('[data-testid="save-btn"]'),
    tag: DI.repair.tokens('button'),
    mixed: DI.repair.tokens('//button[text()="Save changes"]')
  }));
  assert.deepEqual(out.id, [{ type: 'id', token: 'save' }]);
  assert.deepEqual(out.cls, [{ type: 'class', token: 'btn' }]);
  assert.ok(out.attr.some((entry) => entry.type === 'attr:data-testid' && entry.token === 'save-btn'));
  assert.ok(out.tag.some((entry) => entry.type === 'tag' && entry.token === 'button'));
  assert.ok(out.mixed.some((entry) => entry.type === 'tag' && entry.token === 'button'));
  assert.ok(out.mixed.some((entry) => entry.type === 'text' && entry.token === 'Save changes'));
});

test('repair: a valid selector is returned unchanged with stable locators', async () => {
  const out = await page.evaluate(() => DI.repair.fix('#save'));
  assert.equal(out.ok, true);
  assert.equal(out.repaired, false);
  assert.equal(out.fixed, '#save');
  assert.equal(out.type, 'css');
  assert.equal(out.count, 1);
  assert.equal(out.locators.css, '#save');
  assert.equal(out.locators.xpath, "//*[@id='save']");
  assert.match(out.locators.playwright, /getByTestId\('save-btn'\)/);
  assert.equal(out.locators.matchCount, 1);
});

test('repair: a near-miss id is resolved to the real element', async () => {
  const out = await page.evaluate(() => DI.repair.fix('#sav'));
  assert.equal(out.ok, true);
  assert.equal(out.repaired, true);
  assert.equal(out.fixed, '#save');
  assert.equal(out.count, 1);
  assert.equal(out.element.tag, 'button');
  assert.equal(out.element.id, 'save');
  assert.equal(out.locators.matchCount, 1);
  assert.ok(out.score > 0);
});

test('repair: a valid selector with a trailing semicolon is normalized', async () => {
  const out = await page.evaluate(() => DI.repair.fix('button[data-testid="save-btn"];'));
  assert.equal(out.ok, true);
  assert.equal(out.repaired, true);
  assert.equal(out.fixed, 'button[data-testid="save-btn"]');
  assert.equal(out.count, 1);
  assert.equal(out.element.id, 'save');
});

test('repair: a broken tag selector falls back to a matching element', async () => {
  const out = await page.evaluate(() => DI.repair.fix('div['));
  assert.equal(out.ok, true);
  assert.equal(out.repaired, true);
  assert.ok(out.fixed);
  assert.equal(out.element.tag, 'div');
  const unique = await page.evaluate((selector) => DI.validate.test('css', selector), out.fixed);
  assert.equal(unique.ok, true);
  assert.equal(unique.count, 1);
});

test('repair: selectors without any matching tokens fail closed', async () => {
  const out = await page.evaluate(() => ({
    missing: DI.repair.fix('.does-not-exist-anywhere'),
    empty: DI.repair.fix('   ')
  }));
  assert.equal(out.missing.ok, false);
  assert.equal(out.missing.error, 'No matching element found');
  assert.equal(out.empty.ok, false);
  assert.equal(out.empty.error, 'No matching element found');
});

test('repair: valid XPath is preserved and accompanied by CSS/Playwright locators', async () => {
  const out = await page.evaluate(() => DI.repair.fix('//button[text()="Save changes"]'));
  assert.equal(out.ok, true);
  assert.equal(out.repaired, false);
  assert.equal(out.type, 'xpath');
  assert.equal(out.count, 1);
  assert.equal(out.locators.css, '#save');
});

test('repair: valid selectors inside same-origin frames are found', async () => {
  const out = await page.evaluate(() => DI.repair.fix('#inner'));
  assert.equal(out.ok, true);
  assert.equal(out.count, 1);
  assert.equal(out.element.id, 'inner');
  assert.equal(out.locators.css, '#inner');
  assert.deepEqual(out.locators.frameCss, ['#frame']);
  assert.deepEqual(out.locators.frameXpath, ["//iframe[@id='frame']"]);
  assert.match(out.locators.playwright, /frameLocator\('#frame'\).*getByTestId\('inner-btn'\)/);
});

test('repair: near-miss selectors search same-origin frames', async () => {
  const out = await page.evaluate(() => DI.repair.fix('#inne'));
  assert.equal(out.ok, true);
  assert.equal(out.repaired, true);
  assert.equal(out.element.tag, 'button');
  assert.equal(out.element.id, 'inner');
  assert.equal(out.locators.matchCount, 1);
  assert.match(out.locators.playwright, /frameLocator\('#frame'\)/);
});

test('repair: fixMany preserves order and per-selector results', async () => {
  const out = await page.evaluate(() => ({
    mixed: DI.repair.fixMany(['#save', '#sav', '.does-not-exist-anywhere']),
    notArray: DI.repair.fixMany('nope'),
    nullish: DI.repair.fixMany(null)
  }));
  assert.equal(out.mixed.length, 3);
  assert.equal(out.mixed[0].ok, true);
  assert.equal(out.mixed[0].repaired, false);
  assert.equal(out.mixed[1].ok, true);
  assert.equal(out.mixed[1].fixed, '#save');
  assert.equal(out.mixed[2].ok, false);
  assert.equal(out.mixed[2].error, 'No matching element found');
  assert.deepEqual(out.notArray, []);
  assert.deepEqual(out.nullish, []);
});

test('repair: valid XPath that selects non-elements is reported without locators', async () => {
  const out = await page.evaluate(() => ({
    single: DI.repair.fix("//button[@id='save']/text()"),
    many: DI.repair.fix('//button/text()')
  }));
  assert.equal(out.single.ok, true);
  assert.equal(out.single.count, 1);
  assert.equal(out.single.type, 'xpath');
  assert.equal(out.single.fixed, "//button[@id='save']/text()");
  assert.equal(out.single.element, null);
  assert.equal(out.single.locators, null);
  assert.equal(out.many.ok, true);
  assert.ok(out.many.count > 1);
  assert.equal(out.many.element, null);
  assert.equal(out.many.locators, null);
});

test('repair: near-miss Playwright text, label and placeholder arguments', async () => {
  const out = await page.evaluate(() => ({
    role: DI.repair.fix("page.getByRole('button', { name: 'Sav changes' })"),
    label: DI.repair.fix("page.getByLabel('Email adress')"),
    placeholder: DI.repair.fix("page.getByPlaceholder('you@exampl.com')")
  }));
  assert.equal(out.role.ok, true);
  assert.equal(out.role.fixed, '#save');
  assert.equal(out.label.ok, true);
  assert.equal(out.label.fixed, '#email');
  assert.equal(out.placeholder.ok, true);
  assert.equal(out.placeholder.fixed, '#email');
});
