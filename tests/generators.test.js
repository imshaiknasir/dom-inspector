const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = [
  'src/content/util.js',
  'src/content/css.js',
  'src/content/xpath.js',
  'src/content/playwright.js',
  'src/content/formats.js',
  'src/content/validate.js'
].map((p) => path.join(ROOT, p));
const FIXTURE = 'file://' + path.join(__dirname, 'fixture.html');

let browser;
let page;

const inject = async (frame) => {
  for (const file of SCRIPTS) await frame.addScriptTag({ path: file });
};

before(async () => {
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  page = await browser.newPage();
  await page.goto(FIXTURE);
  await inject(page);
});

after(async () => { if (browser) await browser.close(); });

test('css: id is the best unique selector', async () => {
  const result = await page.evaluate(() => DI.css.best(document.getElementById('save')));
  assert.equal(result.selector, '#save');
  assert.equal(result.count, 1);
});

test('css: disambiguates duplicate classes with a unique path', async () => {
  const result = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Other');
    return DI.css.best(el);
  });
  assert.equal(result.count, 1);
  assert.ok(result.selector.includes('nth-of-type') || result.selector.includes('#'));
});

test('css: generated dynamic classes are ignored', async () => {
  const candidates = await page.evaluate(() => DI.css.candidates(document.getElementById('dynbox')).map((c) => c.selector));
  assert.ok(!candidates.some((s) => s.includes('css-1a2b3c4d')));
});

test('xpath: relative and absolute variants', async () => {
  const rel = await page.evaluate(() => DI.xpath.best(document.getElementById('save')));
  assert.equal(rel.count, 1);
  assert.ok(rel.xpath.includes("@id='save'"));
  const abs = await page.evaluate(() => DI.xpath.absoluteXPath(document.getElementById('save')));
  assert.ok(abs.startsWith('/html'));
});

test('xpath: indexed variant resolves exactly one node', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('link');
    const indexed = DI.xpath.indexed(el);
    const nodes = DI.xpath.snapshot(indexed.xpath);
    return { indexed, same: nodes.length === 1 && nodes[0] === el };
  });
  assert.equal(out.indexed.count, 1);
  assert.equal(out.same, true);
});

test('xpath: text and contains variants exist', async () => {
  const variants = await page.evaluate(() => DI.xpath.candidates(document.getElementById('link')).map((c) => c.xpath));
  assert.ok(variants.some((x) => x.includes('normalize-space()')));
  assert.ok(variants.some((x) => x.includes('contains')));
});

test('xpath: axes from label to its input', async () => {
  const out = await page.evaluate(() => {
    const label = document.querySelector('label[for="email"]');
    const input = document.getElementById('email');
    return DI.xpath.axes(label, input);
  });
  assert.ok(out.length > 0);
  assert.ok(out.every((a) => a.count > 0));
  assert.ok(out.some((a) => a.strategy === 'following-sibling'));
});

test('xpath: shadow DOM is explicitly unsupported', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return { candidates: DI.xpath.candidates(el), best: DI.xpath.best(el), abs: DI.xpath.absoluteXPath(el) };
  });
  assert.equal(out.candidates.length, 0);
  assert.equal(out.best, null);
  assert.equal(out.abs, null);
});

test('css: shadow-scoped selector is unique inside its root', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return { best: DI.css.best(el), chain: DI.css.shadowChain(el) };
  });
  assert.equal(out.best.selector, '#shadowbtn');
  assert.equal(out.best.count, 1);
  assert.ok(out.chain.length >= 1);
});

test('playwright: test id, role and label locators', async () => {
  const save = await page.evaluate(() => DI.playwright.generate(document.getElementById('save')));
  assert.ok(save.some((c) => c.selector.includes("getByTestId('save-btn')")));
  assert.ok(save.some((c) => c.selector.includes("getByRole('button'") && c.selector.includes('Save changes')));
  const email = await page.evaluate(() => DI.playwright.generate(document.getElementById('email')));
  assert.ok(email.some((c) => c.selector.includes("getByLabel('Email address')")));
  assert.ok(email.some((c) => c.selector.includes('getByPlaceholder')));
});

test('playwright: counts are computed against the live DOM', async () => {
  const n = await page.evaluate(() => DI.playwright.countExpr("page.getByTestId('save-btn')"));
  assert.equal(n, 1);
  const rows = await page.evaluate(() => DI.playwright.countExpr("page.locator('.rowbtn')"));
  assert.equal(rows, 2);
});

test('formats: selenium and cypress values', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('save');
    return { selenium: DI.formats.generate(el), formats: DI.formats.formats(el) };
  });
  assert.ok(out.selenium.find((r) => r.type === 'id' && r.value === 'save' && r.count === 1));
  assert.ok(out.selenium.find((r) => r.type === 'cssSelector' && r.count === 1));
  assert.ok(out.formats.find((r) => r.type === 'cypress-css' && r.code.startsWith('cy.get(')));
});

test('validate: css, xpath and playwright detection', async () => {
  const css = await page.evaluate(() => DI.validate.test('auto', '#save'));
  assert.equal(css.type, 'css');
  assert.equal(css.count, 1);
  const xp = await page.evaluate(() => DI.validate.test('auto', '//button[@id="save"]'));
  assert.equal(xp.type, 'xpath');
  assert.equal(xp.count, 1);
  const pw = await page.evaluate(() => DI.validate.test('playwright', "page.getByTestId('save-btn')"));
  assert.equal(pw.ok, true);
  assert.equal(pw.count, 1);
});

test('validate: invalid css reports an error', async () => {
  const out = await page.evaluate(() => DI.validate.test('css', 'div['));
  assert.equal(out.ok, false);
  assert.ok(out.error);
});

test('iframe: frameLocator prefix is generated inside a child frame', async () => {
  const frame = page.frames().find((f) => f.url().includes('srcdoc') || f !== page.mainFrame());
  assert.ok(frame, 'child frame exists');
  await frame.waitForSelector('#inner');
  await inject(frame);
  const out = await frame.evaluate(() => {
    const el = document.getElementById('inner');
    return {
      prefix: DI.playwright.framePrefix(),
      css: DI.css.best(el),
      pw: DI.playwright.generate(el).map((c) => c.selector)
    };
  });
  assert.equal(out.prefix.length, 1);
  assert.ok(out.prefix[0].startsWith('frameLocator('));
  assert.equal(out.css.count, 1);
  assert.ok(out.pw.some((s) => s.includes('frameLocator') && s.includes('getByTestId')));
});

test('manifest is valid MV3 with all content scripts present', () => {
  const fs = require('node:fs');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.background.service_worker);
  assert.ok(manifest.side_panel.default_path);
  assert.ok(manifest.devtools_page);
  for (const file of manifest.content_scripts[0].js) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), 'missing ' + file);
  }
});
