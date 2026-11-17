'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture } = require('../helpers/harness');

let browser;
let page;
let aria;
let duplicates;
let escaping;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
  aria = await openFixture(browser, 'fixtures/aria.html');
  duplicates = await openFixture(browser, 'fixtures/duplicates.html');
  escaping = await openFixture(browser, 'fixtures/escaping.html');
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

test('formats: generated JS snippet is executable for ids needing CSS escapes', async () => {
  const out = await page.evaluate(() => {
    // Reuse the escaping fixture page through an iframe-free inline clone.
    const el = document.createElement('div');
    el.id = "a'b";
    el.textContent = 'apostrophe';
    document.body.appendChild(el);
    const snippet = DI.formats.formats(el).find((row) => row.type === 'js');
    const found = eval(snippet.code);
    const result = found === el;
    el.remove();
    return { snippet, result };
  });
  assert.ok(out.snippet.code.startsWith('document.querySelector('));
  assert.equal(out.result, true);
});

test('testRigor: label, aria-label, placeholder and fallback paths', async () => {
  const out = await page.evaluate(() => ({
    button: DI.formats.testRigorPath(document.getElementById('save')),
    email: DI.formats.testRigorPath(document.getElementById('email')),
    inFormats: DI.formats.formats(document.getElementById('save')).filter((row) => row.type === 'testRigor')
  }));
  const ariaOut = await aria.evaluate(() => ({
    search: DI.formats.testRigorPath(document.getElementById('search')),
    accept: DI.formats.testRigorPath(document.getElementById('check')),
    fallback: (() => {
      const el = document.createElement('div');
      el.id = 'nid';
      document.body.appendChild(el);
      const path = DI.formats.testRigorPath(el);
      el.remove();
      return path;
    })(),
    placeholder: (() => {
      const el = document.createElement('input');
      el.placeholder = 'you@example.com';
      document.body.appendChild(el);
      const path = DI.formats.testRigorPath(el);
      el.remove();
      return path;
    })()
  }));
  assert.equal(out.button, '"Save changes"');
  assert.equal(out.email, '"Email address"');
  assert.equal(out.inFormats.length, 1);
  assert.equal(out.inFormats[0].code, '"Save changes"');
  assert.equal(ariaOut.search, '"Search"');
  assert.equal(ariaOut.accept, '"Accept"');
  assert.equal(ariaOut.fallback, '"nid"');
  assert.equal(ariaOut.placeholder, '"you@example.com"');
});

test('testRigor: quoted labels stay valid JavaScript string literals', async () => {
  const out = await page.evaluate(() => {
    const el = document.createElement('button');
    el.setAttribute('aria-label', 'He said "hi"\\path');
    document.body.appendChild(el);
    const code = DI.formats.testRigorPath(el);
    const decoded = eval(code);
    el.remove();
    return { code, decoded };
  });
  assert.equal(out.code, '"He said \\\"hi\\\"\\\\path"');
  assert.equal(out.decoded, 'He said "hi"\\path');
});

test('testRigor: control whitespace stays a valid JS string literal', async () => {
  const out = await escaping.evaluate(() => {
    const value = DI.formats.testRigorPath(document.getElementById('labelmultiline'));
    return { value, parsed: (() => { try { return JSON.parse(value); } catch (_) { return null; } })() };
  });
  assert.equal(out.value, '"Line one\\nLine two"');
  assert.equal(out.parsed, 'Line one\nLine two');
});
