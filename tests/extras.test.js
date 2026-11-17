const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = ['util', 'css', 'xpath', 'playwright', 'formats', 'validate', 'repair']
  .map((n) => path.join(ROOT, 'src/content', n + '.js'));
const FIXTURE = 'file://' + path.join(__dirname, 'fixture.html');

let browser, page;
before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true });
  page = await browser.newPage();
  await page.goto(FIXTURE);
  for (const file of SCRIPTS) await page.addScriptTag({ path: file });
});
after(async () => { if (browser) await browser.close(); });

test('candidates expose a stability score', async () => {
  const css = await page.evaluate(() => DI.css.best(document.getElementById('save')));
  const xp = await page.evaluate(() => DI.xpath.best(document.getElementById('save')));
  const pw = await page.evaluate(() => DI.playwright.generate(document.getElementById('save')));
  assert.ok(css.stability >= 80);
  assert.ok(xp.stability >= 80);
  assert.ok(pw.every((item) => typeof item.stability === 'number'));
  assert.ok(pw.some((item) => item.stability >= 90));
});

test('shadow elements get a Cypress shadow chain', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return DI.formats.formats(el);
  });
  const row = out.find((item) => item.type === 'cypress-shadow');
  assert.ok(row);
  assert.match(row.code, /\.shadow\(\)/);
  assert.match(row.code, /\.find\(/);
});

test('iframe chain and shadow chain are bounded', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return { hosts: DI.css.shadowChain(el), frames: DI.util.iframeChain().length };
  });
  assert.equal(out.frames, 0);
  assert.equal(out.hosts.length, 1);
});

test('playwright: regex role locators count and validate', async () => {
  const out = await page.evaluate(() => {
    const expr = "page.getByRole('button', { name: /^Save changes$/i })";
    return {
      count: DI.playwright.countExpr(expr),
      validated: DI.validate.test('playwright', expr)
    };
  });
  assert.equal(out.count, 1);
  assert.equal(out.validated.ok, true);
  assert.equal(out.validated.count, 1);
});

test('validate: Playwright frameLocator resolves inside a same-origin frame', async () => {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  assert.ok(frame);
  await frame.waitForSelector('#inner');
  const out = await page.evaluate(() => DI.validate.test('playwright', "page.frameLocator('#frame').getByTestId('inner-btn')"));
  assert.equal(out.ok, true);
  assert.equal(out.count, 1);
});

test('validate: CSS and XPath fall back into same-origin frames', async () => {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForSelector('#inner');
  const out = await page.evaluate(() => ({
    css: DI.validate.test('css', '#inner'),
    xpath: DI.validate.test('xpath', "//button[@id='inner']")
  }));
  assert.equal(out.css.ok, true);
  assert.equal(out.css.count, 1);
  assert.equal(out.xpath.ok, true);
  assert.equal(out.xpath.count, 1);
});

test('playwright: filter and first/last/nth modifiers are evaluated', async () => {
  const out = await page.evaluate(() => ({
    filter: DI.playwright.countExpr("page.locator('.rowbtn').filter({ hasText: 'Edit' })"),
    first: DI.playwright.countExpr("page.locator('.rowbtn').first()"),
    last: DI.playwright.countExpr("page.locator('.rowbtn').last()"),
    nth: DI.playwright.countExpr("page.locator('.rowbtn').nth(1)"),
    nthOut: DI.playwright.countExpr("page.locator('.rowbtn').nth(9)"),
    filtered: DI.validate.test('playwright', "page.locator('.rowbtn').filter({ hasText: 'Edit' })")
  }));
  assert.equal(out.filter, 2);
  assert.equal(out.first, 1);
  assert.equal(out.last, 1);
  assert.equal(out.nth, 1);
  assert.equal(out.nthOut, 0);
  assert.equal(out.filtered.count, 2);
});


test('repair: normalises a broken selector and keeps it valid', async () => {
  const out = await page.evaluate(() => DI.repair.fix("//button[@id='save'"));
  assert.equal(out.ok, true);
  assert.equal(out.fixed, "//button[@id='save']");
});

test('repair: rebuilds locators from a broken selector', async () => {
  const out = await page.evaluate(() => DI.repair.fix('##save'));
  assert.equal(out.ok, true);
  assert.ok(out.repaired);
  assert.equal(out.locators.css, '#save');
  assert.equal(out.element.tag, 'button');
});

test('repair: reports no match for an unknown selector', async () => {
  const out = await page.evaluate(() => DI.repair.fix('.definitely-not-here-xyz'));
  assert.equal(out.ok, false);
  assert.ok(out.error);
});

test('repair: reaches same-origin iframe elements when the top frame lacks them', async () => {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForSelector('#inner');
  const out = await page.evaluate(() => DI.repair.fix('#inner'));
  assert.equal(out.ok, true);
  assert.equal(out.element.id, 'inner');
});

test('repair: fixMany repairs a batch in order', async () => {
  const out = await page.evaluate(() => DI.repair.fixMany(["//button[@id='save'", '##save', '.nope-xyz']));
  assert.equal(out.length, 3);
  assert.equal(out[0].ok, true);
  assert.equal(out[1].locators.css, '#save');
  assert.equal(out[2].ok, false);
});

test('playwright: input submit value is its accessible name', async () => {
  const out = await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'submit';
    input.value = 'Confirm order';
    input.id = 'confirm-order';
    document.body.appendChild(input);
    const generated = DI.playwright.generate(input).map((c) => c.selector);
    const count = DI.playwright.countExpr("page.getByRole('button', { name: 'Confirm order' })");
    input.remove();
    return { generated, count };
  });
  assert.ok(out.generated.some((s) => s.includes("getByRole('button'") && s.includes('Confirm order')));
  assert.equal(out.count, 1);
});

test('playwright: aria-labelledby resolves to getByLabel', async () => {
  const out = await page.evaluate(() => {
    const heading = document.createElement('span');
    heading.id = 'ship-label';
    heading.textContent = 'Shipping address';
    const input = document.createElement('input');
    input.id = 'ship-input';
    input.setAttribute('aria-labelledby', 'ship-label');
    document.body.append(heading, input);
    const generated = DI.playwright.generate(input).map((c) => c.selector);
    const count = DI.playwright.countExpr("page.getByLabel('Shipping address')");
    const validated = DI.validate.test('playwright', "page.getByLabel('Shipping address')");
    heading.remove(); input.remove();
    return { generated, count, validated };
  });
  assert.ok(out.generated.some((s) => s.includes("getByLabel('Shipping address')")));
  assert.equal(out.count, 1);
  assert.equal(out.validated.count, 1);
});
