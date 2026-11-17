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
  const calls = { menus: [], opened: [], sent: [], session: {}, behavior: [], created: [], removeAll: 0, queries: [], activeTabs: [{ id: 5, windowId: 2 }] };
  const listeners = { installed: [], clicked: [], action: [], message: [], command: [] };
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
      removeAll: (callback) => { calls.removeAll += 1; if (callback) callback(); },
      onClicked: { addListener: (fn) => listeners.clicked.push(fn) }
    },
    action: { onClicked: { addListener: (fn) => listeners.action.push(fn) } },
    tabs: {
      query: async (query) => { calls.queries.push(query); return calls.activeTabs; },
      sendMessage: async (tabId, message, options) => { calls.sent.push(Object.assign({ tabId, message }, options ? { options } : {})); },
      create: async (options) => { calls.created.push(options); }
    },
    commands: {
      onCommand: { addListener: (fn) => listeners.command.push(fn) }
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

test('background: install/update recreates menus without stale ids', async () => {
  const { calls, listeners } = loadBackground();
  await listeners.installed[0]();
  await listeners.installed[0]();
  await tick();
  assert.equal(calls.removeAll, 2);
  assert.equal(calls.menus.length, 4);
  assert.deepEqual(calls.menus.map((item) => item.id), ['di-pick', 'di-copy-best', 'di-pick', 'di-copy-best']);
});

test('background: start-pick command opens the panel and starts picking', async () => {
  const { calls, listeners } = loadBackground();
  assert.equal(listeners.command.length, 1);
  await listeners.command[0]('start-pick');
  await tick();
  assert.deepEqual(calls.queries, [{ active: true, currentWindow: true }]);
  assert.deepEqual(calls.opened, [{ windowId: 2 }]);
  assert.deepEqual(calls.sent, [{ tabId: 5, message: { type: 'DI_START' } }]);

  await listeners.command[0]('something-else');
  await tick();
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.opened.length, 1);
});

test('background: start-pick command ignores a missing active tab', async () => {
  const { calls, listeners } = loadBackground();
  calls.activeTabs = [];
  await listeners.command[0]('start-pick');
  await tick();
  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.sent, []);
});

test('background: copy-best targets the right-clicked frame', async () => {
  const { calls, listeners } = loadBackground();
  listeners.clicked[0]({ menuItemId: 'di-copy-best', frameId: 4 }, { id: 9, windowId: 4 });
  await tick();
  assert.deepEqual(calls.sent, [{
    tabId: 9,
    message: { type: 'DI_COPY_BEST' },
    options: { frameId: 4 }
  }]);
});
