const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = ['util', 'css', 'xpath', 'playwright', 'formats', 'validate']
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
