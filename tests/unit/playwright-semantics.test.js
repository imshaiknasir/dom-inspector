'use strict';

/* Cross-checks the local Playwright counting engine (and the panel action
   runner) against the real Playwright locator engine for ARIA semantics.
   Cases that still diverge are marked todo and tracked in ../../BLOCKERS.md. */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, launchBrowser, injectGenerators } = require('../helpers/harness');

const FIXTURE = `<!doctype html>
<html><body>
  <header id="top">Site header</header>
  <main>
    <article>
      <header id="art">Article header</header>
      <footer id="artf">Article footer</footer>
    </article>
    <section id="sec1" aria-labelledby="hx"><h2 id="hx">Named by id</h2></section>
    <section id="sec2" aria-label="Named label">Named section</section>
    <section id="sec3">unnamed section</section>
    <form id="f1"><input id="q1" name="q"></form>
    <form id="f2" aria-label="Search form"><input id="q2" name="r"></form>
    <button id="btn">Save</button>
    <a id="link" href="/docs">Docs</a>
    <a id="nolink">No href</a>
    <input id="check" type="checkbox">
    <input id="rad" type="radio">
    <input id="range" type="range" value="30">
    <input id="num" type="number">
    <input id="search" type="search">
    <input id="email" type="email">
    <input id="pass" type="password">
    <input id="file" type="file">
    <input id="hidden" type="hidden">
    <select id="sel"></select>
    <select id="multi" multiple></select>
    <textarea id="ta"></textarea>
    <table id="tbl">
      <thead><tr><th>Head</th></tr></thead>
      <tbody><tr><td>Cell</td></tr></tbody>
    </table>
    <h2 id="head2">Top heading</h2>
    <img id="img" alt="Logo">
    <img id="deco" alt="">
    <span id="lbl-a">First</span><span id="lbl-b">Second</span>
    <button id="labelled" aria-labelledby="lbl-a lbl-b">Ignored</button>
    <p id="marker">TEXT_MARKER</p>
    <script>const marker = "TEXT_MARKER";</script>
  </main>
  <footer id="bot">Site footer</footer>
</body></html>`;

let browser;
let page;

before(async () => {
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.setContent(FIXTURE);
  await injectGenerators(page);
  await page.addScriptTag({ path: path.join(ROOT, 'src/panel/panel-actions.js') });
});

after(async () => { if (browser) await browser.close(); });

const diCount = (expr) => page.evaluate((value) => DI.playwright.countExpr(value), expr);
const realCount = (role) => page.getByRole(role).count();
const panelCount = (expr) => page.evaluate((value) =>
  DIPanel.pageAction('click', 'playwright', value, '', false).matched, expr);

test('playwright: role counts agree with Playwright for common roles', async () => {
  const roles = [
    'link', 'checkbox', 'radio', 'slider', 'spinbutton', 'searchbox',
    'combobox', 'listbox', 'heading', 'table', 'cell', 'columnheader',
    'row', 'img', 'list', 'listitem', 'navigation', 'main', 'article', 'group'
  ];
  for (const role of roles) {
    const expr = `page.getByRole('${role}')`;
    const [local, real, panel] = await Promise.all([diCount(expr), realCount(role), panelCount(expr)]);
    assert.equal(local, real, `generator count for ${role}`);
    assert.equal(panel, real, `panel action count for ${role}`);
  }
});

test('playwright: labelledByText joins ids and drives the accessible name', async () => {
  const out = await page.evaluate(() => ({
    joined: DI.playwright.labelledByText(document.getElementById('labelled')),
    name: DI.playwright.accessibleName(document.getElementById('labelled')),
    image: DI.playwright.accessibleName(document.getElementById('img')),
    decorative: DI.playwright.accessibleName(document.getElementById('deco'))
  }));
  assert.equal(out.joined, 'First Second');
  assert.equal(out.name, 'First Second');
  assert.equal(out.image, 'Logo');
  assert.equal(out.decorative, '');
  assert.equal(await page.getByRole('button', { name: 'First Second' }).count(), 1);
});

test('playwright: exact getByText count matches Playwright', async () => {
  const expr = "page.getByText('TEXT_MARKER', { exact: true })";
  const [local, real] = await Promise.all([diCount(expr), page.getByText('TEXT_MARKER', { exact: true }).count()]);
  assert.equal(local, real);
});

test('playwright: getByText ignores script and style text like Playwright', async () => {
  const expr = "page.getByText('TEXT_MARKER')";
  const [local, real, validated] = await Promise.all([
    diCount(expr),
    page.getByText('TEXT_MARKER').count(),
    page.evaluate((value) => DI.validate.test('playwright', value).count, expr)
  ]);
  assert.equal(local, real);
  assert.equal(validated, real);
});

test('playwright: sectioning roots follow Playwright scoping', async () => {
  const [region, banner, contentinfo, panelBanner, panelContentinfo] = await Promise.all([
    diCount("page.getByRole('region')"),
    diCount("page.getByRole('banner')"),
    diCount("page.getByRole('contentinfo')"),
    panelCount("page.getByRole('banner')"),
    panelCount("page.getByRole('contentinfo')")
  ]);
  assert.deepEqual(
    { region, banner, contentinfo, panelBanner, panelContentinfo },
    {
      region: await realCount('region'),
      banner: await realCount('banner'),
      contentinfo: await realCount('contentinfo'),
      panelBanner: await realCount('banner'),
      panelContentinfo: await realCount('contentinfo')
    }
  );
});

test('playwright: only named forms expose the form role', async () => {
  const [form, panelForm] = await Promise.all([
    diCount("page.getByRole('form')"),
    panelCount("page.getByRole('form')")
  ]);
  assert.deepEqual({ form, panelForm }, { form: await realCount('form'), panelForm: await realCount('form') });
});

test('playwright: hidden inputs have no role and file inputs are buttons', async () => {
  const [textbox, button, panelTextbox, panelButton] = await Promise.all([
    diCount("page.getByRole('textbox')"),
    diCount("page.getByRole('button')"),
    panelCount("page.getByRole('textbox')"),
    panelCount("page.getByRole('button')")
  ]);
  assert.deepEqual(
    { textbox, button, panelTextbox, panelButton },
    {
      textbox: await realCount('textbox'),
      button: await realCount('button'),
      panelTextbox: await realCount('textbox'),
      panelButton: await realCount('button')
    }
  );
});

test('playwright: accessible names fall back to title and role contents', async () => {
  const extra = await page.evaluate(() => {
    const titleButton = document.createElement('button');
    titleButton.id = 'title-only';
    titleButton.title = 'Title button';
    const custom = document.createElement('div');
    custom.id = 'custom-button';
    custom.setAttribute('role', 'button');
    custom.tabIndex = 0;
    custom.textContent = 'Custom button';
    document.body.append(titleButton, custom);
    const result = {
      title: DI.playwright.accessibleName(titleButton),
      contents: DI.playwright.accessibleName(custom),
      titleCount: DI.playwright.countExpr("page.getByRole('button', { name: 'Title button' })"),
      customCount: DI.playwright.countExpr("page.getByRole('button', { name: 'Custom button' })"),
      panelTitle: DIPanel.pageAction('click', 'playwright', "page.getByRole('button', { name: 'Title button' })", '', false).matched,
      panelCustom: DIPanel.pageAction('click', 'playwright', "page.getByRole('button', { name: 'Custom button' })", '', false).matched
    };
    titleButton.remove();
    custom.remove();
    return result;
  });
  assert.deepEqual(extra, {
    title: 'Title button',
    contents: 'Custom button',
    titleCount: 1,
    customCount: 1,
    panelTitle: 1,
    panelCustom: 1
  });
});

const HIDDEN_FIXTURE = `<!doctype html><html><body>
  <button id="shown">Save</button>
  <button id="display" style="display:none">Save</button>
  <button id="visibility" style="visibility:hidden">Save</button>
  <button id="aria" aria-hidden="true">Save</button>
  <div hidden><button id="attr">Save</button></div>
  <dialog id="closed">Closed</dialog>
</body></html>`;

const openHiddenFixture = async () => {
  const hiddenPage = await browser.newPage();
  await hiddenPage.setContent(HIDDEN_FIXTURE);
  await injectGenerators(hiddenPage);
  await hiddenPage.addScriptTag({ path: path.join(ROOT, 'src/panel/panel-actions.js') });
  return hiddenPage;
};

test('playwright: role counts exclude hidden and aria-hidden nodes', async () => {
  const hiddenPage = await openHiddenFixture();
  try {
    const out = await hiddenPage.evaluate(() => ({
      buttons: DI.playwright.countExpr("page.getByRole('button', { name: 'Save' })"),
      dialog: DI.playwright.countExpr("page.getByRole('dialog')"),
      validated: DI.validate.test('playwright', "page.getByRole('button', { name: 'Save' })").count
    }));
    assert.deepEqual(out, {
      buttons: await hiddenPage.getByRole('button', { name: 'Save' }).count(),
      dialog: await hiddenPage.getByRole('dialog').count(),
      validated: await hiddenPage.getByRole('button', { name: 'Save' }).count()
    });
  } finally {
    await hiddenPage.close();
  }
});

test('panel actions: role matching excludes hidden and aria-hidden nodes', { todo: 'panel-actions still counts hidden nodes' }, async () => {
  const hiddenPage = await openHiddenFixture();
  try {
    const panel = await hiddenPage.evaluate(() =>
      DIPanel.pageAction('click', 'playwright', "page.getByRole('button', { name: 'Save' })", '', false).matched);
    assert.equal(panel, await hiddenPage.getByRole('button', { name: 'Save' }).count());
  } finally {
    await hiddenPage.close();
  }
});

test('playwright: accessible names prefer title and read icon children', async () => {
  const iconsPage = await browser.newPage();
  try {
    await iconsPage.setContent(`<!doctype html><html><body>
      <input id="both" placeholder="Placeholder" title="Title">
      <a id="icon-link" href="#"><svg aria-label="Icon link"></svg></a>
      <button id="icon-button"><svg aria-label="Icon button"></svg></button>
      <fieldset id="ship"><legend>Shipping</legend><input></fieldset>
      <table id="people"><caption>People</caption><tr><td>Cell</td></tr></table>
      <figure id="figure"><img alt="Logo"><figcaption>Figure one</figcaption></figure>
    </body></html>`);
    await injectGenerators(iconsPage);
    const out = await iconsPage.evaluate(() => ({
      titleName: DI.playwright.accessibleName(document.getElementById('both')),
      linkName: DI.playwright.accessibleName(document.getElementById('icon-link')),
      buttonName: DI.playwright.accessibleName(document.getElementById('icon-button')),
      titleCount: DI.playwright.countExpr("page.getByRole('textbox', { name: 'Title', exact: true })"),
      linkCount: DI.playwright.countExpr("page.getByRole('link', { name: 'Icon link' })"),
      buttonCount: DI.playwright.countExpr("page.getByRole('button', { name: 'Icon button' })"),
      groupCount: DI.playwright.countExpr("page.getByRole('group', { name: 'Shipping' })"),
      tableCount: DI.playwright.countExpr("page.getByRole('table', { name: 'People' })"),
      figureCount: DI.playwright.countExpr("page.getByRole('figure', { name: 'Figure one' })")
    }));
    assert.deepEqual(out, {
      titleName: 'Title',
      linkName: 'Icon link',
      buttonName: 'Icon button',
      titleCount: await iconsPage.getByRole('textbox', { name: 'Title', exact: true }).count(),
      linkCount: await iconsPage.getByRole('link', { name: 'Icon link' }).count(),
      buttonCount: await iconsPage.getByRole('button', { name: 'Icon button' }).count(),
      groupCount: await iconsPage.getByRole('group', { name: 'Shipping' }).count(),
      tableCount: await iconsPage.getByRole('table', { name: 'People' }).count(),
      figureCount: await iconsPage.getByRole('figure', { name: 'Figure one' }).count()
    });
  } finally {
    await iconsPage.close();
  }
});

test('panel actions: icon and caption accessible names resolve', { todo: 'panel-actions ignores icon, legend, caption and figcaption names' }, async () => {
  const namesPage = await browser.newPage();
  try {
    await namesPage.setContent(`<!doctype html><html><body>
      <a id="icon-link" href="#"><svg aria-label="Icon link"></svg></a>
      <button id="icon-button"><svg aria-label="Icon button"></svg></button>
      <fieldset><legend>Shipping</legend><input></fieldset>
      <table><caption>People</caption><tr><td>Cell</td></tr></table>
      <figure><img alt="Logo"><figcaption>Figure one</figcaption></figure>
    </body></html>`);
    await namesPage.addScriptTag({ path: path.join(ROOT, 'src/panel/panel-actions.js') });
    const out = await namesPage.evaluate(() => ({
      link: DIPanel.pageAction('click', 'playwright', "page.getByRole('link', { name: 'Icon link' })", '', false).matched,
      button: DIPanel.pageAction('click', 'playwright', "page.getByRole('button', { name: 'Icon button' })", '', false).matched,
      group: DIPanel.pageAction('click', 'playwright', "page.getByRole('group', { name: 'Shipping' })", '', false).matched,
      table: DIPanel.pageAction('click', 'playwright', "page.getByRole('table', { name: 'People' })", '', false).matched,
      figure: DIPanel.pageAction('click', 'playwright', "page.getByRole('figure', { name: 'Figure one' })", '', false).matched
    }));
    assert.deepEqual(out, { link: 1, button: 1, group: 1, table: 1, figure: 1 });
  } finally {
    await namesPage.close();
  }
});

test('panel actions: role state options filter the match set', { todo: 'role options ignore checked/disabled/includeHidden/level' }, async () => {
  const statesPage = await browser.newPage();
  try {
    await statesPage.setContent(`<!doctype html><html><body>
      <input type="checkbox" id="c1" checked aria-label="Term one">
      <input type="checkbox" id="c2" aria-label="Term two">
      <input type="checkbox" id="c3" hidden aria-label="Hidden term">
      <button id="b1" disabled>Disabled</button>
      <button id="b2">Enabled</button>
      <h1>Top</h1><h2>Second</h2>
    </body></html>`);
    await injectGenerators(statesPage);
    await statesPage.addScriptTag({ path: path.join(ROOT, 'src/panel/panel-actions.js') });
    const exprs = [
      "page.getByRole('checkbox', { checked: true })",
      "page.getByRole('checkbox', { checked: false })",
      "page.getByRole('button', { disabled: true })",
      "page.getByRole('button', { disabled: false })",
      "page.getByRole('checkbox', { includeHidden: true })",
      "page.getByRole('heading', { level: 2 })"
    ];
    const real = [
      await statesPage.getByRole('checkbox', { checked: true }).count(),
      await statesPage.getByRole('checkbox', { checked: false }).count(),
      await statesPage.getByRole('button', { disabled: true }).count(),
      await statesPage.getByRole('button', { disabled: false }).count(),
      await statesPage.getByRole('checkbox', { includeHidden: true }).count(),
      await statesPage.getByRole('heading', { level: 2 }).count()
    ];
    for (let index = 0; index < exprs.length; index += 1) {
      const [count, validated, panel] = await statesPage.evaluate((expr) => [
        DI.playwright.countExpr(expr),
        DI.validate.test('playwright', expr).count,
        DIPanel.pageAction('click', 'playwright', expr, '', false).matched
      ], exprs[index]);
      assert.deepEqual([count, validated, panel], [real[index], real[index], real[index]], exprs[index]);
    }
  } finally {
    await statesPage.close();
  }
});
