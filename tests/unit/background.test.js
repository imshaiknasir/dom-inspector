'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Objects created inside vm contexts have foreign prototypes; compare their data.
const deepEqual = assert.deepEqual;
assert.deepEqual = (actual, expected, message) => deepEqual(
  JSON.parse(JSON.stringify(actual)),
  JSON.parse(JSON.stringify(expected)),
  message
);

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/background.js'), 'utf8');

const tick = () => new Promise((resolve) => setImmediate(resolve));

const loadBackground = () => {
  const calls = { menus: [], opened: [], sent: [], session: {}, behavior: [], created: [] };
  const listeners = { installed: [], clicked: [], action: [], message: [] };
  const chrome = {
    runtime: {
      lastError: undefined,
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) }
    },
    sidePanel: {
      setPanelBehavior: async (options) => { calls.behavior.push(options); },
      open: async (options) => { calls.opened.push(options); }
    },
    contextMenus: {
      create: (options, callback) => { calls.menus.push(options); if (callback) callback(); },
      onClicked: { addListener: (fn) => listeners.clicked.push(fn) }
    },
    action: { onClicked: { addListener: (fn) => listeners.action.push(fn) } },
    tabs: {
      sendMessage: async (tabId, message) => { calls.sent.push({ tabId, message }); },
      create: async (options) => { calls.created.push(options); }
    },
    storage: {
      session: {
        set: async (values) => { Object.assign(calls.session, values); },
        get: async (key) => ({ [key]: calls.session[key] })
      }
    }
  };
  vm.runInNewContext(SOURCE, { chrome, console });
  return { calls, listeners };
};

test('background: install registers menus and side-panel behavior', async () => {
  const { calls, listeners } = loadBackground();
  assert.equal(listeners.installed.length, 1);
  await listeners.installed[0]();
  await tick();
  assert.deepEqual(calls.behavior, [{ openPanelOnActionClick: true }]);
  assert.deepEqual(calls.menus.map((item) => item.id), ['di-pick', 'di-copy-best']);
  for (const menu of calls.menus) {
    assert.deepEqual(menu.contexts, ['all']);
    assert.match(menu.title, /DOM Inspector/);
  }
});

test('background: context-menu pick opens the panel and starts the picker', async () => {
  const { calls, listeners } = loadBackground();
  const tab = { id: 7, windowId: 3 };
  listeners.clicked[0]({ menuItemId: 'di-pick' }, tab);
  await tick();
  assert.deepEqual(calls.opened, [{ windowId: 3 }]);
  assert.deepEqual(calls.sent, [{ tabId: 7, message: { type: 'DI_START' } }]);
});

test('background: context-menu copy asks the page for its best selector', async () => {
  const { calls, listeners } = loadBackground();
  listeners.clicked[0]({ menuItemId: 'di-copy-best' }, { id: 9, windowId: 4 });
  await tick();
  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.sent, [{ tabId: 9, message: { type: 'DI_COPY_BEST' } }]);
});

test('background: context-menu events without a tab are ignored', async () => {
  const { calls, listeners } = loadBackground();
  listeners.clicked[0]({ menuItemId: 'di-pick' }, null);
  listeners.clicked[0]({ menuItemId: 'di-copy-best' }, {});
  await tick();
  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.sent, []);
});

test('background: toolbar action opens the side panel', async () => {
  const { calls, listeners } = loadBackground();
  await listeners.action[0]({ windowId: 11 });
  assert.deepEqual(calls.opened, [{ windowId: 11 }]);
});

test('background: DI_ELEMENT is cached and DI_GET_LAST returns it', async () => {
  const { calls, listeners } = loadBackground();
  const payload = { url: 'https://example.test/', element: { id: 'save' } };
  assert.equal(listeners.message[0]({ type: 'DI_ELEMENT', payload }, {}, () => {}), undefined);
  await tick();
  assert.deepEqual(calls.session['di:lastPick'], payload);

  let response;
  const async = listeners.message[0]({ type: 'DI_GET_LAST' }, {}, (value) => { response = value; });
  assert.equal(async, true);
  await tick();
  assert.deepEqual(response, { ok: true, payload });
});

test('background: DI_GET_LAST reports null when nothing was picked', async () => {
  const { listeners } = loadBackground();
  let response;
  const async = listeners.message[0]({ type: 'DI_GET_LAST' }, {}, (value) => { response = value; });
  assert.equal(async, true);
  await tick();
  assert.deepEqual(response, { ok: true, payload: null });
});

test('background: unrelated messages are ignored', () => {
  const { listeners } = loadBackground();
  assert.equal(listeners.message[0]({ type: 'DI_NOPE' }, {}, () => {}), undefined);
  assert.equal(listeners.message[0](null, {}, () => {}), undefined);
});
