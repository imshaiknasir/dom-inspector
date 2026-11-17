'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture, injectGenerators } = require('../helpers/harness');

let browser;
let page;
let aria;
let duplicates;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
  aria = await openFixture(browser, 'fixtures/aria.html');
  duplicates = await openFixture(browser, 'fixtures/duplicates.html');
});

after(async () => { if (browser) await browser.close(); });

test('playwright: test id, role and label locators', async () => {
  const save = await page.evaluate(() => DI.playwright.generate(document.getElementById('save')));
  assert.ok(save.some((c) => c.selector.includes("getByTestId('save-btn')")));
  assert.ok(save.some((c) => c.selector.includes("getByRole('button'") && c.selector.includes('Save changes')));
  const email = await page.evaluate(() => DI.playwright.generate(document.getElementById('email')));
  assert.ok(email.some((c) => c.selector.includes("getByLabel('Email address')")));
  assert.ok(email.some((c) => c.selector.includes('getByPlaceholder')));
});

test('playwright: counts are computed against the live DOM', async () => {
  const out = await page.evaluate(() => ({
    testId: DI.playwright.countExpr("page.getByTestId('save-btn')"),
    rows: DI.playwright.countExpr("page.locator('.rowbtn')"),
    editRole: DI.playwright.countExpr("page.getByRole('button', { name: 'Edit' })"),
    editText: DI.playwright.countExpr("page.getByText('Edit')"),
    linkText: DI.playwright.countExpr("page.getByText('Read the docs', { exact: true })")
  }));
  assert.equal(out.testId, 1);
  assert.equal(out.rows, 2);
  assert.equal(out.editRole, 2);
  assert.equal(out.editText, 2);
  assert.equal(out.linkText, 1);
});

test('playwright: generated counts agree with the counting engine', async () => {
  for (const id of ['save', 'email']) {
    const out = await page.evaluate((elementId) => {
      const el = document.getElementById(elementId);
      return DI.playwright.generate(el).map((candidate) => ({
        ...candidate,
        engine: /:visible|:nth|\.nth\(/.test(candidate.selector) || /regex|nth/.test(candidate.type)
          ? null
          : DI.playwright.countExpr(candidate.selector)
      }));
    }, id);
    for (const candidate of out) {
      if (candidate.engine == null) continue;
      assert.equal(candidate.engine, candidate.count, `${id}: ${candidate.selector}`);
    }
  }
});

test('playwright: text, alt and title locators', async () => {
  const out = await aria.evaluate(() => ({
    link: DI.playwright.generate(document.getElementById('anchor')).map((c) => c.selector),
    logo: DI.playwright.generate(document.getElementById('logo')).map((c) => c.selector),
    wrapped: DI.playwright.generate(document.getElementById('wrapped')).map((c) => c.selector)
  }));
  assert.ok(out.link.some((selector) => selector.includes("getByText('Read the docs'")));
  assert.ok(out.logo.some((selector) => selector.includes("getByAltText('Company logo')")));
  assert.ok(out.logo.some((selector) => selector.includes("getByTitle('Logo title')")));
  assert.ok(out.wrapped.some((selector) => selector.includes("getByTitle('Wrapped title')")));
});

test('playwright: ARIA roles and accessible names follow the implicit map', async () => {
  const out = await aria.evaluate(() => {
    const role = (id) => DI.playwright.implicitRole(document.getElementById(id));
    const name = (id) => DI.playwright.accessibleName(document.getElementById(id));
    return {
      search: role('search'),
      number: role('number'),
      single: role('single'),
      multi: role('multi'),
      rowHeader: DI.playwright.implicitRole(document.querySelector('th[scope="row"]')),
      colHeader: DI.playwright.implicitRole(document.querySelector('th[scope="col"]')),
      region: DI.playwright.implicitRole(document.querySelector('section')),
      labelled: name('labelled'),
      image: name('logo'),
      button: name('wrapped')
    };
  });
  assert.equal(out.search, 'searchbox');
  assert.equal(out.number, 'spinbutton');
  assert.equal(out.single, 'combobox');
  assert.equal(out.multi, 'listbox');
  assert.equal(out.rowHeader, 'rowheader');
  assert.equal(out.colHeader, 'columnheader');
  assert.equal(out.region, 'region');
  assert.equal(out.labelled, 'Labelled button');
  assert.equal(out.image, 'Company logo');
  assert.equal(out.button, 'Wrapped');
});

test('playwright: :has-text and :text-is pseudo-classes are counted', async () => {
  const out = await duplicates.evaluate(() => ({
    hasText: DI.playwright.countExpr("page.locator('button:has-text(\"Dupe\")')"),
    textIs: DI.playwright.countExpr("page.locator('button:text-is(\"Dupe\")')"),
    textIsOther: DI.playwright.countExpr("page.locator('button:text-is(\"Other\")')")
  }));
  assert.equal(out.hasText, 3);
  assert.equal(out.textIs, 3);
  assert.equal(out.textIsOther, 1);
});

test('playwright: :visible pseudo-class is generated for unique CSS', async () => {
  const locators = await page.evaluate(() => DI.playwright.generate(document.getElementById('save')).map((c) => c.selector));
  assert.ok(locators.some((selector) => selector.includes("page.locator('#save:visible')")));
});

test('playwright: frameLocator prefix is generated inside a child frame', async () => {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert.ok(frame, 'child frame exists');
  await frame.waitForSelector('#inner');
  await injectGenerators(frame);
  const out = await frame.evaluate(() => {
    const el = document.getElementById('inner');
    return {
      prefix: DI.playwright.framePrefix(),
      pw: DI.playwright.generate(el).map((c) => c.selector)
    };
  });
  assert.equal(out.prefix.length, 1);
  assert.ok(out.prefix[0].startsWith('frameLocator('));
  assert.ok(out.pw.some((selector) => selector.includes('frameLocator') && selector.includes('getByTestId')));
});

test('playwright: simple language converters match their target syntax', async () => {
  const out = await page.evaluate(() => ({
    py: DI.playwright.toPython("page.getByTestId('save-btn')"),
    java: DI.playwright.toJava("page.getByTestId('save-btn')"),
    cs: DI.playwright.toCSharp("page.getByTestId('save-btn')"),
    pyRole: DI.playwright.toPython("page.getByRole('button')"),
    javaRole: DI.playwright.toJava("page.getByRole('button')")
  }));
  assert.equal(out.py, 'page.get_by_test_id("save-btn")');
  assert.equal(out.java, 'page.getByTestId("save-btn")');
  assert.equal(out.cs, 'Page.GetByTestId("save-btn")');
  assert.equal(out.pyRole, 'page.get_by_role("button")');
  assert.equal(out.javaRole, 'page.getByRole(AriaRole.button)');
});

test('playwright: :visible with hidden siblings is counted correctly', async () => {
  const count = await duplicates.evaluate(() => DI.playwright.countExpr("page.locator('.ghostbtn:visible')"));
  assert.equal(count, 2);
});

test('playwright: Python output keeps nested XPath quotes valid', async () => {
  const out = await page.evaluate(() => DI.playwright.toPython("page.locator(`//*[@id='save']`)"));
  assert.equal(out, 'page.locator("//*[@id=\'save\']")');
});

test('playwright: Java and C# keep the exact option', async () => {
  const out = await page.evaluate(() => ({
    java: DI.playwright.toJava("page.getByRole('button', { name: 'Save', exact: true })"),
    cs: DI.playwright.toCSharp("page.getByRole('button', { name: 'Save', exact: true })")
  }));
  assert.ok(out.java.includes('setExact(true)'), out.java);
  assert.ok(out.cs.includes('Exact = true'), out.cs);
});
