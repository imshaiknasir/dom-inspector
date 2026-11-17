'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/devtools/devtools.js'), 'utf8');

const load = (withHeight) => {
  const calls = { sidebar: [], panels: [], heights: [] };
  const chrome = {
    devtools: {
      panels: {
        elements: {
          createSidebarPane: (name, callback) => {
            calls.sidebar.push(name);
            callback({
              setPage: (page) => calls.sidebar.push(page),
              ...(withHeight ? { setHeight: (height) => calls.heights.push(height) } : {})
            });
          }
        },
        create: (name, icon, page, callback) => {
          calls.panels.push({ name, icon, page });
          if (callback) callback();
        }
      }
    }
  };
  vm.runInNewContext(SOURCE, { chrome });
  return calls;
};

test('devtools runtime: registers the sidebar page, height and full panel', () => {
  const calls = load(true);
  assert.deepEqual(calls.sidebar, ['DOM Inspector', '../panel/panel.html']);
  assert.deepEqual(calls.heights, ['420px']);
  assert.deepEqual(calls.panels, [{ name: 'DOM Inspector', icon: 'icons/icon-48.png', page: '../panel/panel.html' }]);
});

test('devtools runtime: works without the optional setHeight API', () => {
  const calls = load(false);
  assert.deepEqual(calls.sidebar, ['DOM Inspector', '../panel/panel.html']);
  assert.deepEqual(calls.heights, []);
  assert.equal(calls.panels.length, 1);
});
