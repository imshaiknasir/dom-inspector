'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('manifest: is MV3 with the expected extension surfaces', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name);
  assert.ok(manifest.version);
  assert.ok(manifest.background && manifest.background.service_worker);
  assert.ok(manifest.side_panel && manifest.side_panel.default_path);
  assert.ok(manifest.devtools_page);
  assert.ok(manifest.action);
  assert.equal(manifest.action.default_popup, 'src/popup/popup.html');
});

test('manifest: declares no copied branding', () => {
  const text = JSON.stringify(manifest).toLowerCase();
  assert.ok(!text.includes('selectorshub'), 'must not reuse SelectorsHub branding');
  assert.ok(!text.includes('selector hub'), 'must not reuse SelectorsHub branding');
  assert.match(manifest.name, /dom inspector/i);
});

test('manifest: content scripts and their assets all exist', () => {
  const scripts = manifest.content_scripts || [];
  assert.ok(scripts.length >= 1);
  for (const entry of scripts) {
    assert.ok(entry.matches.includes('<all_urls>'));
    assert.equal(entry.all_frames, true);
    for (const file of entry.js || []) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), 'missing ' + file);
    }
    for (const file of entry.css || []) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), 'missing ' + file);
    }
  }
});

test('manifest: panel, devtools and worker files exist', () => {
  const files = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    manifest.devtools_page
  ];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), 'missing ' + file);
  }
  const panelDir = path.dirname(path.join(ROOT, manifest.side_panel.default_path));
  assert.ok(fs.existsSync(path.join(panelDir, 'panel.css')));
  assert.ok(fs.existsSync(path.join(panelDir, 'panel.js')));
});

test('manifest: permissions are explicit and avoid unused sensitive grants', () => {
  const permissions = manifest.permissions || [];
  for (const needed of ['activeTab', 'scripting', 'storage', 'sidePanel', 'clipboardWrite']) {
    assert.ok(permissions.includes(needed), 'missing permission ' + needed);
  }
  assert.ok(!permissions.includes('cookies'));
  assert.ok(!permissions.includes('<all_urls>'));
  assert.ok((manifest.host_permissions || []).includes('<all_urls>'));
});

test('manifest: keyboard command opens the action', () => {
  assert.ok(manifest.commands && manifest.commands._execute_action);
  assert.ok(manifest.commands._execute_action.suggested_key.default);
});

test('manifest: generator scripts load in dependency order', () => {
  const files = manifest.content_scripts[0].js;
  const order = [
    'src/content/util.js',
    'src/content/css.js',
    'src/content/xpath.js',
    'src/content/playwright.js',
    'src/content/formats.js',
    'src/content/validate.js',
    'src/content/repair.js',
    'src/content/picker.js'
  ];
  assert.deepEqual(files, order);
});

test('manifest: context menu copy permission and background handlers exist', () => {
  assert.ok((manifest.permissions || []).includes('contextMenus'));
  const background = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
  assert.match(background, /contextMenus\.create/);
  assert.match(background, /["']di-copy-best["']/);
  assert.match(background, /DI_COPY_BEST/);
});
