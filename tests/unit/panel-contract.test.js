'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PANEL_JS = path.join(ROOT, 'src/panel/panel.js');
const PANEL_HTML = path.join(ROOT, 'src/panel/panel.html');

const elementIds = (html) => new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = (js) => {
  const refs = [...js.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  return [...new Set(refs)];
};

test('panel: every element id used by panel.js exists in panel.html', () => {
  const html = fs.readFileSync(PANEL_HTML, 'utf8');
  const js = fs.readFileSync(PANEL_JS, 'utf8');
  const ids = elementIds(html);
  const missing = referencedIds(js).filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], 'panel.html is missing ' + missing.join(', '));
});

test('panel: markup has no duplicated element ids', () => {
  const html = fs.readFileSync(PANEL_HTML, 'utf8');
  const all = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = all.filter((id, index) => all.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test('panel: HTML only loads local scripts that exist', () => {
  const html = fs.readFileSync(PANEL_HTML, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const src of scripts) {
    assert.ok(!/^https?:/i.test(src), 'remote script ' + src);
    assert.ok(fs.existsSync(path.join(path.dirname(PANEL_HTML), src)), 'missing ' + src);
  }
});
