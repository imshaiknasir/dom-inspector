'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'mcp', 'server.js');
const FIXTURE = fs.readFileSync(path.join(ROOT, 'tests', 'fixture.html'), 'utf8');

let client;
let server;
let baseURL;
let stderr = '';

const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(result.content && result.content[0] && result.content[0].type === 'text', `${name} returned text content`);
  let data;
  try { data = JSON.parse(result.content[0].text); } catch (_) { data = { raw: result.content[0].text }; }
  return { result, data };
};

const toolNames = ['generate_locators', 'verify_locator', 'heal_locator', 'list_elements'];

before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(FIXTURE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}/`;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: ROOT,
    stderr: 'pipe'
  });
  if (transport.stderr) transport.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  client = new Client({ name: 'dom-inspector-mcp-tests', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  if (client) await client.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.DI_MCP_DEBUG) process.stderr.write(stderr);
});

test('MCP: server advertises every tool with a JSON input schema', { timeout: 60000 }, async () => {
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.deepEqual(names.sort(), [...toolNames].sort());
  for (const tool of listed.tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.ok(tool.description && tool.description.length > 40, tool.name);
  }
  const generate = listed.tools.find((tool) => tool.name === 'generate_locators');
  assert.ok(generate.inputSchema.properties.target);
  assert.ok(generate.inputSchema.properties.url);
  assert.ok(generate.inputSchema.properties.html);
  const heal = listed.tools.find((tool) => tool.name === 'heal_locator');
  assert.ok(heal.inputSchema.properties.prefer);
});

test('generate_locators: CSS target on a URL returns all five formats', { timeout: 60000 }, async () => {
  const { result, data } = await call('generate_locators', {
    url: baseURL,
    target: { css: '#save' }
  });
  assert.equal(result.isError, undefined);
  assert.equal(data.ok, true);
  assert.equal(data.source.kind, 'url');
  assert.equal(data.element.id, 'save');
  assert.equal(data.element.role, 'button');
  assert.equal(data.css.best.value, '#save');
  assert.equal(data.css.best.unique, true);
  assert.ok(data.css.candidates.length > 1);
  assert.ok(data.xpath.best.value);
  assert.equal(data.xpath.best.unique, true);
  assert.match(data.playwright.best.value, /getByTestId\('save-btn'\)|getByRole\('button'/);
  assert.equal(data.playwright.best.unique, true);
  assert.equal(data.selenium.strategies.cssSelector.value, '#save');
  assert.match(data.selenium.snippets.css, /driver\.findElement\(By\.cssSelector\('#save'\)\)/);
  assert.equal(data.cypress.css, "cy.get('#save')");
  assert.ok(data.cypress.snippets.some((row) => row.type === 'cypress-xpath'));
  assert.equal(data.recommended.value, data.playwright.best.value);
});

test('generate_locators: XPath target on raw HTML', { timeout: 60000 }, async () => {
  const html = '<!doctype html><button id="go" data-testid="go">Go</button>';
  const { data } = await call('generate_locators', {
    html,
    target: { xpath: "//button[@data-testid='go']" }
  });
  assert.equal(data.ok, true);
  assert.equal(data.target.method, 'xpath');
  assert.equal(data.element.id, 'go');
  assert.equal(data.css.best.value, '#go');
  assert.equal(data.xpath.best.value, "//*[@id='go']");
  assert.match(data.selenium.snippets.xpath, /By\.xpath/);
});

test('generate_locators: text target resolves the smallest matching element', { timeout: 60000 }, async () => {
  const html = '<!doctype html><div><button id="nested">Nested label</button></div>';
  const { data } = await call('generate_locators', {
    html,
    target: { text: 'Nested label', exact: true }
  });
  assert.equal(data.element.id, 'nested');
  assert.equal(data.target.method, 'text');
  assert.match(data.playwright.best.value, /getByRole\('button'|getByText\('Nested label'/);
});

test('generate_locators: viewport coordinates pierce open shadow roots', { timeout: 60000 }, async () => {
  const html = `<!doctype html>
    <button id="hit" style="position:absolute;left:20px;top:20px;width:140px;height:40px">Hit</button>
    <div id="host" style="position:absolute;left:20px;top:90px;width:140px;height:40px"></div>
    <script>
      document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
        '<button id="shadow-hit" style="width:140px;height:40px">Shadow hit</button>';
    </script>`;
  const plain = await call('generate_locators', {
    html,
    target: { coordinates: { x: 60, y: 35 } }
  });
  assert.equal(plain.data.element.id, 'hit');
  assert.equal(plain.data.target.method, 'coordinates');
  const shadow = await call('generate_locators', {
    html,
    target: { coordinates: { x: 60, y: 105 } }
  });
  assert.equal(shadow.data.element.id, 'shadow-hit');
  assert.ok(shadow.data.playwright.candidates.some((row) => /locator\('#host'\)/.test(row.value)));
});

test('generate_locators: targets inside same-origin frames get frame locators', { timeout: 60000 }, async () => {
  const { data } = await call('generate_locators', {
    url: baseURL,
    target: { css: '#inner' }
  });
  assert.equal(data.element.id, 'inner');
  assert.deepEqual(data.frameLocators, ["frameLocator('#frame')"]);
  assert.match(data.playwright.best.value, /frameLocator\('#frame'\)/);
  assert.match(data.selenium.frame, /switchTo\(\)\.frame/);
});

test('verify_locator: unique, non-unique, and missing results', { timeout: 60000 }, async () => {
  const unique = await call('verify_locator', { url: baseURL, locator: '#save' });
  assert.equal(unique.data.ok, true);
  assert.equal(unique.data.matchCount, 1);
  assert.equal(unique.data.unique, true);
  assert.equal(unique.data.type, 'css');
  assert.equal(unique.data.matches[0].id, 'save');
  assert.match(unique.data.advice, /Unique/);

  const many = await call('verify_locator', { url: baseURL, locator: '#people .rowbtn' });
  assert.equal(many.data.ok, true);
  assert.equal(many.data.matchCount, 2);
  assert.equal(many.data.unique, false);
  assert.equal(many.data.matches.length, 2);
  assert.match(many.data.advice, /heal_locator/);

  const playwright = await call('verify_locator', {
    url: baseURL,
    locator: "page.getByRole('button', { name: 'Save changes', exact: true })"
  });
  assert.equal(playwright.data.type, 'playwright');
  assert.equal(playwright.data.matchCount, 1);
  assert.equal(playwright.data.unique, true);

  const missing = await call('verify_locator', { url: baseURL, locator: '#does-not-exist' });
  assert.equal(missing.data.ok, false);
  assert.equal(missing.data.matchCount, 0);
  assert.match(missing.data.advice, /No match/);
});

test('verify_locator: parser errors are reported and not thrown', { timeout: 60000 }, async () => {
  const { result, data } = await call('verify_locator', { url: baseURL, locator: 'div[', type: 'css' });
  assert.equal(result.isError, undefined);
  assert.equal(data.ok, false);
  assert.equal(data.matchCount, 0);
  assert.ok(data.error);
});

test('heal_locator: repairs a broken selector and re-verifies it', { timeout: 60000 }, async () => {
  const { data } = await call('heal_locator', {
    url: baseURL,
    locator: '#sav',
    prefer: 'css'
  });
  assert.equal(data.ok, true);
  assert.equal(data.status, 'healed');
  assert.equal(data.fixed, '#save');
  assert.equal(data.verified.unique, true);
  assert.equal(data.verified.matchCount, 1);
  assert.equal(data.element.id, 'save');
  assert.equal(data.css.best.value, '#save');
});

test('heal_locator: index chooses one of several matches and returns a unique locator', { timeout: 60000 }, async () => {
  const { data } = await call('heal_locator', {
    url: baseURL,
    locator: '#people .rowbtn',
    index: 1,
    prefer: 'playwright'
  });
  assert.equal(data.ok, true);
  assert.equal(data.status, 'healed');
  assert.equal(data.previous.matchCount, 2);
  assert.equal(data.selectedIndex, 1);
  assert.equal(data.verified.unique, true);
  assert.equal(data.verified.matchCount, 1);
  assert.match(data.fixed, /nth|getByRole|locator/);
  const check = await call('verify_locator', { url: baseURL, locator: data.fixed, type: data.verified.type });
  assert.equal(check.data.matchCount, 1);
  assert.equal(check.data.unique, true);
});

test('heal_locator: reports a missing target without claiming success', { timeout: 60000 }, async () => {
  const { result, data } = await call('heal_locator', {
    html: '<!doctype html><button id="only">Only</button>',
    locator: '.not-here-at-all',
    prefer: 'css'
  });
  assert.equal(result.isError, undefined);
  assert.equal(data.ok, false);
  assert.equal(data.status, 'not-found');
  assert.ok(data.error);
});

test('list_elements: returns visible interactive elements with best locators', { timeout: 60000 }, async () => {
  const { data } = await call('list_elements', { url: baseURL, limit: 50 });
  assert.equal(data.ok, true);
  assert.ok(data.totalMatched >= 6);
  assert.equal(data.returned, data.elements.length);
  const ids = data.elements.map((element) => element.id);
  assert.ok(ids.includes('save'));
  assert.ok(ids.includes('email'));
  assert.ok(ids.includes('shadowbtn'));
  const save = data.elements.find((element) => element.id === 'save');
  assert.equal(save.accessibleName, 'Save changes');
  assert.equal(save.locators.css.value, '#save');
  assert.equal(save.locators.css.unique, true);
  assert.ok(save.locators.playwright.value);
  const hidden = await call('list_elements', {
    html: '<!doctype html><button id="shown">Shown</button><button id="hidden" style="display:none">Hidden</button>',
    limit: 10
  });
  assert.deepEqual(hidden.data.elements.map((element) => element.id), ['shown']);
});

test('input validation: url/html exclusivity and target selection fail closed', { timeout: 60000 }, async () => {
  const both = await call('generate_locators', {
    url: baseURL,
    html: '<button id="x">X</button>',
    target: { css: '#x' }
  });
  assert.equal(both.result.isError, true);
  assert.equal(both.data.errorType, 'invalid-input');
  assert.match(both.data.error, /exactly one of url or html/);

  const noTarget = await call('generate_locators', { html: '<button id="x">X</button>' });
  assert.equal(noTarget.result.isError, true);
  assert.match(noTarget.data.raw, /target/);
});
