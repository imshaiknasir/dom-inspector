const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, fixtureUrl, GENERATOR_SCRIPTS } = require('./helpers/harness');

const FIXTURE = fixtureUrl();

let browser, page;
before(async () => {
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.goto(FIXTURE);
  for (const file of GENERATOR_SCRIPTS) await page.addScriptTag({ path: file });
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
  assert.deepEqual(out.locators.frameCss, ['#frame']);
  assert.ok(out.locators.frameXpath[0].includes("'frame'"));
  assert.ok(out.locators.playwright.includes('frameLocator('));
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

test('playwright: getByText is not emitted when only a descendant matches', async () => {
  const out = await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'nested-button';
    button.innerHTML = '<span>Nested label</span>';
    document.body.appendChild(button);
    const selectors = DI.playwright.generate(button).map((c) => c.selector);
    const descendantCount = DI.playwright.countExpr("page.getByText('Nested label')");
    button.remove();
    return { selectors, descendantCount };
  });
  assert.ok(out.selectors.some((s) => s.includes("locator('#nested-button')")));
  assert.ok(!out.selectors.some((s) => s.includes("getByText('Nested label')")));
  assert.equal(out.descendantCount, 1);
});

test('css: duplicate ids never produce a selector for the wrong node', async () => {
  const out = await page.evaluate(() => {
    const first = document.createElement('div');
    first.id = 'dup-id';
    const second = document.createElement('div');
    second.id = 'dup-id';
    first.textContent = 'first';
    second.textContent = 'second';
    document.body.append(first, second);
    const best = DI.css.best(second);
    const hit = best ? document.querySelector(best.selector) === second : false;
    first.remove(); second.remove();
    return { best, hit };
  });
  assert.ok(out.best);
  assert.equal(out.best.count, 1);
  assert.equal(out.hit, true);
});

test('xpath: candidates report whether they select the target node', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('save');
    const best = DI.xpath.best(el);
    const nodes = DI.xpath.snapshot(best.xpath);
    return { best, hits: nodes.includes(el), count: nodes.length };
  });
  assert.equal(out.best.selectsTarget, true);
  assert.equal(out.hits, true);
  assert.equal(out.count, 1);
});

test('repair: closes quotes before brackets', async () => {
  const out = await page.evaluate(() => ({
    xpath: DI.repair.normalize("//a[text()='x"),
    paren: DI.repair.normalize("//div[contains(text(),'x'"),
    css: DI.repair.normalize("div[data-x='y'")
  }));
  assert.equal(out.xpath, "//a[text()='x']");
  assert.equal(out.paren, "//div[contains(text(),'x')]");
  assert.equal(out.css, "div[data-x='y']");
});

test('playwright: shadow elements get a host-scoped locator chain', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    const selectors = DI.playwright.generate(el).map((c) => c.selector);
    const chain = selectors.find((s) => s.includes("locator('#host')") && s.includes("locator('#shadowbtn')"));
    return { chain, count: chain ? DI.playwright.countExpr(chain) : 0, validated: chain ? DI.validate.test('playwright', chain) : null };
  });
  assert.ok(out.chain);
  assert.equal(out.count, 1);
  assert.equal(out.validated.count, 1);
});

test('playwright: regex role names containing a slash are counted', async () => {
  const out = await page.evaluate(() => {
    const b = document.createElement('button');
    b.textContent = 'Save / continue';
    document.body.appendChild(b);
    const expr = "page.getByRole('button', { name: /Save \\/ continue/i })";
    const count = DI.playwright.countExpr(expr);
    const validated = DI.validate.test('playwright', expr);
    b.remove();
    return { count, validated };
  });
  assert.equal(out.count, 1);
  assert.equal(out.validated.count, 1);
});

test('playwright: attribute values containing backslashes are escaped', async () => {
  const out = await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'slash-input';
    input.setAttribute('placeholder', 'a\\b');
    document.body.appendChild(input);
    const generated = DI.playwright.generate(input).map((c) => c.selector);
    const count = DI.playwright.countExpr("page.getByPlaceholder('a\\\\b')");
    const validated = DI.validate.test('playwright', "page.getByPlaceholder('a\\\\b')");
    input.remove();
    return { generated, count, validated };
  });
  assert.equal(out.count, 1);
  assert.equal(out.validated.count, 1);
  assert.ok(out.generated.some((s) => s.includes('getByPlaceholder')));
});

test('css: data-test-id is a preferred attribute', async () => {
  const out = await page.evaluate(() => {
    const el = document.createElement('button');
    el.id = 'testid-button';
    el.setAttribute('data-test-id', 'confirm');
    document.body.appendChild(el);
    const candidates = DI.css.candidates(el);
    el.remove();
    return candidates.map((c) => c.selector);
  });
  assert.ok(out.some((s) => s.includes('[data-test-id="confirm"]')));
});

test('repair: a valid non-element XPath does not crash', async () => {
  const out = await page.evaluate(() => DI.repair.fix("//button[@id='save']/text()"));
  assert.equal(out.ok, true);
  assert.equal(out.locators, null);
});

test('validate: auto detects locator() as Playwright', async () => {
  const out = await page.evaluate(() => ({
    type: DI.validate.detectType("locator('#save')"),
    result: DI.validate.test('auto', "locator('#save')")
  }));
  assert.equal(out.type, 'playwright');
  assert.equal(out.result.ok, true);
  assert.equal(out.result.count, 1);
});

test('playwright: :has-text escapes backslashes and quotes', async () => {
  const out = await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'odd-text';
    b.textContent = 'a\\b "quoted"';
    document.body.appendChild(b);
    const selector = DI.playwright.generate(b).map((c) => c.selector).find((s) => s.includes(':has-text('));
    const count = selector ? DI.playwright.countExpr(selector) : 0;
    const validated = selector ? DI.validate.test('playwright', selector) : null;
    b.remove();
    return { selector, count, validated };
  });
  assert.ok(out.selector);
  assert.equal(out.count, 1);
  assert.equal(out.validated.count, 1);
});

test('playwright: accessible names with quotes are counted and validated', async () => {
  const out = await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'quote-name';
    b.textContent = 'Save "draft"';
    document.body.appendChild(b);
    const expr = "page.getByRole('button', { name: 'Save \\\"draft\\\"', exact: true })";
    const count = DI.playwright.countExpr(expr);
    const validated = DI.validate.test('playwright', expr);
    b.remove();
    return { count, validated };
  });
  assert.equal(out.count, 1);
  assert.equal(out.validated.count, 1);
});

test('repair: a valid selector with repeated spaces is returned unchanged', async () => {
  const out = await page.evaluate(() => {
    const el = document.createElement('button');
    el.id = 'spaced-title';
    el.setAttribute('title', 'a  b');
    document.body.appendChild(el);
    const original = 'button[title="a  b"]';
    const fixed = DI.repair.fix(original);
    el.remove();
    return { fixed, ok: fixed.ok };
  });
  assert.equal(out.ok, true);
  assert.equal(out.fixed.fixed, 'button[title="a  b"]');
  assert.equal(out.fixed.repaired, false);
});

test('playwright: unlabelled iframe gets a CSS-based frameLocator', async () => {
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<button id="plainframe-btn">Plain frame</button>';
    document.body.appendChild(frame);
  });
  let target = null;
  for (let i = 0; i < 50 && !target; i += 1) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      if (await frame.$('#plainframe-btn')) { target = frame; break; }
    }
    if (!target) await page.waitForTimeout(50);
  }
  assert.ok(target);
  for (const file of GENERATOR_SCRIPTS) await target.addScriptTag({ path: file });
  const out = await target.evaluate(() => ({
    prefix: DI.playwright.framePrefix(),
    css: DI.css.best(window.frameElement).selector
  }));
  assert.equal(out.prefix.length, 1);
  assert.equal(out.prefix[0], `frameLocator('${out.css.replace(/'/g, "\\'")}')`);
  assert.ok(out.css.includes('nth-of-type') || out.css.includes('iframe'));
  await page.evaluate(() => document.querySelectorAll('iframe[srcdoc]')[1]?.remove());
});

test('repair: brackets inside quoted values do not count as structure', async () => {
  const out = await page.evaluate(() => {
    const el = document.createElement('button');
    el.id = 'bracket-title';
    el.setAttribute('title', 'a[b');
    document.body.appendChild(el);
    const original = 'button[title="a[b"]';
    const result = DI.repair.fix(original);
    el.remove();
    return { result, normalized: DI.repair.normalize(original) };
  });
  assert.equal(out.result.ok, true);
  assert.equal(out.result.fixed, 'button[title="a[b"]');
  assert.equal(out.normalized, 'button[title="a[b"]');
});
