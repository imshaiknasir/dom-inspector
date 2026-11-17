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
  const LAST_PICK_KEY = "di:lastPick";

  const DEFAULT_SETTINGS = {
    lang: "js",
    await: false,
    unique: false,
    continuous: false,
    collapsed: {},
    driver: "",
    driverBase: "css",
    healText: ""
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
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>'
  };

  const state = {
    payload: null,
    tabId: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    saved: [],
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

  const applyFocusRequest = async () => {
    const focus = await readStore("di:panel:focus");
    if (!focus || typeof focus !== "object") return;
    if (Date.now() - (focus.at || 0) > 60000) {
      removeStore("di:panel:focus");
      return;
    }
    if (focus.target === "heal") {
      $("di-heal-card").scrollIntoView({ block: "start" });
      $("di-heal-input").focus();
    } else if (focus.target === "tester") {
      $("di-tester-card").scrollIntoView({ block: "start" });
      $("di-input").focus();
    }
    removeStore("di:panel:focus");
  };

  const persistSaved = () => writeStore(STORE_SAVED, state.saved);

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
    if (v.startsWith("page.") || v.startsWith("getBy")) return "playwright";
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

  const matchesFilter = (row) => {
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
      const tone = response.ok ? "ok" : "bad";
      const message = response.ok
        ? `${response.type.toUpperCase()} · ${response.count} match${response.count === 1 ? "" : "es"} · highlighted`
        : `Invalid: ${response.error || "no match"}`;
      showResult(message, tone);
      setStatus(message, tone);
      const live = $("di-live-badge");
      if (live) {
        live.hidden = false;
        live.className = "pill live " + tone;
        live.textContent = response.ok ? `${response.type} · ${response.count}` : "no match";
      }
    } catch (error) {
      const message = friendlyError(error);
      showResult(message, "bad");
      setStatus(message, "bad");
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
      state.saved.push({
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
      "Text: " + (element.text || "—"),
      "Visible: " + (element.visible ? "yes" : "no")
    ];
    const css = payload.css || {};
    const xpath = payload.xpath || {};
    if (css.best) lines.push(`CSS: ${css.best.selector} (${css.best.count})`);
    if (xpath.best) lines.push(`XPath: ${xpath.best.xpath} (${xpath.best.count})`);
    if (xpath.absolute) lines.push(`Absolute XPath: ${xpath.absolute}`);
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
    for (const group of GROUPS) {
      const rows = visibleRows(state.groups[group.key] || []);
      if (!rows.length) continue;
      lines.push("", group.label);
      for (const row of rows) lines.push(displayValue(row));
    }
    return lines.join("\n").trim();
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

  const renderSaved = () => {
    const list = $("di-saved");
    const meta = $("di-saved-meta");
    const empty = $("di-saved-empty");
    list.textContent = "";
    meta.textContent = String(state.saved.length);
    empty.hidden = state.saved.length > 0;

    const entries = state.saved.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    for (const entry of entries) {
      const row = el("div", "loc-row saved-row");
      const main = el("div", "loc-main");

      const name = document.createElement("input");
      name.type = "text";
      name.className = "saved-name";
      name.value = entry.name || "";
      name.title = "Saved locator name";
      name.setAttribute("aria-label", "Saved locator name");
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

      const rowMeta = el("div", "loc-meta");
      rowMeta.appendChild(el("span", "pill", entry.label || entry.type));
      if (typeof entry.count === "number") {
        rowMeta.appendChild(el("span", "pill count " + countTone(entry.count), countText(entry.count)));
      }
      if (entry.scope) rowMeta.appendChild(el("span", "pill", entry.scope));
      main.appendChild(rowMeta);
      row.appendChild(main);

      const actions = el("div", "loc-actions");
      if (entry.testType) {
        actions.appendChild(iconButton("test", "Test & highlight", () => testRow({
          key: entry.key, scope: entry.scope, type: entry.type,
          testType: entry.testType, testValue: entry.testValue,
          value: entry.value, count: entry.count
        }, null)));
        actions.appendChild(iconButton("edit", "Edit in tester", () => fillTester({
          key: entry.key, scope: entry.scope, type: entry.type,
          testType: entry.testType, testValue: entry.testValue,
          value: entry.value, raw: entry.testValue, count: entry.count
        })));
      }
      actions.appendChild(iconButton("copy", "Copy locator", () => copyText(entry.value, "Copied saved locator")));
      actions.appendChild(iconButton("trash", "Delete saved locator", () => {
        state.saved = state.saved.filter((item) => item.id !== entry.id);
        persistSaved();
        renderSaved();
        refreshSaveButtons();
        toast("Deleted saved locator");
      }));
      row.appendChild(actions);
      list.appendChild(row);
    }
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
        ? `Valid ${response.type.toUpperCase()} · ${response.count} match${response.count === 1 ? "" : "es"} · highlighted`
        : `Invalid ${response.type || ""} locator: ${response.error || "no match"}`, tone);
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
    const fixed = rows.filter((row) => row.status === "fixed").length;
    const broken = rows.filter((row) => row.status === "broken" || row.status === "fix-failed").length;
    if (unique) parts.push(`${unique} unique`);
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
    $("di-heal-check").disabled = state.healBusy;
    $("di-heal-fix").disabled = state.healBusy;

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
    setStatus(`Batch checked ${state.healRows.length} selector${state.healRows.length === 1 ? "" : "s"}${broken ? ` · ${broken} broken` : ""}.`, broken ? "warn" : "ok");
  };

  const fixBrokenHeal = async () => {
    const targets = state.healRows.filter((row) => row.status === "broken" || row.status === "fix-failed");
    if (!targets.length) return toast("No broken selectors to fix", "bad");
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
        if (!repair || !repair.ok || !repair.fixed) {
          row.status = "fix-failed";
          row.error = (repair && repair.error) || "No matching element found.";
          renderHeal();
          continue;
        }
        row.fixed = repair.fixed;
        row.fixedType = repair.type || detectType(repair.fixed);
        row.score = repair.score || null;
        row.element = repair.element || null;
        const verify = await healVerify(repair.fixed);
        if (verify && verify.ok) {
          row.status = "fixed";
          row.count = verify.count;
          row.type = verify.type || row.fixedType;
          row.fixedType = verify.type || row.fixedType;
          row.error = null;
        } else {
          row.status = "fix-failed";
          row.error = "Suggested fix did not verify" + (verify && verify.error ? ": " + verify.error : ".");
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
    const pending = (state.groups.xpath || []).filter((row) =>
      row.autoCount && typeof row.count !== "number" && row.testType && row.testValue
    );
    for (const row of pending.slice(0, 3)) {
      if (state.autoCounted.has(row.key)) continue;
      state.autoCounted.add(row.key);
      sendToTab({ type: "DI_TEST", locatorType: row.testType, value: row.testValue, highlight: false })
        .then((response) => {
          if (response && typeof response.count === "number") {
            row.count = response.count;
            const node = state.countNodes.get(row.key);
            if (node) updateCountBadge(node.badge, response.count);
            refreshStats();
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
    $("di-driver-base").value = state.settings.driverBase;
    $("di-driver-template").value = state.settings.driver;
    if ($("di-heal-input").value !== (state.settings.healText || "")) {
      $("di-heal-input").value = state.settings.healText || "";
    }
    syncExpandLabel();
  };

  const resetSettings = () => {
    state.settings = Object.assign({}, DEFAULT_SETTINGS, { collapsed: {} });
    state.filter = "";
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
    state.payload = payload;
    state.autoCounted = new Set();
    if (!state.settings.continuous) state.picking = false;
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

    $("di-unique").addEventListener("change", (event) => {
      state.settings.unique = event.target.checked;
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
      if (!text) return toast("Pick an element first", "bad");
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
        if (area !== "local" || !changes["di:panel:focus"]) return;
        const next = changes["di:panel:focus"].newValue;
        const target = next && typeof next === "object" ? next.target : next;
        if (target === "heal") {
          $("di-heal-card").scrollIntoView({ block: "start", behavior: "smooth" });
          $("di-heal-input").focus();
        } else if (target === "tester") {
          $("di-tester-card").scrollIntoView({ block: "start", behavior: "smooth" });
          $("di-input").focus();
        }
        if (target) removeStore("di:panel:focus");
      });
    }

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

  const init = async () => {
    try {
      const storedSettings = await readStore(STORE_SETTINGS);
      if (storedSettings && typeof storedSettings === "object") {
        state.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);
        state.settings.collapsed = storedSettings.collapsed && typeof storedSettings.collapsed === "object"
          ? storedSettings.collapsed : {};
      }
      const storedSaved = await readStore(STORE_SAVED);
      if (Array.isArray(storedSaved)) {
        state.saved = storedSaved.filter((entry) => entry && entry.id && entry.value);
      }
    } catch (_) { /* defaults are fine */ }

    bindEvents();
    applySettings();
    renderAll();
    await resolveTabId(true);

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
