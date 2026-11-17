'use strict';

/* Guards the chain rules: plain JavaScript only, local-only extension surface. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git', 'test-results', 'playwright-report']);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const files = walk(ROOT);

test('language: no TypeScript, Rust or WebAssembly artifacts', () => {
  const forbidden = /\.(ts|tsx|rs|wasm)$/i;
  assert.deepEqual(files.filter((file) => forbidden.test(file)), []);
});

test('language: runtime sources do not use WebAssembly or fetch remote code', () => {
  for (const file of files.filter((item) => /[\\/]src[\\/].*\.js$/.test(item))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/WebAssembly/.test(text), `${path.relative(ROOT, file)} uses WebAssembly`);
    assert.ok(!/\bimport\s*\(/.test(text), `${path.relative(ROOT, file)} performs a dynamic import`);
  }
});

test('language: extension sources stay local-only', () => {
  const allowed = new Set([
    'http://www.w3.org/2000/svg',
    'http://www.w3.org/1999/xhtml'
  ]);
  for (const file of files.filter((item) => /[\\/]src[\\/]/.test(item))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      const url = match[0].replace(/[.,;]+$/, '');
      assert.ok(allowed.has(url), `${path.relative(ROOT, file)} references ${url}`);
    }
    assert.ok(!/\bfetch\s*\(/.test(text), `${path.relative(ROOT, file)} calls fetch`);
    assert.ok(!/\bXMLHttpRequest\b/.test(text), `${path.relative(ROOT, file)} uses XMLHttpRequest`);
    assert.ok(!/\bnew\s+WebSocket\b/.test(text), `${path.relative(ROOT, file)} opens a WebSocket`);
  }
});

test('language: package.json has no build step or compiler dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = Object.keys(pkg.scripts || {});
  assert.ok(!scripts.includes('build'), 'package.json must not define a build step');
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  assert.ok(!deps.some((name) => /typescript|webpack|rollup|esbuild|vite|ts-node/.test(name)), deps.join(', '));
});
