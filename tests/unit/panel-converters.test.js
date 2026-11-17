'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, launchBrowser } = require('../helpers/harness');

let browser;
let page;

before(async () => {
  browser = await launchBrowser();
  page = await browser.newPage();
  await page.addScriptTag({ path: path.join(ROOT, 'src/panel/panel-converters.js') });
});

after(async () => { if (browser) await browser.close(); });

test('panel converters: getByTestId maps to Python, Java and C#', async () => {
  const out = await page.evaluate(() => ({
    py: DIPanel.convertPlaywright("page.getByTestId('save-btn')", 'python'),
    java: DIPanel.convertPlaywright("page.getByTestId('save-btn')", 'java'),
    cs: DIPanel.convertPlaywright("page.getByTestId('save-btn')", 'csharp')
  }));
  assert.equal(out.py, 'page.get_by_test_id("save-btn")');
  assert.equal(out.java, 'page.getByTestId("save-btn")');
  assert.equal(out.cs, 'Page.GetByTestId("save-btn")');
});

test('panel converters: role options keep name and exact flags', async () => {
  const input = "page.getByRole('button', { name: 'Save changes', exact: true })";
  const out = await page.evaluate((code) => ({
    py: DIPanel.convertPlaywright(code, 'python'),
    java: DIPanel.convertPlaywright(code, 'java'),
    cs: DIPanel.convertPlaywright(code, 'csharp')
  }), input);
  assert.equal(out.py, 'page.get_by_role("button", name="Save changes", exact=true)');
  assert.equal(out.java, 'page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName("Save changes").setExact(true))');
  assert.equal(out.cs, 'Page.GetByRole(AriaRole.Button, new() { Name = "Save changes", Exact = true })');
});

test('panel converters: locator and frameLocator chains remain valid', async () => {
  const out = await page.evaluate(() => ({
    locator: DIPanel.convertPlaywright("page.locator('#save')", 'python'),
    xpath: DIPanel.convertPlaywright("page.locator(`//*[@id='save']`)", 'csharp'),
    frame: DIPanel.convertPlaywright("page.frameLocator('#frame').getByTestId('inner-btn')", 'python'),
    javaFrame: DIPanel.convertPlaywright("page.frameLocator('#frame').getByTestId('inner-btn')", 'java')
  }));
  assert.equal(out.locator, 'page.locator("#save")');
  assert.equal(out.xpath, 'Page.Locator("//*[@id=\'save\']")');
  assert.equal(out.frame, 'page.frame_locator("#frame").get_by_test_id("inner-btn")');
  assert.equal(out.javaFrame, 'page.frameLocator("#frame").getByTestId("inner-btn")');
});

test('panel converters: regex role names use the language regex idioms', async () => {
  const input = "page.getByRole('button', { name: /Save/i })";
  const out = await page.evaluate((code) => ({
    py: DIPanel.convertPlaywright(code, 'python'),
    java: DIPanel.convertPlaywright(code, 'java'),
    cs: DIPanel.convertPlaywright(code, 'csharp')
  }), input);
  assert.equal(out.py, 'page.get_by_role("button", name=re.compile(r"Save", re.I))');
  assert.equal(out.java, 'page.getByRole(AriaRole.BUTTON, new Page.GetByRoleOptions().setName(Pattern.compile("Save", Pattern.CASE_INSENSITIVE)))');
  assert.equal(out.cs, 'Page.GetByRole(AriaRole.Button, new() { Name = new Regex("Save", RegexOptions.IgnoreCase) })');
});

test('panel converters: quoted values are unescaped and re-quoted', async () => {
  const out = await page.evaluate(() => ({
    doubled: DIPanel.toDoubleQuoted("page.getByText('it\\'s')"),
    converted: DIPanel.convertPlaywright("page.getByText('it\\'s')", 'python')
  }));
  assert.equal(out.doubled, 'page.getByText("it\'s")');
  assert.equal(out.converted, 'page.get_by_text("it\'s")');
});
