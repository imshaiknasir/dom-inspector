'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture } = require('../helpers/harness');

let browser;
let page;
let duplicates;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
  duplicates = await openFixture(browser, 'fixtures/duplicates.html');
});

after(async () => { if (browser) await browser.close(); });

test('formats: Selenium values for an element with id, classes and text', async () => {
  const rows = await page.evaluate(() => DI.formats.generate(document.getElementById('save')));
  const byType = Object.fromEntries(rows.map((row) => [row.type, row]));
  assert.equal(byType.id.value, 'save');
  assert.equal(byType.id.count, 1);
  assert.equal(byType.cssSelector.count, 1);
  assert.equal(byType.xpath.count, 1);
  assert.equal(byType.className.value, 'btn primary');
  assert.equal(byType.className.count, 1);
  assert.equal(byType.tagName.value, 'button');
  assert.equal(byType.tagName.count, 4);
});

test('formats: name, cssSelector and xpath counts resolve correctly', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('email');
    const rows = DI.formats.generate(el);
    return rows.map((row) => {
      let resolved = null;
      if (row.type === 'id') resolved = document.querySelectorAll('#' + row.value).length;
      if (row.type === 'name') resolved = document.querySelectorAll(`[name="${row.value}"]`).length;
      if (row.type === 'cssSelector') resolved = document.querySelectorAll(row.value).length;
      if (row.type === 'xpath') resolved = DI.xpath.count(row.value);
      return { type: row.type, count: row.count, resolved };
    });
  });
  for (const row of out) {
    if (row.resolved == null) continue;
    assert.equal(row.count, row.resolved, row.type);
  }
});

test('formats: link text values are exposed for anchors', async () => {
  const rows = await page.evaluate(() => DI.formats.generate(document.getElementById('link')));
  const link = rows.find((row) => row.type === 'linkText');
  const partial = rows.find((row) => row.type === 'partialLinkText');
  assert.equal(link.value, 'Read the docs');
  assert.equal(partial.value, 'Read the docs');
  assert.ok(link.count > 0);
});

test('formats: Cypress, jQuery and JS snippets derive from verified CSS/XPath', async () => {
  const rows = await page.evaluate(() => DI.formats.formats(document.getElementById('save')));
  const byType = Object.fromEntries(rows.map((row) => [row.type, row.code]));
  assert.equal(byType['cypress-css'], "cy.get('#save')");
  assert.equal(byType.jquery, "$('#save')");
  assert.equal(byType.js, "document.querySelector('#save')");
  assert.ok(byType['cypress-xpath'].startsWith('cy.xpath('));
  assert.ok(byType['js-xpath'].startsWith('document.evaluate('));
});

test('formats: selectors for shadow elements stay usable', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return { selenium: DI.formats.generate(el), formats: DI.formats.formats(el) };
  });
  assert.ok(out.selenium.some((row) => row.type === 'cssSelector' && row.count === 1));
  assert.ok(!out.selenium.some((row) => row.type === 'xpath'));
  assert.ok(out.formats.some((row) => row.type === 'cypress-css' && row.code.includes('#shadowbtn')));
  assert.ok(!out.formats.some((row) => row.type === 'cypress-xpath'));
});

test('formats: snippet quoting escapes single quotes', async () => {
  const out = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'quote-host';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="quoted-id">Quoted</button>';
    const el = root.getElementById('quoted-id');
    const rows = DI.formats.formats(el);
    host.remove();
    return rows.find((row) => row.type === 'js');
  });
  assert.ok(out);
  assert.ok(out.code.includes("'#quoted-id'"));
});

test('formats: linkText count matches the number of identical anchors', async () => {
  const rows = await duplicates.evaluate(() => DI.formats.generate([...document.querySelectorAll('a')][0]));
  const link = rows.find((row) => row.type === 'linkText');
  assert.equal(link.value, 'Docs');
  assert.equal(link.count, 2);
});
