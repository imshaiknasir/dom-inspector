/* DOM Inspector — toolbar popup: pick, open panel, recent locators, copy. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const api = typeof chrome !== "undefined" ? chrome : null;
  const LAST_KEY = "di:lastPick";
  const SAVED_KEY = "di:panel:saved";
  const HISTORY_KEY = "di:panel:history";
  const FOCUS_KEY = "di:panel:focus";

  const state = { payload: null, saved: [], history: [], historyExpanded: false, busy: false };

  const setStatus = (text, tone) => {
    const node = $("pop-status");
    if (!node) return;
    node.textContent = text;
    node.className = tone || "";
  };

  const friendly = (error) => {
    const text = error && error.message ? error.message : String(error);
    if (/receiving end|port closed|establish connection|could not establish/i.test(text)) {
      return "No content script here. Reload the page after installing the extension.";
    }
    return text;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const copyText = async (text) => {
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
    if (ok) setStatus("Copied to clipboard", "ok");
    else setStatus("Copy failed — select the text manually", "bad");
    return ok;
  };

  const copyButton = (label, value) => {
    const button = el("button", "btn small subtle", label);
    button.type = "button";
    button.title = "Copy locator";
    button.addEventListener("click", () => copyText(value));
    return button;
  };

  const locatorRow = (label, value, meta) => {
    if (!value) return null;
    const row = el("div", "loc-row");
    const main = el("div", "loc-main");
    main.appendChild(el("span", "loc-label", label));
    const code = el("code", "loc-value", value);
    code.title = value;
    main.appendChild(code);
    if (meta) main.appendChild(el("span", "loc-label", meta));
    row.appendChild(main);
    row.appendChild(copyButton("Copy", value));
    return row;
  };

  const activeTab = async () => {
    if (!api || !api.tabs || !api.tabs.query) throw new Error("Tabs API unavailable");
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0] || tabs[0].id == null) throw new Error("No active tab");
    return tabs[0];
  };

  const openPanel = async (tab) => {
    if (!api) throw new Error("Extension API unavailable");
    if (api.sidePanel && typeof api.sidePanel.open === "function" && tab.windowId != null) {
      try {
        await api.sidePanel.open({ windowId: tab.windowId });
        return;
      } catch (_) { /* fall back to a tab */ }
    }
    if (api.tabs && api.tabs.create && api.runtime && api.runtime.getURL) {
      await api.tabs.create({ url: api.runtime.getURL("src/panel/panel.html") });
      return;
    }
    throw new Error("Side panel is unavailable");
  };

  const setPanelFocus = async (target, extra) => {
    if (!api || !api.storage || !api.storage.local) return;
    try {
      await api.storage.local.set({ [FOCUS_KEY]: Object.assign({ target, at: Date.now() }, extra || {}) });
    } catch (_) { /* ignore */ }
  };

  const getLastPayload = async () => {
    if (api && api.storage && api.storage.session) {
      try {
        const data = await api.storage.session.get(LAST_KEY);
        if (data && data[LAST_KEY]) return data[LAST_KEY];
      } catch (_) { /* fall through */ }
    }
    if (api && api.runtime && api.runtime.sendMessage) {
      try {
        const response = await api.runtime.sendMessage({ type: "DI_GET_LAST" });
        if (response && response.payload) return response.payload;
      } catch (_) { /* ignore */ }
    }
    return null;
  };

  const getHistory = async () => {
    if (!api || !api.storage || !api.storage.local) return [];
    try {
      const data = await api.storage.local.get(HISTORY_KEY);
      const history = data && data[HISTORY_KEY];
      return Array.isArray(history)
        ? history.filter((entry) => entry && entry.at && (entry.css || entry.xpath || entry.playwright))
        : [];
    } catch (_) {
      return [];
    }
  };

  const getSaved = async () => {
    if (!api || !api.storage || !api.storage.local) return [];
    try {
      const data = await api.storage.local.get(SAVED_KEY);
      const saved = data && data[SAVED_KEY];
      return Array.isArray(saved) ? saved.filter((entry) => entry && entry.value) : [];
    } catch (_) {
      return [];
    }
  };

  const bestLocator = () => {
    const payload = state.payload;
    if (!payload) return null;
    const css = payload.css && payload.css.best;
    const xpath = payload.xpath && payload.xpath.best;
    const playwright = (payload.playwright || []).find((item) => item.count === 1) || (payload.playwright || [])[0];
    if (css && css.count === 1) return { value: css.selector, type: "css" };
    if (xpath && xpath.count === 1) return { value: xpath.xpath, type: "xpath" };
    if (playwright) return { value: playwright.selector, type: "playwright" };
    if (css) return { value: css.selector, type: "css" };
    if (xpath) return { value: xpath.xpath, type: "xpath" };
    return null;
  };

  const lastLocators = () => {
    const payload = state.payload;
    if (!payload) return [];
    const rows = [];
    const css = payload.css && payload.css.best;
    const xpath = payload.xpath && payload.xpath.best;
    if (css) rows.push({ label: "CSS", value: css.selector, meta: `${css.count} match${css.count === 1 ? "" : "es"} · ${css.strategy || "best"}` });
    if (xpath) rows.push({ label: "XPath", value: xpath.xpath, meta: `${xpath.count} match${xpath.count === 1 ? "" : "es"} · ${xpath.strategy || "best"}` });
    const playwright = (payload.playwright || []).find((item) => item.count === 1) || (payload.playwright || [])[0];
    if (playwright) rows.push({ label: "Playwright", value: playwright.selector, meta: `${playwright.count} match${playwright.count === 1 ? "" : "es"} · ${playwright.type || "locator"}` });
    if (payload.xpath && payload.xpath.absolute) rows.push({ label: "Absolute XPath", value: payload.xpath.absolute, meta: "absolute" });
    return rows;
  };

  const renderLast = () => {
    const card = $("pop-last-card");
    const rowsBox = $("pop-last-rows");
    const payload = state.payload;
    card.hidden = !payload;
    rowsBox.textContent = "";
    if (!payload) return;

    const element = payload.element || {};
    const bits = [element.tag || "element"];
    if (element.id) bits.push("#" + element.id);
    if (element.role) bits.push("· " + element.role);
    if (element.accessibleName) bits.push("· " + element.accessibleName);
    $("pop-last-element").textContent = bits.join(" ");
    $("pop-last-url").textContent = payload.url || "";

    const locators = lastLocators();
    if (!locators.length) {
      rowsBox.appendChild(el("p", "hint", "No locators in the last payload."));
      return;
    }
    for (const item of locators) {
      const row = locatorRow(item.label, item.value, item.meta);
      if (row) rowsBox.appendChild(row);
    }
  };

  const lastKey = () => {
    const payload = state.payload;
    if (!payload) return "";
    const css = payload.css && payload.css.best ? payload.css.best.selector : "";
    const xpath = payload.xpath && payload.xpath.best ? payload.xpath.best.xpath : "";
    return (payload.url || "") + "\n" + css + "\n" + xpath;
  };

  const renderHistory = () => {
    const card = $("pop-history-card");
    const rowsBox = $("pop-history-rows");
    const current = lastKey();
    const all = state.history
      .slice()
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .filter((entry) => {
        const key = (entry.url || "") + "\n" + (entry.css || "") + "\n" + (entry.xpath || "");
        return key !== current;
      });
    const entries = state.historyExpanded ? all : all.slice(0, 4);
    card.hidden = all.length === 0;
    rowsBox.textContent = "";
    $("pop-history-meta").textContent = String(state.history.length);
    const more = $("pop-history-more");
    more.hidden = all.length <= 4;
    more.textContent = state.historyExpanded ? "Show less" : `Show all (${all.length})`;
    more.setAttribute("aria-expanded", state.historyExpanded ? "true" : "false");
    for (const entry of entries) {
      const row = el("div", "loc-row");
      const main = el("div", "loc-main");
      const element = entry.element || {};
      const bits = [element.tag || "element"];
      if (element.id) bits.push("#" + element.id);
      if (element.accessibleName) bits.push("· " + element.accessibleName);
      main.appendChild(el("span", "loc-label", bits.join(" ")));
      const value = entry.css || entry.xpath || entry.playwright;
      const type = entry.css ? "CSS" : entry.xpath ? "XPath" : "Playwright";
      const code = el("code", "loc-value", value);
      code.title = value;
      main.appendChild(code);
      const count = entry.css ? entry.cssCount : entry.xpath ? entry.xpathCount : entry.playwrightCount;
      const meta = [type, typeof count === "number" ? `${count} match${count === 1 ? "" : "es"}` : "", entry.url || ""]
        .filter(Boolean).join(" · ");
      main.appendChild(el("span", "loc-label", meta));
      row.appendChild(main);
      row.appendChild(copyButton("Copy", value));
      rowsBox.appendChild(row);
    }
  };

  const renderSaved = () => {
    const card = $("pop-saved-card");
    const rowsBox = $("pop-saved-rows");
    const saved = state.saved.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    card.hidden = saved.length === 0;
    rowsBox.textContent = "";
    $("pop-saved-meta").textContent = String(saved.length);
    for (const entry of saved.slice(0, 4)) {
      const row = el("div", "loc-row");
      const main = el("div", "loc-main");
      main.appendChild(el("span", "loc-label", entry.name || entry.type || "saved"));
      const code = el("code", "loc-value", entry.value);
      code.title = entry.value;
      main.appendChild(code);
      const meta = [entry.label || entry.type, typeof entry.count === "number" ? `${entry.count} match${entry.count === 1 ? "" : "es"}` : ""]
        .filter(Boolean).join(" · ");
      if (meta) main.appendChild(el("span", "loc-label", meta));
      row.appendChild(main);
      row.appendChild(copyButton("Copy", entry.value));
      rowsBox.appendChild(row);
    }
  };

  const render = () => {
    renderLast();
    renderHistory();
    renderSaved();
    const empty = $("pop-empty");
    empty.hidden = Boolean(state.payload || state.saved.length || state.history.length);
  };

  const load = async () => {
    setStatus("Loading recent locators…");
    state.payload = await getLastPayload();
    state.saved = await getSaved();
    state.history = await getHistory();
    render();
    if (state.payload) {
      const element = state.payload.element || {};
      setStatus("Last pick: " + (element.tag || "element") + (element.id ? "#" + element.id : ""), "ok");
    } else if (state.saved.length) {
      setStatus(state.saved.length + " saved locator" + (state.saved.length === 1 ? "" : "s"));
    } else {
      setStatus("Pick an element to see its best locators.");
    }
  };

  const startPick = async () => {
    if (state.busy) return;
    state.busy = true;
    try {
      const tab = await activeTab();
      await openPanel(tab);
      if (api && api.tabs && api.tabs.sendMessage) {
        try {
          await api.tabs.sendMessage(tab.id, { type: "DI_START" });
        } catch (error) {
          setStatus(friendly(error), "bad");
          state.busy = false;
          return;
        }
      }
      setStatus("Picking — click an element on the page.", "ok");
      setTimeout(() => window.close(), 550);
    } catch (error) {
      setStatus(friendly(error), "bad");
      state.busy = false;
    }
  };

  const openOnly = async () => {
    try {
      const tab = await activeTab();
      await openPanel(tab);
      window.close();
    } catch (error) {
      setStatus(friendly(error), "bad");
    }
  };

  const openTester = async () => {
    const best = bestLocator();
    if (!best) return setStatus("Pick an element first", "bad");
    try {
      const tab = await activeTab();
      await setPanelFocus("tester", best);
      await openPanel(tab);
      window.close();
    } catch (error) {
      setStatus(friendly(error), "bad");
    }
  };

  const openHealing = async () => {
    try {
      const tab = await activeTab();
      await setPanelFocus("heal");
      await openPanel(tab);
      window.close();
    } catch (error) {
      setStatus(friendly(error), "bad");
    }
  };

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (event.target && event.target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (key === "p") {
      event.preventDefault();
      startPick();
    } else if (key === "o") {
      event.preventDefault();
      openOnly();
    } else if (key === "h") {
      event.preventDefault();
      openHealing();
    } else if (key === "r") {
      event.preventDefault();
      load();
    } else if (key === "t") {
      event.preventDefault();
      openTester();
    } else if (key === "c") {
      event.preventDefault();
      $("pop-last-copy").click();
    }
  });

  $("pop-pick").addEventListener("click", startPick);
  $("pop-open").addEventListener("click", openOnly);
  $("pop-last-test").addEventListener("click", openTester);
  $("pop-heal").addEventListener("click", openHealing);
  $("pop-refresh").addEventListener("click", load);
  $("pop-history-more").addEventListener("click", () => {
    state.historyExpanded = !state.historyExpanded;
    renderHistory();
  });

  $("pop-history-clear").addEventListener("click", async () => {
    try {
      if (api && api.storage && api.storage.local) await api.storage.local.remove(HISTORY_KEY);
      state.history = [];
      state.historyExpanded = false;
      render();
      setStatus("Pick history cleared");
    } catch (error) {
      setStatus(friendly(error), "bad");
    }
  });

  $("pop-last-copy").addEventListener("click", () => {
    const rows = lastLocators();
    if (!rows.length) return setStatus("No locators to copy", "bad");
    copyText(rows.map((item) => item.value).join("\n"));
  });

  load().catch((error) => setStatus(friendly(error), "bad"));
})();
