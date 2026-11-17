'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture } = require('../helpers/harness');

let browser;
let page;
let escaping;
let duplicates;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
  escaping = await openFixture(browser, 'fixtures/escaping.html');
  duplicates = await openFixture(browser, 'fixtures/duplicates.html');
});

after(async () => { if (browser) await browser.close(); });

const candidatesOf = (target, id) => target.evaluate((elementId) => {
  const el = document.getElementById(elementId);
  return DI.css.candidates(el).map((candidate) => {
    let actual = -1;
    try {
      actual = el.getRootNode().querySelectorAll(candidate.selector).length;
    } catch (_) {
      actual = -1;
    }
    return { ...candidate, actual };
  });
}, id);

test('css: id is the best unique selector', async () => {
  const result = await page.evaluate(() => DI.css.best(document.getElementById('save')));
  assert.equal(result.selector, '#save');
  assert.equal(result.count, 1);
  assert.equal(result.strategy, 'id');
});

test('css: every reported count matches its selector in the element tree', async () => {
  for (const id of ['save', 'link', 'email', 'dynbox']) {
    const candidates = await candidatesOf(page, id);
    assert.ok(candidates.length > 0, `no candidates for #${id}`);
    for (const candidate of candidates) {
      assert.equal(candidate.count, candidate.actual, `${candidate.selector} count`);
      assert.ok(candidate.selector.length > 0);
    }
  }
});

test('css: duplicate button classes are disambiguated to a unique path', async () => {
  const result = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Other');
    const candidate = DI.css.best(el);
    return { candidate, matches: Array.from(el.getRootNode().querySelectorAll(candidate.selector)) };
  });
  assert.equal(result.candidate.count, 1);
  assert.ok(result.candidate.selector.includes('nth-of-type') || result.candidate.selector.includes('#'));
});

test('css: best selector resolves back to the element', async () => {
  const out = await page.evaluate(() => {
    const ids = ['save', 'link', 'email', 'dynbox'];
    return ids.map((id) => {
      const el = document.getElementById(id);
      const best = DI.css.best(el);
      const nodes = Array.from(el.getRootNode().querySelectorAll(best.selector));
      return { id, count: best.count, resolves: nodes.length === 1 && nodes[0] === el };
    });
  });
  for (const item of out) {
    assert.equal(item.count, 1, item.id);
    assert.equal(item.resolves, true, item.id);
  }
});

test('css: generated dynamic classes are filtered from candidates', async () => {
  const candidates = await page.evaluate(() => DI.css.candidates(document.getElementById('dynbox')).map((c) => c.selector));
  assert.ok(!candidates.some((selector) => selector.includes('css-1a2b3c4d')));
  assert.ok(candidates.includes('#dynbox'));
});

test('css: looksGenerated rejects hashes and generated class prefixes', async () => {
  const out = await page.evaluate(() => ({
    dynamic: DI.css.looksGenerated('css-1a2b3c4d'),
    hash: DI.css.looksGenerated('550e8400-e29b-41d4-a716-446655440000'),
    numeric: DI.css.looksGenerated('12345'),
    empty: DI.css.looksGenerated(''),
    stable: DI.css.looksGenerated('save'),
    long: DI.css.looksGenerated('x'.repeat(80))
  }));
  assert.equal(out.dynamic, true);
  assert.equal(out.hash, true);
  assert.equal(out.numeric, true);
  assert.equal(out.empty, true);
  assert.equal(out.stable, false);
  assert.equal(out.long, true);
});

test('css: absolutePath and ancestorPath resolve exactly', async () => {
  const out = await page.evaluate(() => {
    const el = document.getElementById('save');
    const check = (selector) => {
      const nodes = Array.from(el.getRootNode().querySelectorAll(selector));
      return { selector, count: nodes.length, same: nodes.length === 1 && nodes[0] === el };
    };
    return { absolute: check(DI.css.absolutePath(el)), ancestor: check(DI.css.ancestorPath(el)) };
  });
  assert.equal(out.absolute.same, true, out.absolute.selector);
  assert.equal(out.ancestor.same, true, out.ancestor.selector);
});

test('css: shadow-scoped selectors count only inside their root', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return { best: DI.css.best(el), chain: DI.css.shadowChain(el) };
  });
  assert.equal(out.best.selector, '#shadowbtn');
  assert.equal(out.best.count, 1);
  assert.deepEqual(out.chain, ['#host']);
});

test('css: identical ids in document and shadow root stay scoped', async () => {
  const out = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="save">Shadow save</button>';
    const shadowEl = root.getElementById('save');
    const best = DI.css.best(shadowEl);
    const result = { selector: best.selector, count: best.count, documentMatches: document.querySelectorAll(best.selector).length };
    host.remove();
    return result;
  });
  assert.equal(out.selector, '#save');
  assert.equal(out.count, 1);
  assert.equal(out.documentMatches, 1);
});

test('css: attribute values are escaped for quotes and backslashes', async () => {
  const candidates = await escaping.evaluate(() => {
    const el = document.getElementById('quoted');
    return DI.css.candidates(el).map((candidate) => {
      let actual = -1;
      try { actual = el.getRootNode().querySelectorAll(candidate.selector).length; } catch (_) { actual = -1; }
      return { selector: candidate.selector, count: candidate.count, actual, strategy: candidate.strategy };
    });
  });
  const testId = candidates.find((candidate) => candidate.strategy === 'attr:data-testid');
  assert.ok(testId, 'data-testid candidate exists');
  assert.ok(testId.selector.includes('\\"'), testId.selector);
  assert.equal(testId.count, 1);
  assert.equal(testId.actual, 1);
});

test('css: escaped ids and classes remain valid selectors', async () => {
  const out = await escaping.evaluate(() => {
    const colon = document.getElementById('a:b');
    const best = DI.css.best(colon);
    return {
      selector: best.selector,
      count: best.count,
      resolves: Array.from(document.querySelectorAll(best.selector)).length === 1
    };
  });
  assert.equal(out.selector, '#a\\:b');
  assert.equal(out.count, 1);
  assert.equal(out.resolves, true);
});

test('css: ambiguous siblings still get a unique selector', async () => {
  const out = await duplicates.evaluate(() => {
    const buttons = [...document.querySelectorAll('.ghostbtn')];
    const third = buttons[2];
    const best = DI.css.best(third);
    return { best, nodes: Array.from(document.querySelectorAll(best.selector)).map((el) => el === third) };
  });
  assert.equal(out.best.count, 1);
  assert.equal(out.nodes.length, 1);
  assert.equal(out.nodes[0], true);
});

test('css: shadowChain lists nested hosts from innermost to outermost', async () => {
  const out = await page.evaluate(() => {
    const outer = document.createElement('div');
    outer.id = 'outer-host';
    document.body.appendChild(outer);
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    inner.id = 'inner-host';
    outerRoot.appendChild(inner);
    const innerRoot = inner.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = '<button id="deep-btn">Deep</button>';
    const el = innerRoot.getElementById('deep-btn');
    const result = { best: DI.css.best(el), chain: DI.css.shadowChain(el) };
    outer.remove();
    return result;
  });
  assert.equal(out.best.selector, '#deep-btn');
  assert.equal(out.best.count, 1);
  assert.deepEqual(out.chain, ['#inner-host', '#outer-host']);
});

test('css: control whitespace in attribute values stays escaped', async () => {
  const out = await escaping.evaluate(() => {
    const rows = [];
    for (const id of ['multiline', 'carriage']) {
      const el = document.getElementById(id);
      rows.push(...DI.css.candidates(el).map((candidate) => ({
        id,
        selector: candidate.selector,
        strategy: candidate.strategy,
        resolves: (() => {
          try { return document.querySelector(candidate.selector) === el; } catch (_) { return false; }
        })()
      })));
    }
    return rows;
  });
  const attributeRows = out.filter((row) => row.strategy.startsWith('attr:'));
  assert.equal(attributeRows.length, 3);
  for (const row of attributeRows) assert.equal(row.resolves, true, row.selector);
});
