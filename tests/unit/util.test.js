'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, openFixture } = require('../helpers/harness');

let browser;
let page;

before(async () => {
  browser = await launchBrowser();
  page = await openFixture(browser, 'fixture.html');
});

after(async () => { if (browser) await browser.close(); });

test('normalizeText collapses and trims whitespace', async () => {
  assert.equal(await page.evaluate(() => DI.util.normalizeText('  a \n\t b  ')), 'a b');
  assert.equal(await page.evaluate(() => DI.util.normalizeText(null)), '');
});

test('cssEscape escapes identifiers that are not plain CSS', async () => {
  assert.equal(await page.evaluate(() => DI.util.cssEscape('a:b')), 'a\\:b');
  assert.match(await page.evaluate(() => DI.util.cssEscape('1st')), /^\\31 st$/);
  assert.equal(await page.evaluate(() => DI.util.cssEscape('plain-id')), 'plain-id');
});

test('xpathLiteral chooses the least escaping strategy', async () => {
  assert.equal(await page.evaluate(() => DI.util.xpathLiteral('plain')), "'plain'");
  assert.equal(await page.evaluate(() => DI.util.xpathLiteral("it's")), '"it\'s"');
  assert.equal(await page.evaluate(() => DI.util.xpathLiteral('say "hi"')), "'say \"hi\"'");
  const both = await page.evaluate(() => DI.util.xpathLiteral('a\'b"c'));
  assert.match(both, /^concat\(/);
  const resolves = await page.evaluate((literal) => {
    const el = document.createElement('p');
    el.textContent = 'a\'b"c';
    document.body.appendChild(el);
    const result = document.evaluate(`//p[normalize-space()=${literal}]`, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const found = result.snapshotLength === 1 && result.snapshotItem(0) === el;
    el.remove();
    return found;
  }, both);
  assert.equal(resolves, true);
});

test('attr trims values and never returns null', async () => {
  assert.equal(await page.evaluate(() => DI.util.attr(document.getElementById('save'), 'id')), 'save');
  assert.equal(await page.evaluate(() => DI.util.attr(document.getElementById('save'), 'missing')), '');
});

test('tagOf lowercases tag names', async () => {
  assert.equal(await page.evaluate(() => DI.util.tagOf(document.getElementById('save'))), 'button');
});

test('deepQueryAll and deepEveryElement pierce open shadow roots', async () => {
  const out = await page.evaluate(() => ({
    query: DI.util.deepQueryAll('#shadowbtn').length,
    every: DI.util.deepEveryElement(document, []).some((el) => el.id === 'shadowbtn')
  }));
  assert.equal(out.query, 1);
  assert.equal(out.every, true);
});

test('shadow helpers report the host chain', async () => {
  const out = await page.evaluate(() => {
    const el = document.querySelector('#host').shadowRoot.getElementById('shadowbtn');
    return {
      inShadow: DI.util.isInShadow(el),
      hosts: DI.util.shadowHosts(el).map((host) => host.id),
      rootIsShadow: DI.util.rootOf(el) === el.getRootNode()
    };
  });
  assert.equal(out.inShadow, true);
  assert.deepEqual(out.hosts, ['host']);
  assert.equal(out.rootIsShadow, true);
});

test('directText ignores descendant text', async () => {
  const out = await page.evaluate(() => {
    const el = document.createElement('div');
    el.innerHTML = 'own <span>child</span> text';
    return DI.util.directText(el);
  });
  assert.equal(out, 'own text');
});

test('isVisible reflects display, visibility and layout', async () => {
  const out = await page.evaluate(() => {
    const visible = document.createElement('button');
    const hidden = document.createElement('button');
    visible.textContent = 'v';
    hidden.textContent = 'h';
    hidden.style.display = 'none';
    document.body.append(visible, hidden);
    const result = { visible: DI.util.isVisible(visible), hidden: DI.util.isVisible(hidden) };
    visible.remove();
    hidden.remove();
    return result;
  });
  assert.equal(out.visible, true);
  assert.equal(out.hidden, false);
});

test('iframeChain is empty in the top document', async () => {
  assert.equal(await page.evaluate(() => DI.util.iframeChain().length), 0);
});

test('svg helpers distinguish SVG nodes from HTML', async () => {
  const out = await page.evaluate(() => ({
    circleSvg: DI.util.isSvg(document.getElementById('dot')),
    svgRoot: DI.util.isSvg(document.getElementById('iconsvg')),
    divSvg: DI.util.isSvg(document.getElementById('save')),
    circleChild: DI.util.isSvgChild(document.getElementById('dot')),
    divChild: DI.util.isSvgChild(document.getElementById('save'))
  }));
  assert.equal(out.circleSvg, true);
  assert.equal(out.svgRoot, true);
  assert.equal(out.divSvg, false);
  assert.equal(out.circleChild, true);
  assert.equal(out.divChild, false);
});

test('cssAttr escapes backslashes, quotes and control whitespace', async () => {
  const out = await page.evaluate(() => ({
    plain: DI.util.cssAttr('a"b'),
    backslash: DI.util.cssAttr('a\\b'),
    newline: DI.util.cssAttr('a\nb'),
    carriage: DI.util.cssAttr('a\rb'),
    formfeed: DI.util.cssAttr('a\fb')
  }));
  assert.equal(out.plain, 'a\\"b');
  assert.equal(out.backslash, 'a\\\\b');
  assert.equal(out.newline, 'a\\a b');
  assert.equal(out.carriage, 'a\\d b');
  assert.equal(out.formfeed, 'a\\c b');
});
