/* DOM Inspector — shared DevTools sidebar and side-panel controller. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const api = typeof chrome !== "undefined" ? chrome : null;
  const hasDevtools = !!(api && api.devtools && api.devtools.inspectedWindow);
  const convertPlaywright = (globalThis.DIPanel && globalThis.DIPanel.convertPlaywright) || ((code) => code);
  const pageAction = globalThis.DIPanel && globalThis.DIPanel.pageAction;

  const STORE_SETTINGS = "di:panel:settings";
  const STORE_SAVED = "di:panel:saved";
  const STORE_HISTORY = "di:panel:history";
  const LAST_PICK_KEY = "di:lastPick";

  const DEFAULT_SETTINGS = {
    lang: "js",
    await: false,
    unique: false,
    continuous: false,
    collapsed: {},
    driver: "",
    driverBase: "css",
    healText: "",
    strategy: "all"
  };

  const GROUPS = [
    { key: "css", label: "CSS", card: "di-css-card", rows: "di-css", meta: "di-css-meta", copy: "di-css-copy" },
    { key: "xpath", label: "XPath", card: "di-xpath-card", rows: "di-xpath", meta: "di-xpath-meta", copy: "di-xpath-copy" },
    { key: "axes", label: "Axes", card: "di-axes-card", rows: "di-axes", meta: "di-axes-meta", copy: "di-axes-copy" },
    { key: "pw", label: "Playwright", card: "di-pw-card", rows: "di-pw", meta: "di-pw-meta", copy: "di-pw-copy" },
    { key: "selenium", label: "Selenium", card: "di-selenium-card", rows: "di-selenium", meta: "di-selenium-meta", copy: "di-selenium-copy" },
    { key: "formats", label: "Cypress / JS / jQuery", card: "di-formats-card", rows: "di-formats", meta: "di-formats-meta", copy: "di-formats-copy" }
  ];

  const DRIVER_PRESETS = {
    "java-css": { base: "css", template: 'driver.findElement(By.cssSelector("{selector}"))' },
    "java-xpath": { base: "xpath", template: 'driver.findElement(By.xpath("{selector}"))' },
    "python-css": { base: "css", template: 'driver.find_element(By.CSS_SELECTOR, "{selector}")' },
    "python-xpath": { base: "xpath", template: 'driver.find_element(By.XPATH, "{selector}")' },
    cypress: { base: "css", template: 'cy.get("{selector}")' },
    playwright: { base: "css", template: "await page.locator('{selector}')" },
    testng: { base: "xpath", template: '@FindBy(xpath = "{selector}")' }
  };

  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    test: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/><path d="M8 10.5h5M10.5 8v5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z"/><path d="m13 6 5 5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8L12 3.6Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg>',
    fix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5a4 4 0 0 0-5.4 5.4L4 15v5h5l5.1-5.1a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.9-2.9 2.5-3.7Z"/></svg>'
  };

  const state = {
    payload: null,
    previousPayload: null,
    tabId: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    saved: [],
    savedFilter: "",
    savedBusy: false,
    history: [],
    healRows: [],
    healBusy: false,
    healSeq: 0,
    repairInjected: false,
    groups: { css: [], xpath: [], axes: [], pw: [], selenium: [], formats: [] },
    reference: null,
    filter: "",
    picking: false,
    contentAvailable: null,
    autoCounted: new Set(),
    payloadSeq: 0,
    countNodes: new Map(),
    liveTimer: null,
    liveSeq: 0,
    toastTimer: null,
    settingsTimer: null
  };

  /* ---------------------------------------------------------------- */
  /* Storage                                                          */
  /* ---------------------------------------------------------------- */

  const localStore = api && api.storage && api.storage.local;
  const sessionStore = api && api.storage && api.storage.session;

  const readStore = async (key) => {
    if (localStore) {
      try {
        const data = await localStore.get(key);
        if (data && Object.prototype.hasOwnProperty.call(data, key)) return data[key];
      } catch (_) { /* fall through */ }
    }
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (_) {
      return undefined;
    }
  };

  const writeStore = async (key, value) => {
    if (localStore) {
      try {
        await localStore.set({ [key]: value });
        return;
      } catch (_) { /* fall through */ }
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* ignore */ }
  };

  const persistSettings = () => {
    if (state.settingsTimer) clearTimeout(state.settingsTimer);
    state.settingsTimer = setTimeout(() => {
      writeStore(STORE_SETTINGS, state.settings);
    }, 180);
  };

  const removeStore = async (key) => {
    if (localStore && localStore.remove) {
      try {
        await localStore.remove(key);
        return;
      } catch (_) { /* fall through */ }
    }
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
  };

  const applyFocusPayload = (value, smooth) => {
    const target = value && typeof value === "object" ? value.target : value;
    if (target === "heal") {
      $("di-heal-card").scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      $("di-heal-input").focus();
    } else if (target === "tester") {
      $("di-tester-card").scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      if (value && typeof value === "object" && typeof value.value === "string" && value.value.trim()) {
        $("di-input").value = value.value;
        $("di-type").value = ["css", "xpath", "playwright"].includes(value.type) ? value.type : "auto";
        scheduleLiveTest();
      }
      $("di-input").focus();
    }
    return target;
  };

  const applyFocusRequest = async () => {
    const focus = await readStore("di:panel:focus");
    if (!focus || typeof focus !== "object") return;
    if (Date.now() - (focus.at || 0) > 60000) {
      removeStore("di:panel:focus");
      return;
    }
    applyFocusPayload(focus, false);
    removeStore("di:panel:focus");
  };

  const sanitizeSaved = (list) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const value = typeof raw.value === "string" ? raw.value : "";
      if (!value) continue;
      const type = typeof raw.type === "string" && raw.type ? raw.type : "css";
      const testType = ["css", "xpath", "playwright"].includes(raw.testType) ? raw.testType : null;
      const testValue = typeof raw.testValue === "string" && raw.testValue ? raw.testValue : null;
      const key = typeof raw.key === "string" && raw.key ? raw.key : type + "::" + (testValue || value);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: typeof raw.id === "string" && raw.id
          ? raw.id
          : Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "-" + out.length,
        key,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Saved locator",
        scope: typeof raw.scope === "string" ? raw.scope : "",
        type,
        value,
        testType,
        testValue,
        count: typeof raw.count === "number" && Number.isFinite(raw.count) ? raw.count : null,
        label: typeof raw.label === "string" ? raw.label : "",
        error: typeof raw.error === "string" ? raw.error : "",
        url: typeof raw.url === "string" ? raw.url : "",
        savedAt: typeof raw.savedAt === "number" ? raw.savedAt : Date.now()
      });
    }
    return out;
  };

  const persistSaved = () => writeStore(STORE_SAVED, state.saved);

  const recordHistory = (payload) => {
    const element = payload.element || {};
    const css = payload.css && payload.css.best;
    const xpath = payload.xpath && payload.xpath.best;
    const playwright = (payload.playwright || []).find((item) => item.count === 1) || (payload.playwright || [])[0];
    if (!css && !xpath && !playwright) return;
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: Date.now(),
      url: payload.url || "",
      element: {
        tag: element.tag || "",
        id: element.id || "",
        role: element.role || "",
        accessibleName: element.accessibleName || "",
        text: (element.text || "").slice(0, 80)
      },
      css: css ? css.selector : null,
      cssCount: css ? css.count : null,
      xpath: xpath ? xpath.xpath : null,
      xpathCount: xpath ? xpath.count : null,
      playwright: playwright ? playwright.selector : null,
      playwrightCount: playwright ? playwright.count : null
    };
    state.history = [entry].concat(state.history.filter((item) =>
      !(item.url === entry.url && item.css === entry.css && item.xpath === entry.xpath)
    )).slice(0, 12);
    writeStore(STORE_HISTORY, state.history);
  };

  /* ---------------------------------------------------------------- */
  /* Messaging                                                        */
  /* ---------------------------------------------------------------- */

  const resolveTabId = async (force) => {
    if (hasDevtools) {
      try {
        const id = api.devtools.inspectedWindow.tabId;
        if (id != null) {
          state.tabId = id;
          return id;
        }
      } catch (_) { /* fall through */ }
    }
    if (!api || !api.tabs || !api.tabs.query) return state.tabId;
    if (!force && state.tabId != null) return state.tabId;
    const queries = [
      { active: true, lastFocusedWindow: true },
      { active: true, currentWindow: true }
    ];
    for (const query of queries) {
      try {
        const tabs = await api.tabs.query(query);
        if (tabs && tabs[0] && tabs[0].id != null) {
          state.tabId = tabs[0].id;
          return state.tabId;
        }
      } catch (_) { /* try next */ }
    }
    return state.tabId;
  };

  const sendToTab = async (message) => {
    const tabId = await resolveTabId(true);
    if (tabId == null) throw new Error("No active web page. Open a normal http(s) tab first.");
    if (!api || !api.tabs || !api.tabs.sendMessage) throw new Error("Tab messaging is unavailable in this context.");
    const response = await api.tabs.sendMessage(tabId, message);
    if (response === undefined) throw new Error("The page did not respond. Reload the page and try again.");
    return response;
  };

  const runtimeSend = async (message) => {
    if (!api || !api.runtime || !api.runtime.sendMessage) return null;
    try {
      return await api.runtime.sendMessage(message);
    } catch (_) {
      return null;
    }
  };

  const friendlyError = (error) => {
    const text = error && error.message ? error.message : String(error);
    if (/receiving end|port closed|establish connection|could not establish/i.test(text)) {
      return "No content script in this tab. Reload the page after installing or updating the extension.";
    }
    return text;
  };

  /* ---------------------------------------------------------------- */
  /* UI helpers                                                       */
  /* ---------------------------------------------------------------- */

  const setStatus = (text, tone) => {
    const node = $("di-status");
    if (!node) return;
    node.textContent = text;
    node.className = "di-sub" + (tone ? " " + tone : "");
  };

  const showResult = (text, tone) => {
    const node = $("di-result");
    if (!node) return;
    node.textContent = text;
    node.className = "result" + (tone ? " " + tone : "");
  };

  const setHint = (text) => {
    const node = $("di-hint");
    if (!node) return;
    node.textContent = text || "";
    node.hidden = !text;
  };

  const toast = (text, tone) => {
    const node = $("di-toast");
    if (!node) return;
    node.textContent = text;
    node.hidden = false;
    node.className = "toast show" + (tone ? " " + tone : "");
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      node.className = "toast";
      node.hidden = true;
    }, 1900);
  };

  const copyText = async (text, okMessage) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) { /* fall through */ }
    if (!ok) {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "readonly");
        area.style.position = "fixed";
        area.style.top = "-1000px";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        ok = document.execCommand("copy");
        area.remove();
      } catch (_) {
        ok = false;
      }
    }
    if (ok) toast(okMessage || "Copied to clipboard", "ok");
    else toast("Copy failed — select the text and copy it manually", "bad");
    return ok;
  };

  const download = (filename, mime, text) => {
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      return true;
    } catch (_) {
      return false;
    }
  };

  const stamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const iconButton = (name, title, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-btn";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = ICONS[name] || "";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(button);
    });
    return button;
  };

  /* ---------------------------------------------------------------- */
  /* Locator basics                                                   */
  /* ---------------------------------------------------------------- */

  const detectType = (value) => {
    const v = String(value || "").trim();
    if (!v) return "css";
    if (v.startsWith("page.") || v.startsWith("getBy") || v.startsWith("locator(") || v.includes(".locator(")) return "playwright";
    if (v.startsWith("//") || v.startsWith("(/") || v.startsWith("./") || v.startsWith("(")) return "xpath";
    return "css";
  };

  const cssEscape = (value) => {
    const text = String(value);
    if (globalThis.CSS && typeof CSS.escape === "function") return CSS.escape(text);
    return text.replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, (ch) => "\\" + ch);
  };

  const xpathLiteral = (value) => {
    const text = String(value);
    if (!text.includes("'")) return `'${text}'`;
    if (!text.includes('"')) return `"${text}"`;
    return "concat(" + text.split('"').map((part, i, arr) =>
      `"${part}"` + (i < arr.length - 1 ? `,'"',` : "")
    ).join("") + ")";
  };

  const selString = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const countTone = (count) => {
    if (count === 0) return "count-zero";
    if (count === 1) return "count-ok";
    if (typeof count === "number" && count > 1) return "count-many";
    return "count-unknown";
  };

  const countText = (count) => {
    if (typeof count !== "number") return "?";
    return `${count} match${count === 1 ? "" : "es"}`;
  };

  const countTitle = (count) => {
    if (typeof count !== "number") return "Match count not measured yet";
    if (count === 0) return "No elements match";
    if (count === 1) return "Unique — exactly one element matches";
    return "Not unique — " + count + " elements match";
  };

  const displayValue = (row) => {
    if (row.scope === "Playwright" && row.raw) {
      return convertPlaywright(row.raw, state.settings.lang, state.settings.await);
    }
    return row.value;
  };

  /* ---------------------------------------------------------------- */
  /* Payload → rows                                                   */
  /* ---------------------------------------------------------------- */

  const addCssRows = (payload) => {
    const rows = [];
    const seen = new Set();
    const push = (item, best) => {
      if (!item || !item.selector || seen.has(item.selector)) return;
      seen.add(item.selector);
      rows.push({
        scope: "CSS", type: "css", testType: "css", testValue: item.selector,
        value: item.selector, count: item.count, label: item.strategy,
        isBest: best, key: "css::" + item.selector
      });
    };
    const css = payload.css || {};
    if (css.best) push(css.best, true);
    for (const item of css.candidates || []) push(item, false);
    return rows;
  };

  const addXpathRows = (payload) => {
    const rows = [];
    const seen = new Set();
    const push = (xpath, count, label, extra) => {
      if (!xpath || seen.has(xpath)) return;
      seen.add(xpath);
      rows.push(Object.assign({
        scope: "XPath", type: "xpath", testType: "xpath", testValue: xpath,
        value: xpath, count, label, key: "xpath::" + xpath
      }, extra || {}));
    };
    const xp = payload.xpath || {};
    if (xp.best) push(xp.best.xpath, xp.best.count, xp.best.strategy, { isBest: true });
    for (const item of xp.candidates || []) push(item.xpath, item.count, item.strategy);
    if (xp.indexed) push(xp.indexed.xpath, xp.indexed.count, "indexed · position " + xp.indexed.position);
    if (xp.absolute) push(xp.absolute, null, "absolute", { autoCount: true });
    return rows;
  };

  const addAxesRows = (payload) => {
    const rows = [];
    const seen = new Set();
    for (const item of payload.axes || []) {
      if (!item || !item.xpath || seen.has(item.xpath)) continue;
      seen.add(item.xpath);
      rows.push({
        scope: "Axes", type: "xpath", testType: "xpath", testValue: item.xpath,
        value: item.xpath, count: item.count, label: item.strategy,
        isBest: rows.length === 0 && item.count === 1, key: "axes::" + item.xpath
      });
    }
    return rows;
  };

  const addPlaywrightRows = (payload) => {
    const rows = [];
    const seen = new Set();
    for (const item of payload.playwright || []) {
      if (!item || !item.selector || seen.has(item.selector)) continue;
      seen.add(item.selector);
      rows.push({
        scope: "Playwright", type: "playwright", testType: "playwright",
        testValue: item.selector, value: item.selector, raw: item.selector,
        count: item.count, label: item.type, key: "playwright::" + item.selector
      });
    }
    return rows;
  };

  const seleniumInfo = (item) => {
    const value = String(item.value || "");
    switch (item.type) {
      case "id":
        return { testType: "css", testValue: "#" + cssEscape(value), code: `By.id("${selString(value)}")` };
      case "name":
        return { testType: "css", testValue: `[name="${selString(value)}"]`, code: `By.name("${selString(value)}")` };
      case "className": {
        const classes = value.trim().split(/\s+/).filter(Boolean);
        return {
          testType: "css",
          testValue: classes.map((c) => "." + cssEscape(c)).join(""),
          code: `By.className("${selString(classes[0] || value)}")`
        };
      }
      case "tagName":
        return { testType: "css", testValue: value, code: `By.tagName("${selString(value)}")` };
      case "linkText":
        return {
          testType: "xpath",
          testValue: `//a[normalize-space()=${xpathLiteral(value)}]`,
          code: `By.linkText("${selString(value)}")`
        };
      case "partialLinkText":
        return {
          testType: "xpath",
          testValue: `//a[contains(normalize-space(.),${xpathLiteral(value)})]`,
          code: `By.partialLinkText("${selString(value)}")`
        };
      case "cssSelector":
        return { testType: "css", testValue: value, code: `By.cssSelector("${selString(value)}")` };
      case "xpath":
        return { testType: "xpath", testValue: value, code: `By.xpath("${selString(value)}")` };
      default:
        return { testType: null, testValue: null, code: null };
    }
  };

  const addSeleniumRows = (payload) => {
    const rows = [];
    for (const item of payload.selenium || []) {
      if (!item || !item.value) continue;
      const info = seleniumInfo(item);
      if (!info.code) continue;
      rows.push({
        scope: "Selenium", type: "selenium-" + item.type, testType: info.testType,
        testValue: info.testValue, value: info.code, raw: item.value,
        count: item.count, label: "By." + item.type,
        key: "selenium::" + item.type + "::" + item.value
      });
    }
    return rows;
  };

  const FORMAT_LABELS = {
    "cypress-css": "Cypress · CSS",
    "cypress-xpath": "Cypress · XPath",
    jquery: "jQuery",
    js: "JS path",
    "js-xpath": "JS XPath",
    testRigor: "testRigor",
    "cypress-shadow": "Cypress · shadow",
    "selenium-frame": "Selenium frame switch",
    "selenium-shadow": "Selenium shadow root"
  };

  const addFormatRows = (payload) => {
    const rows = [];
    for (const item of payload.formats || []) {
      if (!item || !item.code) continue;
      rows.push({
        scope: "Formats", type: item.type, value: item.code,
        count: null, label: FORMAT_LABELS[item.type] || item.type,
        key: "format::" + item.type + "::" + item.code, testable: false
      });
    }
    return rows;
  };

  const buildGroups = (payload) => {
    if (!payload) return { css: [], xpath: [], axes: [], pw: [], selenium: [], formats: [] };
    return {
      css: addCssRows(payload),
      xpath: addXpathRows(payload),
      axes: addAxesRows(payload),
      pw: addPlaywrightRows(payload),
      selenium: addSeleniumRows(payload),
      formats: addFormatRows(payload)
    };
  };

  const allRows = () => GROUPS.reduce((list, group) => list.concat(state.groups[group.key] || []), []);
  const uniqueCount = (rows) => rows.filter((row) => row.count === 1).length;

  /* ---------------------------------------------------------------- */
  /* Row rendering                                                    */
  /* ---------------------------------------------------------------- */

  const rowStrategy = (row) => {
    if (row.scope === "Selenium" || row.scope === "Formats") return "other";
    if (row.scope === "Playwright") {
      return /^getby/i.test(row.label || "") ? "semantic" : "path";
    }
    const label = String(row.label || "").toLowerCase();
    if (label.includes("attr:") || label.startsWith("contains:")) return "attr";
    if (label === "id" || label === "id+tag" || label === "parent-id") return "id";
    if (label === "class" || label === "classes" || label === "tag+class") return "class";
    if (label.includes("text")) return "text";
    if (label.includes("path") || label.includes("positional") || label.includes("absolute") ||
        label.includes("indexed") || label.includes("nth") || label.includes("ancestor") ||
        label.includes("descendant") || label.includes("sibling") || label.includes("following") ||
        label.includes("preceding") || label.includes("common-ancestor")) return "path";
    return "other";
  };

  const matchesFilter = (row) => {
    if (state.settings.strategy !== "all" && rowStrategy(row) !== state.settings.strategy) return false;
    if (!state.filter) return true;
    const haystack = [row.value, row.raw, row.label, row.type, row.scope]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(state.filter);
  };

  const visibleRows = (rows) => rows.filter((row) => {
    if (state.settings.unique && row.count !== 1) return false;
    return matchesFilter(row);
  });

  const updateCountBadge = (badge, count) => {
    badge.className = "pill count " + countTone(count);
    badge.textContent = countText(count);
    badge.title = countTitle(count);
  };

  const isSaved = (row) => state.saved.some((entry) => entry.key === row.key);

  const refreshSaveButtons = () => {
    const buttons = document.querySelectorAll(".icon-btn[data-save-key]");
    for (const button of buttons) {
      const saved = state.saved.some((entry) => entry.key === button.dataset.saveKey);
      button.classList.toggle("is-saved", saved);
      button.setAttribute("aria-pressed", saved ? "true" : "false");
      button.title = saved ? "Remove from saved locators" : "Save locator";
      button.setAttribute("aria-label", button.title);
      const row = button.closest(".loc-row");
      if (row) row.classList.toggle("is-saved", saved);
    }
  };

  const locatorMap = (payload) => {
    const groups = buildGroups(payload);
    const map = new Map();
    for (const group of GROUPS) {
      for (const row of groups[group.key] || []) {
        const key = row.type + "::" + (row.raw || row.value);
        map.set(key, row);
      }
    }
    return map;
  };

  const renderDiff = () => {
    const card = $("di-diff");
    if (!card) return;
    const previous = state.previousPayload;
    const current = state.payload;
    if (!previous || !current || previous.url !== current.url) {
      card.hidden = true;
      return;
    }
    const before = locatorMap(previous);
    const after = new Map();
    for (const row of allRows()) after.set(row.type + "::" + (row.raw || row.value), row);
    const added = [];
    const removed = [];
    const changed = [];
    for (const [key, row] of after) {
      if (!before.has(key)) added.push(row);
      else {
        const old = before.get(key);
        if (typeof old.count === "number" && typeof row.count === "number" && old.count !== row.count) {
          changed.push({ row, oldCount: old.count });
        }
      }
    }
    for (const [key, row] of before) if (!after.has(key)) removed.push(row);
    if (!added.length && !removed.length && !changed.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const summary = $("di-diff-summary");
    summary.textContent = `Changes since previous pick · +${added.length} −${removed.length}` +
      (changed.length ? ` · ${changed.length} count change${changed.length === 1 ? "" : "s"}` : "");
    const body = $("di-diff-body");
    body.textContent = "";
    const addGroup = (label, items, tone) => {
      if (!items.length) return;
      const group = el("div", "diff-group");
      group.appendChild(el("div", "diff-label", label));
      for (const item of items.slice(0, 6)) {
        group.appendChild(el("div", "diff-item " + tone, item.text));
      }
      if (items.length > 6) group.appendChild(el("div", "diff-label", `+${items.length - 6} more`));
      body.appendChild(group);
    };
    addGroup("Added", added.map((row) => ({ text: row.value })), "add");
    addGroup("Removed", removed.map((row) => ({ text: row.value })), "remove");
    addGroup("Count changed", changed.map((entry) => ({ text: `${entry.row.value} · ${entry.oldCount} → ${entry.row.count}` })), "change");
  };

  const refreshStats = () => {
    const stats = $("di-stats");
    if (!stats) return;
    const rows = allRows();
    stats.textContent = rows.length ? `${rows.length} locators · ${uniqueCount(rows)} unique` : "";
  };

  const setRowCount = (row, count) => {
    row.count = count;
    const node = state.countNodes.get(row.key);
    if (node) updateCountBadge(node.badge, count);
    refreshStats();
    renderDiff();
  };

  const testRow = async (row, badge) => {
    if (!row.testType || !row.testValue) return;
    setStatus("Testing " + row.type + " locator…");
    try {
      const response = await sendToTab({
        type: "DI_TEST", locatorType: row.testType, value: row.testValue, highlight: true
      });
      if (!response) throw new Error("No response from the page.");
      if (typeof response.count === "number") {
        setRowCount(row, response.count);
        if (badge) updateCountBadge(badge, response.count);
      }
      const savedEntry = state.saved.find((entry) => entry.key === row.key);
      if (savedEntry) {
        savedEntry.count = typeof response.count === "number" ? response.count : savedEntry.count;
        savedEntry.error = response.ok ? "" : (response.error || "No match");
        persistSaved();
        renderSaved();
      }
      const tone = response.ok ? "ok" : "bad";
      const message = response.ok
        ? `Valid ${String(response.type || "").toUpperCase()}: ${response.count} match${response.count === 1 ? "" : "es"} · highlighted`
        : `Invalid: ${response.error || "no match"}`;
      showResult(message, tone);
      setStatus(message, tone);
      const live = $("di-live-badge");
      if (live) {
        live.hidden = false;
        live.className = "pill live " + tone;
        live.textContent = response.ok ? `${response.type} · ${response.count}` : "no match";
      }
      return response;
    } catch (error) {
      const message = friendlyError(error);
      showResult(message, "bad");
      setStatus(message, "bad");
      return null;
    }
  };

  const fillTester = (row) => {
    const input = $("di-input");
    if (!input) return;
    input.value = row.testValue || row.raw || row.value;
    const type = row.testType || "auto";
    $("di-type").value = ["css", "xpath", "playwright"].includes(type) ? type : "auto";
    $("di-tester-card").scrollIntoView({ block: "nearest", behavior: "smooth" });
    input.focus();
    input.select();
    scheduleLiveTest();
  };

  const suggestedName = (row) => {
    const tag = state.payload && state.payload.element ? state.payload.element.tag : "element";
    return [tag, row.label || row.type].filter(Boolean).join(" · ");
  };

  const toggleSaved = (row) => {
    const index = state.saved.findIndex((entry) => entry.key === row.key);
    if (index >= 0) {
      state.saved.splice(index, 1);
      toast("Removed from saved locators");
    } else {
      state.saved.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        key: row.key,
        name: suggestedName(row),
        scope: row.scope,
        type: row.type,
        value: displayValue(row),
        testType: row.testType || null,
        testValue: row.testValue || null,
        count: typeof row.count === "number" ? row.count : null,
        label: row.label || "",
        url: state.payload && state.payload.url ? state.payload.url : "",
        savedAt: Date.now()
      });
      toast("Saved locator", "ok");
    }
    persistSaved();
    renderSaved();
    refreshSaveButtons();
  };

  const buildRow = (row) => {
    const wrapper = el("div", "loc-row");
    if (row.isBest) wrapper.classList.add("is-best");
    if (isSaved(row)) wrapper.classList.add("is-saved");

    const main = el("div", "loc-main");
    const value = displayValue(row);
    const code = el("code", "loc-value", value);
    code.title = value;
    main.appendChild(code);

    const meta = el("div", "loc-meta");
    let badge = null;
    if (typeof row.count === "number" || row.testType) {
      badge = el("span", "pill count " + countTone(row.count), countText(row.count));
      badge.title = countTitle(row.count);
      state.countNodes.set(row.key, { badge, row });
      meta.appendChild(badge);
    }

    if (row.label) meta.appendChild(el("span", "pill", row.label));
    if (row.count === 1) meta.appendChild(el("span", "pill ok", "unique"));
    if (row.count === 0) meta.appendChild(el("span", "pill bad", "no match"));
    main.appendChild(meta);
    wrapper.appendChild(main);

    const actions = el("div", "loc-actions");
    if (row.testable !== false && row.testType) {
      actions.appendChild(iconButton("test", "Test & highlight", () => testRow(row, badge)));
    }
    if (row.testType) {
      actions.appendChild(iconButton("edit", "Edit in tester", () => fillTester(row)));
    }
    const saveButton = iconButton("star", "Save locator", () => toggleSaved(row));
    saveButton.dataset.saveKey = row.key;
    saveButton.setAttribute("aria-pressed", isSaved(row) ? "true" : "false");
    if (isSaved(row)) saveButton.classList.add("is-saved");
    actions.appendChild(saveButton);

    actions.appendChild(iconButton("copy", "Copy locator", async (button) => {
      const ok = await copyText(displayValue(row), "Copied locator");
      if (ok) {
        button.classList.add("success");
        setTimeout(() => button.classList.remove("success"), 900);
      }
    }));
    wrapper.appendChild(actions);
    return wrapper;
  };

  const groupMetaText = (all, visible) => {
    const measured = all.filter((row) => typeof row.count === "number");
    let text = `${all.length} locator${all.length === 1 ? "" : "s"}`;
    if (measured.length) text += ` · ${uniqueCount(all)} unique`;
    if (visible.length !== all.length) text += ` · ${visible.length} shown`;
    return text;
  };

  const renderGroup = (group) => {
    const card = $(group.card);
    const container = $(group.rows);
    if (!card || !container) return;
    const all = state.groups[group.key] || [];
    if (!all.length) {
      if (group.key === "axes" && (state.reference || (state.payload && state.payload.reference))) {
        card.hidden = false;
        container.textContent = "";
        container.appendChild(el("div", "rows-empty", "Reference set — pick the target element to generate axes XPath."));
        const meta = $(group.meta);
        if (meta) meta.textContent = "reference set";
        card.classList.toggle("collapsed", !!state.settings.collapsed[group.card]);
        const toggle = card.querySelector(".section-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", state.settings.collapsed[group.card] ? "false" : "true");
      } else {
        card.hidden = true;
        container.textContent = "";
      }
      return;
    }
    card.hidden = false;
    const rows = visibleRows(all);
    container.textContent = "";
    if (!rows.length) {
      container.appendChild(el("div", "rows-empty",
        state.settings.unique || state.filter
          ? "No locators match the current filter."
          : "No locators were generated for this element."));
    } else {
      for (const row of rows) container.appendChild(buildRow(row));
    }
    const meta = $(group.meta);
    if (meta) meta.textContent = groupMetaText(all, rows);
    card.classList.toggle("collapsed", !!state.settings.collapsed[group.card]);
    const toggle = card.querySelector(".section-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", state.settings.collapsed[group.card] ? "false" : "true");
  };

  /* ---------------------------------------------------------------- */
  /* Element info                                                     */
  /* ---------------------------------------------------------------- */

  const summaryText = () => {
    const payload = state.payload;
    if (!payload) return "";
    const element = payload.element || {};
    const lines = [
      `${element.tag || "element"}${element.id ? "#" + element.id : ""}`,
      "URL: " + (payload.url || ""),
      "Role: " + (element.role || "—"),
      "Accessible name: " + (element.accessibleName || "—"),
      "Classes: " + (element.classes || "—"),
      "Text: " + (element.text || "—"),
      "Visible: " + (element.visible == null ? "—" : element.visible ? "yes" : "no")
    ];
    if (payload.reference) {
      const ref = payload.reference;
      lines.push("Reference: " + (ref.tag || "element") + (ref.id ? "#" + ref.id : ""));
    }
    const css = payload.css || {};
    const xpath = payload.xpath || {};
    if (css.best) lines.push(`CSS: ${css.best.selector} (${css.best.count})`);
    if (xpath.best) lines.push(`XPath: ${xpath.best.xpath} (${xpath.best.count})`);
    if (xpath.absolute) lines.push(`Absolute XPath: ${xpath.absolute}`);
    if (payload.frame && payload.frame.xpath && payload.frame.xpath.xpath) {
      lines.push(`Frame XPath: ${payload.frame.xpath.xpath}`);
    }
    const axes = (payload.axes || [])[0];
    if (axes) lines.push(`Axes XPath: ${axes.xpath} (${axes.count})`);
    const pw = (payload.playwright || [])[0];
    if (pw) lines.push(`Playwright: ${pw.selector} (${pw.count})`);
    return lines.join("\n");
  };

  const renderInfo = () => {
    const payload = state.payload;
    $("di-info-card").hidden = !payload;
    $("di-empty").hidden = !!payload;
    if (!payload) {
      $("di-stats").textContent = "";
      return;
    }
    const element = payload.element || {};
    const info = $("di-info");
    info.textContent = "";
    const pairs = [
      ["Tag", element.tag],
      ["ID", element.id],
      ["Classes", element.classes],
      ["Role", element.role],
      ["Accessible name", element.accessibleName],
      ["Text", element.text],
      ["Name", element.name],
      ["Visible", element.visible == null ? "" : element.visible ? "yes" : "no"],
      ["URL", payload.url]
    ];
    for (const [key, value] of pairs) {
      const dt = el("dt", null, key);
      const dd = el("dd");
      if (key === "ID" && value) dd.appendChild(el("code", null, "#" + value));
      else if (key === "Classes" && value) dd.appendChild(el("code", null, value));
      else dd.textContent = value || "—";
      info.append(dt, dd);
    }

    const context = $("di-context");
    context.textContent = "";
    const badges = [];
    if (payload.shadow && payload.shadow.inShadow) {
      const hosts = (payload.shadow.hosts || []).length;
      badges.push(["shadow DOM · " + hosts + " host" + (hosts === 1 ? "" : "s"), "accent"]);
    }
    if (payload.frame && payload.frame.depth) badges.push(["iframe depth " + payload.frame.depth, "accent"]);
    const css = payload.css || {};
    const xpath = payload.xpath || {};
    if (css.best && css.best.count !== 1) badges.push(["best CSS is not unique", "warn"]);
    if (!css.best) badges.push(["no CSS candidate", "bad"]);
    if (payload.shadow && payload.shadow.inShadow && !xpath.absolute) {
      badges.push(["XPath unavailable in shadow DOM", "warn"]);
    }
    if (element.visible === false) badges.push(["element is hidden", "warn"]);
    if (payload.reference) {
      const ref = payload.reference;
      badges.push(["reference: " + (ref.tag || "element") + (ref.id ? "#" + ref.id : ""), "accent"]);
    }
    if (!badges.length) badges.push(["ready", "ok"]);
    for (const [text, tone] of badges) context.appendChild(el("span", "badge " + (tone || ""), text));

    const paths = $("di-paths");
    paths.textContent = "";
    const pathRows = [];
    if (payload.frame && Array.isArray(payload.frame.chain) && payload.frame.chain.length) {
      pathRows.push(["Frames", payload.frame.chain.map((frame) =>
        `${frame.tag || "iframe"}${frame.id ? "#" + frame.id : ""}${frame.name ? `[name="${frame.name}"]` : ""}`
      ).join(" > ")]);
    }
    if (payload.shadow && Array.isArray(payload.shadow.hosts) && payload.shadow.hosts.length) {
      pathRows.push(["Shadow hosts", payload.shadow.hosts.map((host) =>
        `${host.tag || "host"}${host.id ? "#" + host.id : ""}`
      ).join(" > ")]);
    }
    if (payload.shadow && Array.isArray(payload.shadow.hostCss) && payload.shadow.hostCss.length) {
      pathRows.push(["Shadow CSS", payload.shadow.hostCss.join(" > ")]);
    }
    if (payload.frame && payload.frame.xpath && payload.frame.xpath.xpath) {
      pathRows.push(["Frame XPath", payload.frame.xpath.xpath]);
    }
    if (pathRows.length) {
      paths.hidden = false;
      for (const [label, value] of pathRows) {
        const line = el("div");
        line.appendChild(el("b", null, label + ":"));
        line.appendChild(el("code", null, value));
        paths.appendChild(line);
      }
    } else {
      paths.hidden = true;
    }
    refreshStats();
  };

  /* ---------------------------------------------------------------- */
  /* Copy / export / saved                                            */
  /* ---------------------------------------------------------------- */

  const groupText = (key) => visibleRows(state.groups[key] || []).map(displayValue).join("\n");

  const allLocatorText = () => {
    if (!state.payload) return "";
    const lines = ["DOM Inspector — " + (state.payload.url || "")];
    let any = false;
    for (const group of GROUPS) {
      const rows = visibleRows(state.groups[group.key] || []);
      if (!rows.length) continue;
      any = true;
      lines.push("", group.label);
      for (const row of rows) lines.push(displayValue(row));
    }
    return any ? lines.join("\n").trim() : "";
  };

  const snapshot = () => ({
    extension: "DOM Inspector",
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    page: state.payload ? { url: state.payload.url, frame: state.payload.frame, shadow: state.payload.shadow } : null,
    element: state.payload ? state.payload.element : null,
    locators: allRows().map((row) => ({
      scope: row.scope,
      type: row.type,
      label: row.label || "",
      value: displayValue(row),
      raw: row.raw || row.value,
      count: typeof row.count === "number" ? row.count : null,
      testType: row.testType || null,
      testValue: row.testValue || null
    })),
    saved: state.saved
  });

  const matchesSavedFilter = (entry) => {
    const filter = state.savedFilter.trim().toLowerCase();
    if (!filter) return true;
    return [entry.name, entry.type, entry.value, entry.url, entry.scope, entry.label]
      .filter(Boolean).join(" ").toLowerCase().includes(filter);
  };

  const moveSaved = (entry, delta) => {
    const from = state.saved.indexOf(entry);
    const visible = state.saved.filter(matchesSavedFilter);
    const visibleIndex = visible.indexOf(entry);
    const neighbour = visible[visibleIndex + delta];
    const to = neighbour ? state.saved.indexOf(neighbour) : -1;
    if (from < 0 || to < 0) return;
    const next = state.saved.slice();
    [next[from], next[to]] = [next[to], next[from]];
    state.saved = next;
    persistSaved();
    renderSaved();
    refreshSaveButtons();
  };

  const renderSaved = () => {
    const list = $("di-saved");
    const meta = $("di-saved-meta");
    const empty = $("di-saved-empty");
    list.textContent = "";
    meta.textContent = String(state.saved.length);
    empty.hidden = state.saved.length > 0;

    if (!state.saved.length && state.savedFilter) state.savedFilter = "";
    for (const id of ["di-saved-check", "di-saved-pom", "di-saved-json", "di-saved-csv", "di-saved-clear"]) {
      const button = $(id);
      if (button) button.disabled = state.saved.length === 0 || state.savedBusy;
    }
    const importButton = $("di-saved-import");
    if (importButton) importButton.disabled = state.savedBusy;
    const filterInput = $("di-saved-filter");
    filterInput.hidden = state.saved.length === 0;
    if (filterInput.value !== state.savedFilter) filterInput.value = state.savedFilter;
    const entries = state.saved.filter(matchesSavedFilter);
    if (!entries.length && state.saved.length) {
      list.appendChild(el("div", "rows-empty", "No saved locators match the filter."));
    }
    for (const entry of entries) {
      const visibleIndex = entries.indexOf(entry);
      const row = el("div", "loc-row saved-row");
      const main = el("div", "loc-main");

      const name = document.createElement("input");
      name.type = "text";
      name.className = "saved-name";
      name.value = entry.name || "";
      name.title = "Saved locator name";
      name.setAttribute("aria-label", "Saved locator name");
      name.disabled = state.savedBusy;
      name.addEventListener("change", () => {
        entry.name = name.value.trim() || "Untitled locator";
        name.value = entry.name;
        persistSaved();
      });
      name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") name.blur();
      });
      main.appendChild(name);

      const code = el("code", "loc-value", entry.value);
      code.title = entry.value;
      main.appendChild(code);
      if (entry.error) main.appendChild(el("div", "heal-note bad", entry.error));

      const rowMeta = el("div", "loc-meta");
      rowMeta.appendChild(el("span", "pill", entry.label || entry.type));
      if (typeof entry.count === "number") {
        rowMeta.appendChild(el("span", "pill count " + countTone(entry.count), countText(entry.count)));
      }
      if (entry.scope) rowMeta.appendChild(el("span", "pill", entry.scope));
      main.appendChild(rowMeta);
      row.appendChild(main);

      const actions = el("div", "loc-actions");
      const target = savedTestTarget(entry);
      if (target && entry.error) {
        const fix = iconButton("fix", "Fix saved locator with the repair engine", () => fixSavedEntry(entry));
        fix.disabled = state.savedBusy;
        actions.appendChild(fix);
      }
      if (target) {
        const test = iconButton("test", "Test & highlight", () => testSavedEntry(entry));
        test.disabled = state.savedBusy;
        actions.appendChild(test);
        const edit = iconButton("edit", "Edit in tester", () => fillTester({
          key: entry.key, scope: entry.scope, type: entry.type,
          testType: target.type, testValue: target.value,
          value: entry.value, raw: target.value, count: entry.count
        }));
        edit.disabled = state.savedBusy;
        actions.appendChild(edit);
      }
      actions.appendChild(iconButton("copy", "Copy locator", () => copyText(entry.value, "Copied saved locator")));
      const up = iconButton("up", "Move up", () => moveSaved(entry, -1));
      up.disabled = state.savedBusy || visibleIndex === 0;
      actions.appendChild(up);
      const down = iconButton("down", "Move down", () => moveSaved(entry, 1));
      down.disabled = state.savedBusy || visibleIndex === entries.length - 1;
      actions.appendChild(down);
      const trash = iconButton("trash", "Delete saved locator", () => {
        state.saved = state.saved.filter((item) => item.id !== entry.id);
        persistSaved();
        renderSaved();
        refreshSaveButtons();
        toast("Deleted saved locator");
      });
      trash.disabled = state.savedBusy;
      actions.appendChild(trash);
      row.appendChild(actions);
      list.appendChild(row);
    }
  };

  const savedTestTarget = (entry) => {
    if (!entry) return null;
    const type = entry.testType || (["css", "xpath", "playwright"].includes(entry.type) ? entry.type : null);
    const value = entry.testValue || entry.value;
    if (!type || !value) return null;
    return { type, value };
  };

  const testSavedEntry = async (entry) => {
    const target = savedTestTarget(entry);
    if (!target) return toast("Saved snippet is not a testable locator", "bad");
    const response = await testRow({
      key: entry.key,
      scope: entry.scope,
      type: entry.type,
      testType: target.type,
      testValue: target.value,
      value: entry.value,
      count: entry.count
    }, null);
    if (!response) return;
    entry.count = typeof response.count === "number" ? response.count : 0;
    entry.error = response.ok ? "" : (response.error || "No match");
    persistSaved();
    renderSaved();
    refreshSaveButtons();
  };

  const fixSavedEntry = async (entry) => {
    if (!entry || state.savedBusy) return;
    const target = savedTestTarget(entry);
    if (!target) return toast("Saved snippet is not a testable locator", "bad");
    state.savedBusy = true;
    renderSaved();
    setStatus("Fixing saved locator…");
    try {
      const repair = await repairSelector(target.value);
      if (!repair || !repair.ok || !repair.fixed) {
        const message = (repair && repair.error) || "No matching element found";
        const live = state.saved.find((item) => item.id === entry.id);
        if (!live) return toast("Saved locator was removed", "bad");
        live.error = message;
        persistSaved();
        toast("Fix failed: " + message, "bad");
        setStatus("Fix failed", "bad");
        return;
      }
      const candidates = [];
      const seen = new Set();
      const addCandidate = (value, type) => {
        if (!value || seen.has(value)) return;
        seen.add(value);
        candidates.push({ value, type: type || detectType(value) });
      };
      addCandidate(repair.fixed, repair.type);
      const locators = repair.locators || {};
      addCandidate(locators.css, "css");
      addCandidate(locators.xpath, "xpath");
      addCandidate(locators.playwright, "playwright");
      let verified = null;
      let verifyError = "";
      for (const candidate of candidates) {
        const result = await healVerify(candidate.value);
        if (result && result.ok && result.count === 1) {
          verified = { value: candidate.value, type: result.type || candidate.type };
          break;
        }
        if (result && result.error && !verifyError) verifyError = result.error;
      }
      const live = state.saved.find((item) => item.id === entry.id);
      if (!live) return toast("Saved locator was removed", "bad");
      if (!verified) {
        live.error = verifyError ? "No unique fix verified: " + verifyError : "No candidate fix was unique.";
        persistSaved();
        renderSaved();
        toast("Fix failed: no unique replacement", "bad");
        setStatus("Fix failed", "bad");
        return;
      }
      live.type = verified.type;
      live.testType = verified.type;
      live.testValue = verified.value;
      live.value = verified.type === "playwright"
        ? convertPlaywright(verified.value, state.settings.lang, state.settings.await)
        : verified.value;
      live.label = "";
      live.scope = verified.type === "css" ? "CSS" : verified.type === "xpath" ? "XPath" : "Playwright";
      const nextKey = verified.type + "::" + verified.value;
      const keyTaken = state.saved.some((item) => item.id !== live.id && item.key === nextKey);
      if (!keyTaken) live.key = nextKey;
      live.count = 1;
      live.error = "";
      persistSaved();
      refreshSaveButtons();
      toast("Saved locator fixed", "ok");
      setStatus("Fixed saved locator · 1 match", "ok");
    } catch (error) {
      const live = state.saved.find((item) => item.id === entry.id);
      if (live) {
        live.error = friendlyError(error);
        persistSaved();
      }
      toast("Fix failed", "bad");
      setStatus("Fix failed", "bad");
    } finally {
      state.savedBusy = false;
      renderSaved();
    }
  };

  const checkSaved = async () => {
    if (!state.saved.length) return toast("No saved locators to check", "bad");
    setStatus("Checking saved locators…");
    state.savedBusy = true;
    const button = $("di-saved-check");
    button.disabled = true;
    renderSaved();
    let unique = 0;
    let many = 0;
    let broken = 0;
    let skipped = 0;
    const list = state.saved;
    try {
      for (const entry of list) {
        const target = savedTestTarget(entry);
        if (!target) {
          entry.count = null;
          entry.error = "";
          skipped += 1;
          continue;
        }
        try {
          const response = await sendToTab({ type: "DI_TEST", locatorType: target.type, value: target.value, highlight: false });
          if (!response) throw new Error("No response from the page");
          entry.count = typeof response.count === "number" ? response.count : 0;
          entry.error = response.ok ? "" : (response.error || "No match");
        } catch (error) {
          entry.count = 0;
          entry.error = friendlyError(error);
        }
        if (entry.count === 1) unique += 1;
        else if (typeof entry.count === "number" && entry.count > 1) many += 1;
        else broken += 1;
        renderSaved();
      }
      if (state.saved === list) {
        persistSaved();
      } else {
        const current = new Map(state.saved.map((entry) => [entry.id, entry]));
        for (const entry of list) {
          const live = current.get(entry.id);
          if (!live) continue;
          live.count = entry.count;
          live.error = entry.error;
        }
        persistSaved();
      }
      const notes = [`${unique} unique`];
      if (many) notes.push(`${many} not unique`);
      if (broken) notes.push(`${broken} broken`);
      if (skipped) notes.push(`${skipped} not testable`);
      const checked = list.length - skipped;
      const scope = skipped ? `${checked} of ${list.length}` : String(list.length);
      const message = `Checked ${scope} saved locator${list.length === 1 ? "" : "s"} · ${notes.join(" · ")}`;
      toast(message, broken ? "bad" : "ok");
      setStatus(message, broken || many ? "warn" : "ok");
    } finally {
      state.savedBusy = false;
      button.disabled = false;
      renderSaved();
    }
  };

  const pomMethodName = (entry, used) => {
    const parts = String(entry.name || entry.type || "locator")
      .replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
    let name = parts.map((part, index) => {
      const lower = part.charAt(0).toLowerCase() + part.slice(1);
      return index === 0 ? lower : part.charAt(0).toUpperCase() + part.slice(1);
    }).join("");
    if (!name) name = "locator";
    if (/^[0-9]/.test(name)) name = "locator" + name;
    if (["constructor", "prototype", "__proto__", "hasOwnProperty", "toString", "valueOf"].includes(name)) {
      name = "locator" + name.charAt(0).toUpperCase() + name.slice(1);
    }
    let unique = name;
    let suffix = 2;
    while (used.has(unique)) {
      unique = name + suffix;
      suffix += 1;
    }
    used.add(unique);
    return unique;
  };

  const pomSource = () => {
    const entries = state.saved.map((entry) => ({ entry, target: savedTestTarget(entry) }))
      .filter((item) => item.target);
    const used = new Set();
    const methods = [];
    for (const { entry, target } of entries) {
      const name = pomMethodName(entry, used);
      let expression;
      if (target.type === "playwright") {
        const raw = String(target.value).replace(/^page\./, "");
        expression = "this.page." + raw;
      } else {
        expression = "this.page.locator(" + JSON.stringify(String(target.value)) + ")";
      }
      const note = [target.type, typeof entry.count === "number" ? entry.count + " match" + (entry.count === 1 ? "" : "es") : ""]
        .filter(Boolean).join(" · ");
      const label = String(entry.name || entry.type || "locator")
        .replace(/\*\//g, "* /")
        .replace(/[\r\n\u2028\u2029]+/g, " ")
        .trim() || "locator";
      methods.push(`  /** ${label}${note ? " — " + note : ""} */\n  ${name}() {\n    return ${expression};\n  }`);
    }
    const header = [
      "/**",
      " * Page locators generated by DOM Inspector from locally saved locators.",
      " * Review before committing; counts were captured when each locator was saved.",
      " */",
      "export class PageLocators {",
      "  constructor(page) {",
      "    this.page = page;",
      "  }",
      ""
    ];
    return header.concat(methods.flatMap((method) => [method, ""])).concat(["}"]).join("\n") + "\n";
  };

  const mergeSavedEntries = (incoming) => {
    const existing = new Set(state.saved.map((entry) => entry.key || (entry.type + "::" + (entry.testValue || entry.value))));
    const added = [];
    for (const raw of incoming.slice(0, 500)) {
      if (!raw || typeof raw !== "object" || typeof raw.value !== "string" || !raw.value.trim()) continue;
      const type = typeof raw.type === "string" && raw.type ? raw.type : "css";
      const testType = ["css", "xpath", "playwright"].includes(raw.testType) ? raw.testType : null;
      const testValue = typeof raw.testValue === "string" && raw.testValue ? raw.testValue : null;
      const key = typeof raw.key === "string" && raw.key ? raw.key : (type + "::" + (testValue || raw.value));
      if (existing.has(key)) continue;
      existing.add(key);
      added.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "-" + added.length,
        key,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Imported locator",
        scope: typeof raw.scope === "string" ? raw.scope : "Imported",
        type,
        value: raw.value,
        testType,
        testValue,
        count: typeof raw.count === "number" && Number.isFinite(raw.count) ? raw.count : null,
        label: typeof raw.label === "string" ? raw.label : "",
        url: typeof raw.url === "string" ? raw.url : "",
        savedAt: typeof raw.savedAt === "number" && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now()
      });
    }
    if (!added.length) {
      toast("No new saved locators to import", "bad");
      return 0;
    }
    state.saved = added.concat(state.saved);
    persistSaved();
    renderSaved();
    refreshSaveButtons();
    toast(`Imported ${added.length} saved locator${added.length === 1 ? "" : "s"}`, "ok");
    return added.length;
  };

  const parseCsv = (text) => {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((cells) => cells.some((cell) => String(cell).trim()));
  };

  const importSavedCsvText = (text) => {
    const rows = parseCsv(text);
    if (rows.length < 2) return toast("CSV has no locator rows", "bad");
    const header = rows[0].map((cell) => String(cell).trim().toLowerCase());
    const index = (name) => header.indexOf(name);
    const hasHeader = index("value") !== -1;
    const at = (cells, name, fallback) => {
      const position = hasHeader ? index(name) : fallback;
      return position >= 0 && position < cells.length ? cells[position] : "";
    };
    const entries = [];
    for (const cells of rows.slice(hasHeader ? 1 : 0)) {
      const value = at(cells, "value", 3);
      if (!value) continue;
      const countText = at(cells, "count", 6);
      const savedText = at(cells, "savedat", 8);
      const savedAt = /^\d+$/.test(savedText) ? Number(savedText) : Date.parse(savedText);
      entries.push({
        name: at(cells, "name", 0),
        scope: at(cells, "scope", 1),
        type: at(cells, "type", 2),
        value,
        testType: at(cells, "testtype", 4),
        testValue: at(cells, "testvalue", 5),
        count: /^\d+$/.test(String(countText).trim()) ? Number(countText) : null,
        url: at(cells, "url", 7),
        savedAt: Number.isFinite(savedAt) ? savedAt : Date.now()
      });
    }
    return mergeSavedEntries(entries);
  };

  const importSavedFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const isCsv = /\.csv$/i.test(file.name || "") || (!/^\s*[\[{]/.test(text) && text.includes(","));
      if (isCsv) importSavedCsvText(text);
      else {
        const parsed = JSON.parse(text);
        const incoming = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.saved) ? parsed.saved : null);
        if (!incoming) throw new Error("Expected a saved locator array or an exported JSON object.");
        mergeSavedEntries(incoming);
      }
    } catch (error) {
      toast("Import failed: " + (error.message || error), "bad");
    } finally {
      $("di-saved-import-file").value = "";
    }
  };

  const exportSavedPom = () => {
    const entries = state.saved.filter((entry) => savedTestTarget(entry));
    if (!entries.length) return toast("Save a testable locator first", "bad");
    const ok = download(`dom-inspector-page-locators-${stamp()}.js`, "text/javascript", pomSource());
    toast(ok ? "POM snippet exported" : "Download failed", ok ? "ok" : "bad");
  };

  const exportSavedJson = () => {
    if (!state.saved.length) return toast("No saved locators yet", "bad");
    const ok = download(`dom-inspector-saved-${stamp()}.json`, "application/json",
      JSON.stringify({ extension: "DOM Inspector", exportedAt: new Date().toISOString(), saved: state.saved }, null, 2));
    toast(ok ? "Saved locators exported" : "Download failed", ok ? "ok" : "bad");
  };

  const csvCell = (value) => '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';

  const exportSavedCsv = () => {
    if (!state.saved.length) return toast("No saved locators yet", "bad");
    const header = ["name", "scope", "type", "value", "testType", "testValue", "count", "url", "savedAt"];
    const lines = [header.join(",")];
    for (const entry of state.saved) {
      lines.push([
        entry.name, entry.scope, entry.type, entry.value, entry.testType,
        entry.testValue, entry.count, entry.url,
        entry.savedAt ? new Date(entry.savedAt).toISOString() : ""
      ].map(csvCell).join(","));
    }
    const ok = download(`dom-inspector-saved-${stamp()}.csv`, "text/csv", lines.join("\r\n"));
    toast(ok ? "CSV exported" : "Download failed", ok ? "ok" : "bad");
  };

  const clearSaved = () => {
    if (!state.saved.length) return toast("No saved locators yet");
    if (!window.confirm(`Remove all ${state.saved.length} saved locator(s)?`)) return;
    state.saved = [];
    persistSaved();
    renderSaved();
    refreshSaveButtons();
    toast("Saved locators cleared");
  };

  const exportAll = () => {
    if (!state.payload) return toast("Pick an element first", "bad");
    const ok = download(`dom-inspector-${stamp()}.json`, "application/json", JSON.stringify(snapshot(), null, 2));
    toast(ok ? "Locators exported as JSON" : "Download failed", ok ? "ok" : "bad");
  };

  /* ---------------------------------------------------------------- */
  /* Driver template                                                  */
  /* ---------------------------------------------------------------- */

  const renderDriver = () => {
    const base = state.settings.driverBase === "xpath" ? "xpath" : "css";
    const payload = state.payload || {};
    const value = base === "xpath"
      ? (payload.xpath && payload.xpath.best ? payload.xpath.best.xpath : "")
      : (payload.css && payload.css.best ? payload.css.best.selector : "");
    const template = state.settings.driver || "";
    const output = template && value ? template.replace(/\{selector\}|xpathvalue|cssvalue/gi, value) : "";
    $("di-driver-output").textContent = output || "Pick an element and enter a template.";
    $("di-driver-copy").disabled = !output;
    $("di-driver-base").value = base;
    if ($("di-driver-template").value !== template) $("di-driver-template").value = template;
  };

  /* ---------------------------------------------------------------- */
  /* Picker and validation                                            */
  /* ---------------------------------------------------------------- */

  const updatePickerUi = () => {
    const pick = $("di-pick");
    if (!pick) return;
    pick.textContent = state.picking ? "Picking…" : "Pick element";
    pick.setAttribute("aria-pressed", state.picking ? "true" : "false");
  };

  const startPicker = async () => {
    try {
      await sendToTab({ type: "DI_START", continuous: !!state.settings.continuous });
      state.picking = true;
      state.contentAvailable = true;
      setHint("");
      updatePickerUi();
      setStatus(
        state.settings.continuous
          ? "Picking continuously — click elements, Esc or Stop to finish."
          : "Picking — click an element. Esc or Stop to cancel."
      );
    } catch (error) {
      const message = friendlyError(error);
      setStatus(message, "bad");
      setHint(message);
      toast(message, "bad");
    }
  };

  const stopPicker = async () => {
    try {
      await sendToTab({ type: "DI_STOP" });
    } catch (_) { /* no content script */ }
    state.picking = false;
    updatePickerUi();
    setStatus("Picker stopped.");
  };

  const clearHighlights = async () => {
    try {
      await sendToTab({ type: "DI_CLEAR" });
      showResult("Highlights cleared.");
    } catch (error) {
      showResult(friendlyError(error), "bad");
    }
  };

  const scheduleLiveTest = () => {
    if (state.liveTimer) clearTimeout(state.liveTimer);
    const input = $("di-input");
    const badge = $("di-live-badge");
    const value = input.value.trim();
    if (!value) {
      badge.hidden = true;
      state.liveSeq += 1;
      return;
    }
    state.liveTimer = setTimeout(() => runLiveTest(value), 420);
  };

  const runLiveTest = async (value) => {
    const sequence = ++state.liveSeq;
    const type = $("di-type").value;
    const badge = $("di-live-badge");
    badge.hidden = false;
    badge.className = "pill live";
    badge.textContent = "checking…";
    try {
      const response = await sendToTab({ type: "DI_TEST", locatorType: type, value, highlight: false });
      if (sequence !== state.liveSeq) return;
      if (!response) throw new Error("No response from the page.");
      badge.className = "pill live " + (response.ok ? "ok" : "bad");
      badge.textContent = response.ok ? `${response.type} · ${response.count}` : "invalid";
      badge.title = response.ok
        ? `${response.count} match${response.count === 1 ? "" : "es"}`
        : response.error || "Invalid locator";
    } catch (error) {
      if (sequence !== state.liveSeq) return;
      badge.className = "pill live bad";
      badge.textContent = "no page";
      badge.title = friendlyError(error);
    }
  };

  const testInput = async () => {
    const value = $("di-input").value.trim();
    if (!value) {
      showResult("Enter a locator first.", "bad");
      $("di-input").focus();
      return;
    }
    if (state.liveTimer) clearTimeout(state.liveTimer);
    state.liveSeq += 1;
    const type = $("di-type").value;
    try {
      const response = await sendToTab({ type: "DI_TEST", locatorType: type, value, highlight: true });
      if (!response) throw new Error("No response from the page.");
      const tone = response.ok ? "ok" : "bad";
      showResult(response.ok
        ? `Valid ${String(response.type || "").toUpperCase()}: ${response.count} match${response.count === 1 ? "" : "es"} · highlighted`
        : `Invalid ${String(response.type || "").toUpperCase()} locator: ${response.error || "no match"}`, tone);
      setStatus(response.ok ? `${response.count} match${response.count === 1 ? "" : "es"} · highlighted` : "No match", tone);
      const badge = $("di-live-badge");
      badge.hidden = false;
      badge.className = "pill live " + tone;
      badge.textContent = response.ok ? `${response.type} · ${response.count}` : "no match";
    } catch (error) {
      const message = friendlyError(error);
      showResult(message, "bad");
      setStatus(message, "bad");
    }
  };

  const fixInput = async () => {
    const input = $("di-input");
    const value = input.value.trim();
    if (!value) {
      showResult("Enter a locator to fix first.", "bad");
      input.focus();
      return;
    }
    const button = $("di-fix");
    button.disabled = true;
    showResult("Finding a stable fix…");
    setStatus("Repairing locator…");
    try {
      const response = await sendToTab({ type: "DI_FIX", value });
      if (!response || !response.ok || !response.fixed) {
        const message = response && response.error ? response.error : "No matching element found";
        showResult("Could not fix: " + message, "bad");
        setStatus("Fix failed", "bad");
        return;
      }
      input.value = response.fixed;
      const type = response.type || detectType(response.fixed);
      $("di-type").value = ["css", "xpath", "playwright"].includes(type) ? type : "auto";
      const label = String(type).toUpperCase();
      if (response.repaired === false) {
        showResult(`Already valid ${label}: ${response.fixed}`, "ok");
        setStatus("Locator is already valid", "ok");
      } else {
        showResult(`Fixed ${label}: ${response.fixed}`, "ok");
        setStatus("Fixed locator", "ok");
      }
      await testInput();
    } catch (error) {
      const message = friendlyError(error);
      showResult("Fix failed: " + message, "bad");
      setStatus("Fix failed", "bad");
    } finally {
      button.disabled = false;
    }
  };

  /* ---------------------------------------------------------------- */
  /* Page actions                                                     */
  /* ---------------------------------------------------------------- */

  const runAction = async (kind) => {
    const value = $("di-input").value.trim();
    if (!value) return toast("Enter a locator first", "bad");
    if (!api || !api.scripting || !api.scripting.executeScript) {
      return toast("Scripting API unavailable in this context", "bad");
    }
    if (typeof pageAction !== "function") return toast("Action runner failed to load", "bad");
    const text = $("di-type-text").value;
    if (kind === "type" && !text) {
      $("di-type-text").focus();
      return toast("Enter text to type first", "bad");
    }
    const type = $("di-type").value;
    const tabId = await resolveTabId(true);
    if (tabId == null) return toast("No active web page", "bad");
    showResult("Running " + kind + "…");
    try {
      const probe = await api.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: pageAction,
        args: [kind, type, value, text, false]
      });
      const hit = (probe || []).find((entry) => entry && entry.result && entry.result.matched > 0);
      if (!hit) {
        showResult("No elements matched — nothing to " + kind + ".", "bad");
        return;
      }
      const run = await api.scripting.executeScript({
        target: { tabId, frameIds: [hit.frameId] },
        func: pageAction,
        args: [kind, type, value, text, true]
      });
      const result = run && run[0] ? run[0].result : null;
      if (!result) {
        showResult("The action returned no result.", "bad");
        return;
      }
      if (!result.performed) {
        showResult(result.error || `Matched ${result.matched} element(s), but the action did not run.`, "warn");
        return;
      }
      const labels = { click: "Clicked", hover: "Hovered", type: "Typed into" };
      const label = labels[kind] || "Acted on";
      showResult(`${label} <${result.tag}> · ${result.matched} match${result.matched === 1 ? "" : "es"} · ${result.url}`, "ok");
      setStatus(`${label} <${result.tag}>`, "ok");
    } catch (error) {
      const message = friendlyError(error);
      showResult("Action failed: " + message, "bad");
      toast(message, "bad");
    }
  };

  /* ---------------------------------------------------------------- */
  /* Reference element / axes                                         */
  /* ---------------------------------------------------------------- */

  const referenceOf = () => state.reference || (state.payload && state.payload.reference) || null;

  const renderReference = () => {
    const ref = referenceOf();
    const chip = $("di-ref-chip");
    const clear = $("di-ref-clear");
    if (ref) {
      chip.hidden = false;
      chip.textContent = "ref: " + (ref.tag || "element") + (ref.id ? "#" + ref.id : "");
      chip.title = "Axes reference: " + (ref.tag || "element") + (ref.id ? "#" + ref.id : "") + (ref.text ? " · " + ref.text : "");
      clear.hidden = false;
    } else {
      chip.hidden = true;
      chip.textContent = "";
      clear.hidden = true;
    }
    const hint = $("di-axes-hint");
    if (hint) hint.hidden = !(ref && !(state.groups.axes || []).length);
  };

  const startReference = async () => {
    try {
      await sendToTab({ type: "DI_START", continuous: false, mode: "reference" });
      state.picking = true;
      updatePickerUi();
      setStatus("Pick the reference element for axes XPath…");
    } catch (error) {
      const message = friendlyError(error);
      setStatus(message, "bad");
      toast(message, "bad");
    }
  };

  const clearReference = async () => {
    try {
      await sendToTab({ type: "DI_CLEAR_REFERENCE" });
    } catch (_) { /* no content script */ }
    state.reference = null;
    if (state.payload) {
      state.payload.reference = null;
      state.payload.axes = [];
    }
    renderAll();
    setStatus("Axes reference cleared.");
  };

  /* ---------------------------------------------------------------- */
  /* Batch selector healing                                           */
  /* ---------------------------------------------------------------- */

  const HEAL_LABELS = {
    pending: "pending",
    checking: "checking…",
    ok: "unique",
    many: "not unique",
    broken: "broken",
    fixed: "fixed",
    "fix-failed": "fix failed"
  };

  const HEAL_TONES = {
    ok: "ok",
    many: "warn",
    broken: "bad",
    fixed: "accent",
    "fix-failed": "bad"
  };

  const healVerify = async (value) => {
    const response = await sendToTab({ type: "DI_TEST", locatorType: "auto", value, highlight: false });
    if (!response) throw new Error("No response from the page.");
    return response;
  };

  const repairSelector = async (value) => {
    try {
      const response = await sendToTab({ type: "DI_FIX", value });
      if (response && typeof response === "object" &&
          !/repair unavailable/i.test(response.error || "")) {
        return response;
      }
    } catch (_) { /* fall back to direct scripting */ }
    if (!api || !api.scripting || !api.scripting.executeScript) {
      return { ok: false, error: "Scripting API unavailable in this context" };
    }
    const tabId = await resolveTabId(true);
    if (tabId == null) return { ok: false, error: "No active web page" };
    const repairFn = (selector) => {
      try {
        const DI = globalThis.DI;
        if (!DI || !DI.repair || typeof DI.repair.fix !== "function") {
          return { ok: false, error: "Repair engine unavailable" };
        }
        return DI.repair.fix(selector);
      } catch (error) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
    };
    const run = async () => {
      const results = await api.scripting.executeScript({
        target: { tabId, allFrames: true }, func: repairFn, args: [value]
      });
      const usable = (results || []).map((entry) => entry && entry.result).filter(Boolean);
      return usable.find((entry) => entry.ok) || usable[0] || null;
    };
    try {
      let result = await run();
      if ((!result || /repair engine unavailable/i.test(result.error || "")) && !state.repairInjected) {
        state.repairInjected = true;
        await api.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: [
            "src/content/util.js",
            "src/content/css.js",
            "src/content/xpath.js",
            "src/content/playwright.js",
            "src/content/formats.js",
            "src/content/validate.js",
            "src/content/repair.js"
          ]
        });
        result = await run();
      }
      return result || { ok: false, error: "Repair engine unavailable" };
    } catch (error) {
      return { ok: false, error: friendlyError(error) };
    }
  };

  const healSummary = () => {
    const rows = state.healRows;
    if (!rows.length) return "0 results";
    const parts = [`${rows.length} selector${rows.length === 1 ? "" : "s"}`];
    const unique = rows.filter((row) => row.status === "ok").length;
    const many = rows.filter((row) => row.status === "many").length;
    const fixed = rows.filter((row) => row.status === "fixed").length;
    const broken = rows.filter((row) => row.status === "broken" || row.status === "fix-failed").length;
    if (unique) parts.push(`${unique} unique`);
    if (many) parts.push(`${many} not unique`);
    if (fixed) parts.push(`${fixed} fixed`);
    if (broken) parts.push(`${broken} broken`);
    return parts.join(" · ");
  };

  const useHealValue = (value, type) => {
    fillTester({
      key: "heal::" + value,
      scope: "Heal",
      type: type || detectType(value),
      testType: type || detectType(value),
      testValue: value,
      value,
      raw: value,
      count: null
    });
  };

  const renderHeal = () => {
    const list = $("di-heal-results");
    const empty = $("di-heal-empty");
    const meta = $("di-heal-meta");
    if (!list) return;
    list.textContent = "";
    const rows = state.healRows;
    empty.hidden = rows.length > 0;
    meta.textContent = healSummary();
    const busy = state.healBusy;
    $("di-heal-check").disabled = busy;
    $("di-heal-fix").disabled = busy;
    for (const id of ["di-heal-copy", "di-heal-json", "di-heal-csv"]) {
      const button = $(id);
      if (button) button.disabled = busy || rows.length === 0;
    }
    const clear = $("di-heal-clear");
    if (clear) clear.disabled = !rows.length && !busy;

    for (const row of rows) {
      const node = el("div", "heal-row status-" + row.status);
      const head = el("div", "heal-head");
      head.appendChild(el("span", "heal-index", "#" + row.index));
      head.appendChild(el("span", "pill " + (HEAL_TONES[row.status] || ""), HEAL_LABELS[row.status] || row.status));
      if (typeof row.count === "number") {
        head.appendChild(el("span", "pill count " + countTone(row.count), countText(row.count)));
      }
      if (row.status === "fixed") {
        if (row.fixedType) head.appendChild(el("span", "pill accent", "fix · " + row.fixedType));
        if (row.score) head.appendChild(el("span", "pill", "score " + row.score));
      } else if (row.type) {
        head.appendChild(el("span", "pill", row.type));
      }
      const actions = el("div", "heal-actions");
      const source = row.fixed || row.original;
      const sourceType = row.fixed ? (row.fixedType || detectType(row.fixed)) : (row.type || detectType(row.original));
      actions.appendChild(iconButton("copy", row.fixed ? "Copy fixed locator" : "Copy locator", () =>
        copyText(source, row.fixed ? "Copied fixed locator" : "Copied locator")));
      actions.appendChild(iconButton("edit", "Use in tester", () => useHealValue(source, sourceType)));
      head.appendChild(actions);
      node.appendChild(head);
      node.appendChild(el("code", "heal-selector", row.original));
      if (row.error) node.appendChild(el("div", "heal-note bad", row.error));
      if (row.fixed) {
        const fix = el("div", "heal-fix");
        fix.appendChild(el("code", "heal-selector", row.fixed));
        const fixActions = el("div", "heal-fix-actions");
        fixActions.appendChild(iconButton("copy", "Copy fixed locator", () => copyText(row.fixed, "Copied fixed locator")));
        fixActions.appendChild(iconButton("edit", "Use fix in tester", () => useHealValue(row.fixed, row.fixedType || detectType(row.fixed))));
        fix.appendChild(fixActions);
        node.appendChild(fix);
      }
      if (row.element) {
        const info = [row.element.tag || "element"];
        if (row.element.id) info.push("#" + row.element.id);
        if (row.element.text) info.push("· " + row.element.text);
        node.appendChild(el("div", "heal-note", "matched " + info.join(" ")));
      }
      list.appendChild(node);
    }
  };

  const checkAllHeal = async () => {
    const lines = $("di-heal-input").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return toast("Paste at least one selector", "bad");
    const sequence = ++state.healSeq;
    state.healBusy = true;
    state.healRows = lines.map((line, index) => ({
      id: Date.now().toString(36) + "-" + index,
      index: index + 1,
      original: line,
      status: "pending",
      count: null,
      type: detectType(line),
      error: null,
      fixed: null,
      fixedType: null,
      score: null,
      element: null
    }));
    renderHeal();
    for (const row of state.healRows) {
      if (sequence !== state.healSeq) return;
      row.status = "checking";
      renderHeal();
      try {
        const response = await healVerify(row.original);
        row.type = response.type || detectType(row.original);
        row.count = typeof response.count === "number" ? response.count : 0;
        if (response.ok) {
          row.status = row.count === 1 ? "ok" : "many";
          row.error = row.count === 1 ? null : `Matches ${row.count} elements — not unique.`;
        } else {
          row.status = "broken";
          row.error = response.error || "No elements matched.";
        }
      } catch (error) {
        row.status = "broken";
        row.count = 0;
        row.error = friendlyError(error);
      }
      renderHeal();
    }
    if (sequence !== state.healSeq) return;
    state.healBusy = false;
    renderHeal();
    const broken = state.healRows.filter((row) => row.status === "broken").length;
    const many = state.healRows.filter((row) => row.status === "many").length;
    const notes = [];
    if (broken) notes.push(`${broken} broken`);
    if (many) notes.push(`${many} not unique`);
    setStatus(`Batch checked ${state.healRows.length} selector${state.healRows.length === 1 ? "" : "s"}${notes.length ? " · " + notes.join(" · ") : ""}.`, notes.length ? "warn" : "ok");
  };

  const fixBrokenHeal = async () => {
    const targets = state.healRows.filter((row) =>
      row.status === "broken" || row.status === "many" || row.status === "fix-failed"
    );
    if (!targets.length) return toast("No flagged selectors to fix", "bad");
    const sequence = state.healSeq;
    state.healBusy = true;
    renderHeal();
    for (const row of targets) {
      if (sequence !== state.healSeq) return;
      row.status = "checking";
      row.error = null;
      renderHeal();
      try {
        const repair = await repairSelector(row.original);
        if (!repair || !repair.ok) {
          row.status = "fix-failed";
          row.error = (repair && repair.error) || "No matching element found.";
          renderHeal();
          continue;
        }
        const candidates = [];
        const seen = new Set();
        const addCandidate = (value, type) => {
          if (!value || seen.has(value)) return;
          seen.add(value);
          candidates.push({ value, type: type || detectType(value) });
        };
        addCandidate(repair.fixed, repair.type);
        const locators = repair.locators || {};
        addCandidate(locators.css, "css");
        addCandidate(locators.xpath, "xpath");
        addCandidate(locators.playwright, "playwright");
        if (!candidates.length) {
          row.status = "fix-failed";
          row.error = "No candidate fix was produced.";
          renderHeal();
          continue;
        }
        row.score = repair.score || null;
        row.element = repair.element || null;
        let verified = null;
        let verifyError = "";
        for (const candidate of candidates) {
          const result = await healVerify(candidate.value);
          if (result && result.ok && result.count === 1) {
            verified = { value: candidate.value, type: result.type || candidate.type };
            break;
          }
          if (result && result.error && !verifyError) verifyError = result.error;
        }
        if (verified) {
          row.fixed = verified.value;
          row.fixedType = verified.type;
          row.type = verified.type;
          row.count = 1;
          row.status = "fixed";
          row.error = null;
        } else {
          row.fixed = candidates[0].value;
          row.fixedType = candidates[0].type;
          row.status = "fix-failed";
          row.error = verifyError
            ? "No unique fix verified: " + verifyError
            : "No candidate fix was unique.";
        }
      } catch (error) {
        row.status = "fix-failed";
        row.error = friendlyError(error);
      }
      renderHeal();
    }
    if (sequence !== state.healSeq) return;
    state.healBusy = false;
    renderHeal();
    const fixed = state.healRows.filter((row) => row.status === "fixed").length;
    setStatus(`Healed ${fixed} selector${fixed === 1 ? "" : "s"}.`, fixed ? "ok" : "warn");
  };

  const healReport = () => {
    const lines = ["DOM Inspector — batch selector report", "Page: " + ((state.payload && state.payload.url) || ""), ""];
    for (const row of state.healRows) {
      lines.push(`#${row.index} [${HEAL_LABELS[row.status] || row.status}] ${row.original}`);
      if (typeof row.count === "number") lines.push(`  matches: ${row.count}`);
      if (row.error) lines.push(`  note: ${row.error}`);
      if (row.fixed) lines.push(`  fix (${row.fixedType || detectType(row.fixed)}): ${row.fixed}`);
    }
    return lines.join("\n").trim();
  };

  const healExportRows = () => state.healRows.map((row) => ({
    index: row.index,
    original: row.original,
    status: row.status,
    count: typeof row.count === "number" ? row.count : null,
    type: row.type || null,
    error: row.error || null,
    fixed: row.fixed || null,
    fixedType: row.fixedType || null,
    score: row.score || null,
    element: row.element || null
  }));

  const exportHealJson = () => {
    if (!state.healRows.length) return toast("Check selectors first", "bad");
    const ok = download(`dom-inspector-healing-${stamp()}.json`, "application/json",
      JSON.stringify({ extension: "DOM Inspector", exportedAt: new Date().toISOString(), page: state.payload ? state.payload.url : null, results: healExportRows() }, null, 2));
    toast(ok ? "Healing report exported" : "Download failed", ok ? "ok" : "bad");
  };

  const exportHealCsv = () => {
    if (!state.healRows.length) return toast("Check selectors first", "bad");
    const header = ["index", "original", "status", "count", "type", "error", "fixed", "fixedType", "score", "elementTag", "elementId"];
    const lines = [header.join(",")];
    for (const row of healExportRows()) {
      lines.push([
        row.index, row.original, row.status, row.count, row.type,
        row.error, row.fixed, row.fixedType, row.score,
        row.element ? row.element.tag : "", row.element ? row.element.id : ""
      ].map(csvCell).join(","));
    }
    const ok = download(`dom-inspector-healing-${stamp()}.csv`, "text/csv", lines.join("\r\n"));
    toast(ok ? "Healing CSV exported" : "Download failed", ok ? "ok" : "bad");
  };

  const clearHeal = () => {
    state.healSeq += 1;
    state.healBusy = false;
    state.healRows = [];
    state.settings.healText = "";
    $("di-heal-input").value = "";
    persistSettings();
    renderHeal();
  };

  /* ---------------------------------------------------------------- */
  /* Render all                                                       */
  /* ---------------------------------------------------------------- */

  const renderAll = () => {
    state.countNodes = new Map();
    state.groups = buildGroups(state.payload);
    renderInfo();
    for (const group of GROUPS) renderGroup(group);
    renderDiff();
    renderDriver();
    renderHeal();
    renderReference();
    renderSaved();
    refreshSaveButtons();
    refreshStats();
    updatePickerUi();
    syncExpandLabel();
    queueAutoCounts();
  };

  const queueAutoCounts = () => {
    const sequence = state.payloadSeq;
    const pending = (state.groups.xpath || []).filter((row) =>
      row.autoCount && typeof row.count !== "number" && row.testType && row.testValue
    );
    for (const row of pending.slice(0, 3)) {
      if (state.autoCounted.has(row.key)) continue;
      state.autoCounted.add(row.key);
      sendToTab({ type: "DI_TEST", locatorType: row.testType, value: row.testValue, highlight: false })
        .then((response) => {
          if (sequence !== state.payloadSeq) return;
          if (response && typeof response.count === "number") {
            row.count = response.count;
            const node = state.countNodes.get(row.key);
            if (node) updateCountBadge(node.badge, response.count);
            refreshStats();
            renderDiff();
          }
        })
        .catch(() => { /* content script unavailable */ });
    }
  };

  const syncExpandLabel = () => {
    const anyCollapsed = GROUPS.some((group) => state.settings.collapsed[group.card]);
    const button = $("di-expand");
    if (button) button.textContent = anyCollapsed ? "Expand all" : "Collapse all";
  };

  const applySettings = () => {
    $("di-lang").value = state.settings.lang;
    $("di-await").checked = !!state.settings.await;
    $("di-await").disabled = state.settings.lang !== "js";
    $("di-unique").checked = !!state.settings.unique;
    $("di-continuous").checked = !!state.settings.continuous;
    $("di-strategy").value = state.settings.strategy;
    $("di-driver-base").value = state.settings.driverBase;
    $("di-driver-template").value = state.settings.driver;
    if ($("di-heal-input").value !== (state.settings.healText || "")) {
      $("di-heal-input").value = state.settings.healText || "";
    }
    syncExpandLabel();
  };

  const resetSettings = () => {
    if (state.savedBusy || state.healBusy) {
      return toast("Wait for the current check to finish", "bad");
    }
    state.settings = Object.assign({}, DEFAULT_SETTINGS, { collapsed: {} });
    state.filter = "";
    state.previousPayload = null;
    state.savedFilter = "";
    if ($("di-saved-filter")) $("di-saved-filter").value = "";
    state.healRows = [];
    state.healSeq += 1;
    $("di-filter").value = "";
    persistSettings();
    applySettings();
    renderAll();
    toast("Panel settings reset");
  };

  const handlePayload = (payload, restored) => {
    if (!payload) return;
    const previous = state.payload;
    state.payload = payload;
    state.payloadSeq += 1;
    state.previousPayload = !restored && previous && previous.url === payload.url ? previous : null;
    state.autoCounted = new Set();
    if (!state.settings.continuous) state.picking = false;
    if (!restored) recordHistory(payload);
    renderAll();
    const rows = allRows();
    const element = payload.element || {};
    const head = `${element.tag || "element"}${element.id ? "#" + element.id : ""}`;
    if (restored) {
      setStatus("Restored last picked element: " + head, "ok");
    } else if (state.settings.continuous) {
      setStatus(`${head} captured · ${rows.length} locator${rows.length === 1 ? "" : "s"} · keep picking…`, "ok");
    } else {
      setStatus(`${head} captured · ${rows.length} locator${rows.length === 1 ? "" : "s"}`, "ok");
    }
  };

  const restoreLast = async () => {
    const response = await runtimeSend({ type: "DI_GET_LAST" });
    if (response && response.payload) {
      handlePayload(response.payload, true);
      return true;
    }
    if (sessionStore) {
      try {
        const data = await sessionStore.get(LAST_PICK_KEY);
        if (data && data[LAST_PICK_KEY]) {
          handlePayload(data[LAST_PICK_KEY], true);
          return true;
        }
      } catch (_) { /* ignore */ }
    }
    return false;
  };

  const pingTab = async () => {
    try {
      const response = await sendToTab({ type: "DI_PING" });
      if (response && response.ok) {
        state.contentAvailable = true;
        state.picking = !!response.picking;
        setHint("");
        updatePickerUi();
        if (response.picking) setStatus("Picking is active — click an element.");
        return true;
      }
    } catch (_) { /* no content script */ }
    state.contentAvailable = false;
    if (!state.payload) {
      setHint("No content script responded. Open an http(s) page or reload after installing the extension.");
    }
    return false;
  };

  /* ---------------------------------------------------------------- */
  /* Events                                                           */
  /* ---------------------------------------------------------------- */

  const bindEvents = () => {
    $("di-pick").addEventListener("click", startPicker);
    $("di-stop").addEventListener("click", stopPicker);

    $("di-continuous").addEventListener("change", (event) => {
      state.settings.continuous = event.target.checked;
      persistSettings();
      if (state.picking) {
        sendToTab({ type: "DI_START", continuous: state.settings.continuous }).catch(() => {});
      }
      toast(state.settings.continuous ? "Continuous picking enabled" : "Single-pick mode");
    });

    $("di-filter").addEventListener("input", (event) => {
      state.filter = event.target.value.trim().toLowerCase();
      state.countNodes = new Map();
      for (const group of GROUPS) renderGroup(group);
      refreshSaveButtons();
    });
    $("di-filter").addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !event.target.value) return;
      event.preventDefault();
      event.target.value = "";
      state.filter = "";
      state.countNodes = new Map();
      for (const group of GROUPS) renderGroup(group);
      refreshSaveButtons();
    });

    $("di-unique").addEventListener("change", (event) => {
      state.settings.unique = event.target.checked;
      persistSettings();
      state.countNodes = new Map();
      for (const group of GROUPS) renderGroup(group);
      refreshSaveButtons();
    });

    $("di-strategy").addEventListener("change", (event) => {
      state.settings.strategy = event.target.value;
      persistSettings();
      state.countNodes = new Map();
      for (const group of GROUPS) renderGroup(group);
      refreshSaveButtons();
    });

    $("di-expand").addEventListener("click", () => {
      const anyCollapsed = GROUPS.some((group) => state.settings.collapsed[group.card]);
      const shouldCollapse = !anyCollapsed;
      for (const group of GROUPS) {
        state.settings.collapsed[group.card] = shouldCollapse;
        const card = $(group.card);
        if (card) card.classList.toggle("collapsed", shouldCollapse);
        const toggle = card ? card.querySelector(".section-toggle") : null;
        if (toggle) toggle.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
      }
      syncExpandLabel();
      persistSettings();
    });

    for (const group of GROUPS) {
      const card = $(group.card);
      const toggle = card ? card.querySelector(".section-toggle") : null;
      if (toggle) {
        toggle.addEventListener("click", () => {
          const next = !state.settings.collapsed[group.card];
          state.settings.collapsed[group.card] = next;
          card.classList.toggle("collapsed", next);
          toggle.setAttribute("aria-expanded", next ? "false" : "true");
          syncExpandLabel();
          persistSettings();
        });
      }
      const copy = $(group.copy);
      if (copy) {
        copy.addEventListener("click", () => {
          const text = groupText(group.key);
          if (!text) return toast("Nothing visible to copy", "bad");
          copyText(text, `Copied ${group.label} locators`);
        });
      }
    }

    $("di-ref-set").addEventListener("click", startReference);
    $("di-ref-clear").addEventListener("click", clearReference);

    $("di-copy-all").addEventListener("click", () => {
      const text = allLocatorText();
      if (!text) return toast(state.payload ? "Nothing visible to copy" : "Pick an element first", "bad");
      copyText(text, "Copied visible locators");
    });
    $("di-export").addEventListener("click", exportAll);
    $("di-reset").addEventListener("click", resetSettings);

    $("di-info-copy").addEventListener("click", () => {
      const text = summaryText();
      if (!text) return toast("Pick an element first", "bad");
      copyText(text, "Copied element summary");
    });

    $("di-lang").addEventListener("change", (event) => {
      state.settings.lang = event.target.value;
      $("di-await").disabled = state.settings.lang !== "js";
      persistSettings();
      renderGroup(GROUPS.find((group) => group.key === "pw"));
      refreshSaveButtons();
    });

    $("di-await").addEventListener("change", (event) => {
      state.settings.await = event.target.checked;
      persistSettings();
      renderGroup(GROUPS.find((group) => group.key === "pw"));
      refreshSaveButtons();
    });

    $("di-driver-base").addEventListener("change", (event) => {
      state.settings.driverBase = event.target.value;
      persistSettings();
      renderDriver();
    });
    $("di-driver-template").addEventListener("input", (event) => {
      state.settings.driver = event.target.value;
      persistSettings();
      renderDriver();
    });
    $("di-driver-preset").addEventListener("change", (event) => {
      const preset = DRIVER_PRESETS[event.target.value];
      if (!preset) return;
      state.settings.driverBase = preset.base;
      state.settings.driver = preset.template;
      event.target.value = "";
      persistSettings();
      renderDriver();
    });
    $("di-driver-copy").addEventListener("click", () => {
      const text = $("di-driver-output").textContent;
      if (!text || text === "Pick an element and enter a template.") return toast("No command to copy", "bad");
      copyText(text, "Copied driver command");
    });

    $("di-input").addEventListener("input", scheduleLiveTest);
    $("di-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        testInput();
      }
    });
    $("di-type").addEventListener("change", scheduleLiveTest);
    $("di-test").addEventListener("click", testInput);
    $("di-fix").addEventListener("click", fixInput);
    $("di-clear").addEventListener("click", () => {
      state.liveSeq += 1;
      $("di-input").value = "";
      $("di-live-badge").hidden = true;
      clearHighlights();
    });
    $("di-click").addEventListener("click", () => runAction("click"));
    $("di-hover").addEventListener("click", () => runAction("hover"));
    $("di-type-action").addEventListener("click", () => runAction("type"));
    $("di-type-text").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runAction("type");
      }
    });

    $("di-heal-input").addEventListener("input", (event) => {
      state.settings.healText = event.target.value;
      persistSettings();
    });
    $("di-heal-check").addEventListener("click", checkAllHeal);
    $("di-heal-fix").addEventListener("click", fixBrokenHeal);
    $("di-heal-copy").addEventListener("click", () => {
      const text = healReport();
      if (!state.healRows.length) return toast("Check selectors first", "bad");
      copyText(text, "Copied healing report");
    });
    $("di-heal-json").addEventListener("click", exportHealJson);
    $("di-heal-csv").addEventListener("click", exportHealCsv);
    $("di-heal-clear").addEventListener("click", clearHeal);

    if (api && api.storage && api.storage.onChanged) {
      api.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes[STORE_SAVED]) {
          const next = sanitizeSaved(changes[STORE_SAVED].newValue);
          if (JSON.stringify(next) !== JSON.stringify(state.saved)) {
            state.saved = next;
            renderSaved();
            refreshSaveButtons();
          }
        }
        if (changes[STORE_HISTORY]) {
          const next = changes[STORE_HISTORY].newValue;
          state.history = Array.isArray(next)
            ? next.filter((entry) => entry && entry.at && (entry.css || entry.xpath || entry.playwright))
            : [];
        }
        if (changes["di:panel:focus"]) {
          const target = applyFocusPayload(changes["di:panel:focus"].newValue, true);
          if (target) removeStore("di:panel:focus");
        }
      });
    }

    $("di-saved-check").addEventListener("click", checkSaved);
    $("di-saved-filter").addEventListener("input", (event) => {
      state.savedFilter = event.target.value;
      renderSaved();
    });
    $("di-saved-filter").addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !event.target.value) return;
      event.preventDefault();
      event.target.value = "";
      state.savedFilter = "";
      renderSaved();
    });
    $("di-saved-import").addEventListener("click", () => $("di-saved-import-file").click());
    $("di-saved-import-file").addEventListener("change", (event) => importSavedFile(event.target.files && event.target.files[0]));
    $("di-saved-pom").addEventListener("click", exportSavedPom);
    $("di-saved-json").addEventListener("click", exportSavedJson);
    $("di-saved-csv").addEventListener("click", exportSavedCsv);
    $("di-saved-clear").addEventListener("click", clearSaved);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (state.picking) {
        event.preventDefault();
        stopPicker();
      } else if (document.activeElement === $("di-input")) {
        clearHighlights();
      }
    });

    if (api && api.runtime && api.runtime.onMessage) {
      api.runtime.onMessage.addListener((message, sender) => {
        if (!message || !message.type) return undefined;
        const senderTab = sender && sender.tab && sender.tab.id;
        if (senderTab != null && state.tabId != null && senderTab !== state.tabId) return undefined;
        if (state.tabId == null && senderTab != null) state.tabId = senderTab;
        if (message.type === "DI_REFERENCE" && message.payload) {
          state.reference = message.payload;
          if (state.payload) {
            state.payload.reference = message.payload;
            state.payload.axes = [];
          }
          renderAll();
          const ref = message.payload;
          setStatus(`Reference: ${ref.tag || "element"}${ref.id ? "#" + ref.id : ""} — now pick the target element.`);
          sendToTab({ type: "DI_START", continuous: !!state.settings.continuous, mode: "element" })
            .then(() => { state.picking = true; updatePickerUi(); })
            .catch(() => { state.picking = false; updatePickerUi(); });
          return undefined;
        }
        if (message.type === "DI_ELEMENT" && message.payload) {
          handlePayload(message.payload, false);
        }
        return undefined;
      });
    }
  };

  /* ---------------------------------------------------------------- */
  /* Boot                                                             */
  /* ---------------------------------------------------------------- */

  const sanitizeSettings = (stored) => {
    const merged = Object.assign({}, DEFAULT_SETTINGS, stored && typeof stored === "object" ? stored : {});
    if (!["js", "python", "java", "csharp"].includes(merged.lang)) merged.lang = "js";
    merged.await = !!merged.await;
    merged.unique = !!merged.unique;
    merged.continuous = !!merged.continuous;
    merged.driverBase = merged.driverBase === "xpath" ? "xpath" : "css";
    merged.driver = typeof merged.driver === "string" ? merged.driver : "";
    merged.healText = typeof merged.healText === "string" ? merged.healText : "";
    merged.strategy = ["all", "id", "attr", "class", "text", "path", "semantic", "other"].includes(merged.strategy)
      ? merged.strategy : "all";
    merged.collapsed = merged.collapsed && typeof merged.collapsed === "object"
      ? Object.keys(merged.collapsed).reduce((out, key) => {
        out[key] = !!merged.collapsed[key];
        return out;
      }, {})
      : {};
    return merged;
  };

  const init = async () => {
    try {
      const storedSettings = await readStore(STORE_SETTINGS);
      if (storedSettings && typeof storedSettings === "object") {
        state.settings = sanitizeSettings(storedSettings);
      }
      const storedSaved = await readStore(STORE_SAVED);
      if (Array.isArray(storedSaved)) state.saved = sanitizeSaved(storedSaved);
    } catch (_) { /* defaults are fine */ }

    bindEvents();
    applySettings();
    renderAll();
    await resolveTabId(true);

    const storedHistory = await readStore(STORE_HISTORY);
    if (Array.isArray(storedHistory)) {
      state.history = storedHistory.filter((entry) => entry && entry.at && (entry.css || entry.xpath || entry.playwright));
    }
    const restored = await restoreLast();
    const alive = await pingTab();
    applyFocusRequest();
    if (!restored && !alive) {
      setStatus("Open an http(s) page, then pick an element.");
    } else if (!restored) {
      setStatus("Ready — pick an element.");
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
