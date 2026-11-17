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

test('playwright: implicit roles cover form, text, heading and list controls', async () => {
  const out = await aria.evaluate(() => {
    const role = (id) => DI.playwright.implicitRole(document.getElementById(id));
    return {
      checkbox: role('check'),
      radio: role('radio'),
      range: role('range'),
      submit: role('submit'),
      textarea: role('notes'),
      heading: role('heading'),
      nav: role('nav'),
      list: role('list'),
      item: role('item'),
      dialog: role('dialog')
    };
  });
  assert.deepEqual(out, {
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    submit: 'button',
    textarea: 'textbox',
    heading: 'heading',
    nav: 'navigation',
    list: 'list',
    item: 'listitem',
    dialog: 'dialog'
  });
});

test('playwright: accessible names prefer aria-labelledby and aria-label', async () => {
  const out = await aria.evaluate(() => ({
    dialog: DI.playwright.accessibleName(document.getElementById('dialog')),
    navlink: DI.playwright.accessibleName(document.getElementById('navlink'))
  }));
  assert.equal(out.dialog, 'Dialog box');
  assert.equal(out.navlink, 'Nav link');
});

test('playwright: aria-labelledby drives getByLabel generation and validation', async () => {
  const out = await aria.evaluate(() => {
    const el = document.getElementById('labelled');
    return {
      generate: DI.playwright.generate(el).map((item) => item.selector),
      count: DI.playwright.countExpr("page.getByLabel('Labelled button')"),
      validated: DI.validate.test('playwright', "page.getByLabel('Labelled button')"),
      name: DI.playwright.accessibleName(el)
    };
  });
  assert.equal(out.name, 'Labelled button');
  assert.ok(out.generate.some((selector) => selector.includes("getByLabel('Labelled button'")));
  assert.equal(out.count, 1);
  assert.equal(out.validated.ok, true);
  assert.equal(out.validated.count, 1);
});

test('playwright: submit inputs use their value as the accessible name', async () => {
  const out = await aria.evaluate(() => {
    const el = document.getElementById('submit');
    return {
      name: DI.playwright.accessibleName(el),
      role: DI.playwright.implicitRole(el),
      generate: DI.playwright.generate(el).map((item) => item.selector)
    };
  });
  assert.equal(out.role, 'button');
  assert.equal(out.name, 'Send');
  assert.ok(out.generate.some((selector) => selector.includes("getByRole('button'") && selector.includes("name: 'Send'")));
});

test('playwright: best() returns a unique locator', async () => {
  const out = await page.evaluate(() => ({
    save: DI.playwright.best(document.getElementById('save')),
    email: DI.playwright.best(document.getElementById('email'))
  }));
  assert.ok(out.save);
  assert.equal(out.save.count, 1);
  assert.ok(out.save.selector.includes('save'));
  assert.ok(out.email);
  assert.equal(out.email.count, 1);
});

test('playwright: chained locators count inside shadow roots', async () => {
  const out = await page.evaluate(() => ({
    shadow: DI.playwright.countExpr("page.locator('#host').locator('#shadowbtn')"),
    table: DI.playwright.countExpr("page.locator('#people').locator('.rowbtn')"),
    missing: DI.playwright.countExpr("page.locator('#nope').locator('.rowbtn')")
  }));
  assert.equal(out.shadow, 1);
  assert.equal(out.table, 2);
  assert.equal(out.missing, 0);
});

test('playwright: shadow targets get an explicit locator chain', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return DI.playwright.generate(el).map((item) => ({ ...item }));
  });
  const chain = out.find((item) => item.type === 'locator+shadow');
  assert.ok(chain, 'locator+shadow candidate');
  assert.equal(chain.count, 1);
  assert.ok(chain.selector.includes("locator('#host')"), chain.selector);
  assert.ok(chain.selector.includes("locator('#shadowbtn')"), chain.selector);
  assert.equal(await page.evaluate((selector) => DI.playwright.countExpr(selector), chain.selector), 1);
});

test('playwright: regex role names with escaped slashes count and validate', async () => {
  const out = await page.evaluate(() => {
    const el = document.createElement('button');
    el.textContent = 'Save/Changes';
    document.body.appendChild(el);
    const expr = "page.getByRole('button', { name: /Save\\/Changes/i })";
    const result = {
      count: DI.playwright.countExpr(expr),
      validated: DI.validate.test('playwright', expr)
    };
    el.remove();
    return result;
  });
  assert.equal(out.count, 1);
  assert.equal(out.validated.ok, true);
  assert.equal(out.validated.count, 1);
});

test('playwright: non-unique shadow CSS does not emit a locator chain', async () => {
  const out = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'multi-host';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button class="dup">One</button><button class="dup">Two</button>';
    const el = root.querySelector('.dup');
    const generated = DI.playwright.generate(el);
    host.remove();
    return generated;
  });
  assert.ok(!out.some((item) => item.type === 'locator+shadow'));
  assert.ok(out.some((item) => item.selector.includes("locator('.dup')") && item.count === 2));
  assert.ok(out.some((item) => item.count === 1));
});

test('playwright: regex arguments count for text, label and test id', async () => {
  const out = await page.evaluate(() => ({
    text: DI.playwright.countExpr("page.getByText(/save changes/i)"),
    label: DI.playwright.countExpr("page.getByLabel(/email/i)"),
    testId: DI.playwright.countExpr("page.getByTestId(/save-/)"),
    caseSensitive: DI.playwright.countExpr("page.getByText(/SAVE CHANGES/)")
  }));
  assert.equal(out.text, 1);
  assert.equal(out.label, 1);
  assert.equal(out.testId, 1);
  assert.equal(out.caseSensitive, 0);
});

test('playwright: quoted text, commas and parentheses count exactly', async () => {
  const local = await browser.newPage();
  try {
    await local.setContent(`<!doctype html><html><body>
      <button id="apos">it's fine</button>
      <button id="comma">One, two</button>
      <button id="paren">Save (now)</button>
      <button id="quoted">He said "hi"</button>
    </body></html>`);
    await injectGenerators(local);
    const cases = [
      [`page.getByText("it's fine")`, local.getByText("it's fine")],
      [`page.getByText('One, two')`, local.getByText('One, two')],
      ['page.getByText(/one, two/i)', local.getByText(/one, two/i)],
      [`page.getByText('Save (now)')`, local.getByText('Save (now)')],
      [`page.getByRole('button', { name: "it's fine" })`, local.getByRole('button', { name: "it's fine" })],
      [`page.getByRole('button', { name: 'He said "hi"' })`, local.getByRole('button', { name: 'He said "hi"' })],
      [`page.locator('button').filter({ hasText: 'One, two' })`, local.locator('button').filter({ hasText: 'One, two' })]
    ];
    for (const [expr, real] of cases) {
      const count = await local.evaluate((value) => DI.playwright.countExpr(value), expr);
      assert.equal(count, await real.count(), expr);
    }
  } finally {
    await local.close();
  }
});
