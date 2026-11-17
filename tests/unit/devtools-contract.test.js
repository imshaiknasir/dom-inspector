'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const DEVTOOLS_HTML = path.join(ROOT, manifest.devtools_page);
const DEVTOOLS_DIR = path.dirname(DEVTOOLS_HTML);

test('devtools: page registers both a sidebar pane and a full panel', () => {
  const html = fs.readFileSync(DEVTOOLS_HTML, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scripts, ['devtools.js']);
  const js = fs.readFileSync(path.join(DEVTOOLS_DIR, 'devtools.js'), 'utf8');
  assert.match(js, /createSidebarPane\(\s*["']DOM Inspector["']/);
  assert.match(js, /panels\.create\(\s*["']DOM Inspector["']/);
  assert.match(js, /["']\.\.\/panel\/panel\.html["']/);
  assert.ok(fs.existsSync(path.join(DEVTOOLS_DIR, '..', 'panel', 'panel.html')));
});

test('devtools: icon referenced by panels.create exists', () => {
  const js = fs.readFileSync(path.join(DEVTOOLS_DIR, 'devtools.js'), 'utf8');
  const match = js.match(/panels\.create\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']/);
  assert.ok(match, 'panels.create icon argument');
  assert.ok(fs.existsSync(path.join(ROOT, match[1])), 'missing ' + match[1]);
});

test('devtools: manifest points at an existing devtools page', () => {
  assert.ok(manifest.devtools_page);
  assert.ok(fs.existsSync(DEVTOOLS_HTML));
});
