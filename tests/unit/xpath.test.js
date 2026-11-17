'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture, injectGenerators } = require('../helpers/harness');

let browser;
let page;
let escaping;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
  escaping = await openFixture(browser, 'fixtures/escaping.html');
});

after(async () => { if (browser) await browser.close(); });

const candidatesOf = (target, id) => target.evaluate((elementId) => {
  const el = document.getElementById(elementId);
  return DI.xpath.candidates(el).map((candidate) => ({ ...candidate, hits: DI.xpath.snapshot(candidate.xpath).includes(el) }));
}, id);

test('xpath: id-based relative selector is unique', async () => {
  const result = await page.evaluate(() => DI.xpath.best(document.getElementById('save')));
  assert.equal(result.count, 1);
  assert.equal(result.xpath, "//*[@id='save']");
});

test('xpath: absolute path starts at /html and resolves exactly', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('save');
    const xpath = DI.xpath.absoluteXPath(el);
    const nodes = DI.xpath.snapshot(xpath);
    return { xpath, count: nodes.length, same: nodes.length === 1 && nodes[0] === el };
  });
  assert.ok(out.xpath.startsWith('/html'));
  assert.equal(out.count, 1);
  assert.equal(out.same, true);
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
  assert.ok(out.indexed.xpath.startsWith('('));
  assert.ok(out.indexed.position > 0);
});

test('xpath: text and contains variants exist for a link', async () => {
  const variants = await page.evaluate(() => DI.xpath.candidates(document.getElementById('link')).map((c) => c.xpath));
  assert.ok(variants.some((xpath) => xpath.includes('normalize-space()')));
  assert.ok(variants.some((xpath) => xpath.includes('contains')));
});

test('xpath: every count reports a selector that actually selects the element', async () => {
  for (const id of ['save', 'link', 'email']) {
    for (const candidate of await candidatesOf(page, id)) {
      if (candidate.count === 0) continue;
      assert.equal(candidate.hits, true, `${candidate.strategy}: ${candidate.xpath}`);
    }
  }
});

test('xpath: text with both quote styles uses concat and stays unique', async () => {
  const out = await escaping.evaluate(() => {
    const el = document.getElementById('quoteText');
    const candidates = DI.xpath.candidates(el);
    const text = candidates.find((candidate) => candidate.strategy === 'text');
    return {
      xpath: text && text.xpath,
      count: text && text.count,
      nodes: text ? DI.xpath.snapshot(text.xpath) : []
    };
  });
  assert.ok(out.xpath, 'text candidate exists');
  assert.ok(out.xpath.includes('concat('), out.xpath);
  assert.equal(out.count, 1);
  assert.equal(out.nodes.length, 1);
});

test('xpath: axes from label to its input resolve to the target', async () => {
  const out = await page.evaluate(() => {
    const label = document.querySelector('label[for="email"]');
    const input = document.getElementById('email');
    return DI.xpath.axes(label, input).map((axis) => ({
      ...axis,
      hits: DI.xpath.snapshot(axis.xpath).includes(input)
    }));
  });
  assert.ok(out.length > 0);
  for (const axis of out) {
    assert.ok(axis.count > 0, axis.xpath);
    assert.equal(axis.hits, true, axis.xpath);
  }
  assert.ok(out.some((axis) => axis.strategy === 'following-sibling'));
});

test('xpath: shadow DOM is explicitly unsupported', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return { candidates: DI.xpath.candidates(el), best: DI.xpath.best(el), abs: DI.xpath.absoluteXPath(el), indexed: DI.xpath.indexed(el) };
  });
  assert.deepEqual(out.candidates, []);
  assert.equal(out.best, null);
  assert.equal(out.abs, null);
  assert.equal(out.indexed, null);
});

test('xpath: segment() uses local-name() for SVG nodes', async () => {
  const out = await page.evaluate(() => {
    const circle = document.getElementById('dot');
    return { segment: DI.xpath.segment(circle), div: DI.xpath.segment(document.getElementById('save')) };
  });
  assert.ok(out.segment.includes("local-name()='circle'"), out.segment);
  assert.match(out.div, /^button/);
});

test('xpath: SVG elements still receive a usable id selector', async () => {
  const out = await page.evaluate(() => {
    const circle = document.getElementById('dot');
    const best = DI.xpath.best(circle);
    return { best, hits: best ? DI.xpath.snapshot(best.xpath).includes(circle) : false };
  });
  assert.ok(out.best);
  assert.equal(out.best.count, 1);
  assert.equal(out.hits, true);
});

test('xpath: positional fallback works when no id is present', async () => {
  const out = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Other');
    const positional = DI.xpath.candidates(el).find((candidate) => candidate.strategy === 'positional');
    return { positional, hits: positional ? DI.xpath.snapshot(positional.xpath).includes(el) : false };
  });
  assert.ok(out.positional);
  assert.equal(out.positional.count, 1);
  assert.equal(out.hits, true);
});

test('xpath: frameXPath names the iframe from inside a child frame', async () => {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  assert.ok(frame, 'child frame exists');
  await frame.waitForSelector('#inner');
  await injectGenerators(frame);
  const out = await frame.evaluate(() => ({
    chain: DI.util.iframeChain().length,
    frameXPath: DI.xpath.frameXPath()
  }));
  assert.equal(out.chain, 1);
  assert.ok(out.frameXPath);
  assert.equal(out.frameXPath.frames, 1);
  assert.equal(out.frameXPath.xpath, "//iframe[@id='frame']");
});

test('xpath: positional selector for an element with an id stays valid', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('save');
    const positional = DI.xpath.candidates(el).find((candidate) => candidate.strategy === 'positional');
    return { positional, hits: positional ? DI.xpath.snapshot(positional.xpath).includes(el) : false };
  });
  assert.ok(out.positional);
  assert.equal(out.positional.count, 1);
  assert.equal(out.hits, true);
});

test('xpath: absolute SVG path resolves through local-name()', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('dot');
    const xpath = DI.xpath.absoluteXPath(el);
    return { xpath, count: DI.xpath.count(xpath), hits: DI.xpath.snapshot(xpath).includes(el) };
  });
  assert.equal(out.count, 1);
  assert.equal(out.hits, true);
});

test('xpath: optimize only returns paths that still match exactly one node', async () => {
  const out = await page.evaluate(() => {
    const inputs = [
      '//body[1]/div[1]/input[1]',
      '//html/body[1]/div[1]/input[1]',
      '//body[1]/table[1]/tbody[1]/tr[1]/td[2]/button[1]'
    ];
    return inputs.map((xpath) => {
      const optimized = DI.xpath.optimize(xpath);
      return { xpath, optimized, count: DI.xpath.count(optimized) };
    });
  });
  for (const item of out) {
    assert.ok(item.optimized.startsWith('//'), item.optimized);
    if (item.optimized !== item.xpath) assert.equal(item.count, 1, item.optimized);
  }
});

test('xpath: inShadow reports tree scope', async () => {
  const out = await page.evaluate(() => ({
    shadow: DI.xpath.inShadow(document.querySelector('#host').shadowRoot.getElementById('shadowbtn')),
    light: DI.xpath.inShadow(document.getElementById('save'))
  }));
  assert.equal(out.shadow, true);
  assert.equal(out.light, false);
});

test('xpath: frameXPath chains nested frames', async () => {
  const local = await browser.newPage();
  try {
    await local.setContent(`<!doctype html><html><body>
      <iframe id="outer" srcdoc="<!doctype html><body>
        <iframe id='inner' srcdoc='<!doctype html><button id=deep>Deep</button>'></iframe>
      </body>"></iframe>
    </body></html>`);
    await local.waitForTimeout(400);
    const deepest = local.frames()[local.frames().length - 1];
    await injectGenerators(deepest);
    const out = await deepest.evaluate(() => DI.xpath.frameXPath());
    assert.equal(out.frames, 2);
    assert.equal(out.xpath, "//iframe[@id='outer'] >> //iframe[@id='inner']");
  } finally {
    await local.close();
  }
});
