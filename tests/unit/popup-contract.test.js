'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const POPUP_JS = path.join(ROOT, 'src/popup/popup.js');
const POPUP_HTML = path.join(ROOT, 'src/popup/popup.html');

const elementIds = (html) => new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = (js) => [...new Set([...js.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]))];

test('popup: every element id used by popup.js exists in popup.html', () => {
  const html = fs.readFileSync(POPUP_HTML, 'utf8');
  const js = fs.readFileSync(POPUP_JS, 'utf8');
  const ids = elementIds(html);
  const missing = referencedIds(js).filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], 'popup.html is missing ' + missing.join(', '));
});

test('popup: markup has the expected actions and no duplicate ids', () => {
  const html = fs.readFileSync(POPUP_HTML, 'utf8');
  for (const id of ['pop-pick', 'pop-open', 'pop-heal', 'pop-refresh', 'pop-last-rows']) {
    assert.match(html, new RegExp(`id="${id}"`), 'missing ' + id);
  }
  for (const key of ['P', 'O', 'H', 'R', 'C']) {
    assert.match(html, new RegExp(`aria-keyshortcuts="${key}"`), 'missing shortcut ' + key);
  }
  const all = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = all.filter((id, index) => all.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test('popup: only local scripts/styles are referenced', () => {
  const html = fs.readFileSync(POPUP_HTML, 'utf8');
  const assets = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1])
  ];
  assert.ok(assets.length > 0);
  for (const src of assets) {
    assert.ok(!/^https?:|^\/\//i.test(src), 'remote asset ' + src);
    assert.ok(fs.existsSync(path.join(path.dirname(POPUP_HTML), src)), 'missing ' + src);
  }
});
