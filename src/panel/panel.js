/* DOM Inspector — panel controller (DevTools sidebar and side panel). */
(() => {
  const $ = (id) => document.getElementById(id);
  let payload = null;
  let lang = "js";

  const setStatus = (text, tone) => {
    const el = $("di-status");
    el.textContent = text;
    el.style.color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "";
  };

  const getTabId = async () => {
    try {
      if (chrome.devtools && chrome.devtools.inspectedWindow) return chrome.devtools.inspectedWindow.tabId;
    } catch (_) {}
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  };

  const sendToTab = async (message) => {
    const tabId = await getTabId();
    if (tabId == null) throw new Error("No active tab");
    return chrome.tabs.sendMessage(tabId, message);
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setStatus("Copied: " + text.slice(0, 60), "ok");
  };

  const countClass = (count) => (count === 1 ? "ok" : count === 0 ? "zero" : "many");

  const makeRow = ({ code, count, type, label }) => {
    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    const codeEl = document.createElement("code");
    codeEl.textContent = code;
    left.appendChild(codeEl);
    if (label) {
      const hint = document.createElement("div");
      hint.className = "badge";
      hint.textContent = label;
      left.appendChild(hint);
    }
    row.appendChild(left);

    if (typeof count === "number") {
      const badge = document.createElement("span");
      badge.className = "count " + countClass(count);
      badge.textContent = String(count);
      badge.title = count === 1 ? "unique" : count === 0 ? "no match" : "not unique";
      row.appendChild(badge);
    } else {
      row.appendChild(document.createElement("span"));
    }

    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (type) {
      const test = document.createElement("button");
      test.type = "button";
      test.textContent = "Test";
      test.addEventListener("click", async () => {
        try {
          const res = await sendToTab({ type: "DI_TEST", locatorType: type, value: code, highlight: true });
          if (!res) return setStatus("No content script in the active tab.", "bad");
          setStatus(res.ok ? `${res.count} match${res.count === 1 ? "" : "es"} (${res.type})` : `Invalid: ${res.error}`, res.ok ? "ok" : "bad");
          if (typeof res.count === "number" && code === row.querySelector("code").textContent) {
            badge.className = "count " + countClass(res.count);
            badge.textContent = String(res.count);
          }
        } catch (error) {
          setStatus("Test failed: " + error.message, "bad");
        }
      });
      actions.appendChild(test);
    }
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => copy(code));
    actions.appendChild(copyBtn);
    row.appendChild(actions);

    return row;
  };

  const clear = (id) => { $(id).textContent = ""; };

  const stabilityLabel = (item) => {
    const parts = [];
    if (item.strategy) parts.push(item.strategy);
    if (item.type && !parts.length) parts.push(item.type);
    if (typeof item.stability === "number") parts.push(item.stability >= 85 ? "stable" : item.stability >= 55 ? "medium" : "fragile");
    return parts.join(" · ");
  };

  let batch = [];
  let saved = [];

  const store = (key, value) => chrome.storage.local.set({ [key]: value }).catch(() => {});
  const load = async (key) => {
    try { return (await chrome.storage.local.get(key))[key] || []; } catch (_) { return []; }
  };

  const batchRow = (item, index) => {
    const row = document.createElement("div");
    row.className = "row";
    const left = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = item.label + "  →  " + (item.css || item.xpath || item.playwright || "");
    left.appendChild(code);
    const hint = document.createElement("div");
    hint.className = "badge";
    hint.textContent = [item.css && "CSS", item.xpath && "XPath", item.playwright && "Playwright", item.selenium && "Selenium"].filter(Boolean).join(" · ");
    left.appendChild(hint);
    row.appendChild(left);
    row.appendChild(document.createElement("span"));
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => copy([item.label, item.css, item.xpath, item.playwright, item.selenium].filter(Boolean).join("\t")));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      batch.splice(index, 1);
      store("di:batch", batch);
      renderBatch();
    });
    actions.append(copy, remove);
    row.appendChild(actions);
    return row;
  };

  const renderBatch = () => {
    const box = $("di-batch");
    box.textContent = "";
    $("di-batch-card").hidden = batch.length === 0;
    batch.forEach((item, index) => box.appendChild(batchRow(item, index)));
  };

  const renderSaved = () => {
    const box = $("di-saved");
    box.textContent = "";
    $("di-saved-card").hidden = saved.length === 0;
    saved.forEach((value, index) => {
      const row = document.createElement("div");
      row.className = "row";
      const code = document.createElement("code");
      code.textContent = value;
      row.appendChild(code);
      row.appendChild(document.createElement("span"));
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.textContent = "Use";
      loadBtn.addEventListener("click", () => { $("di-input").value = value; $("di-type").value = value.startsWith("page.") ? "playwright" : value.startsWith("//") || value.startsWith("(/") ? "xpath" : "css"; });
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => copy(value));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => { saved.splice(index, 1); store("di:saved", saved); renderSaved(); });
      actions.append(loadBtn, copy, remove);
      row.appendChild(actions);
      box.appendChild(row);
    });
  };

  const renderCss = () => {
    const box = $("di-css");
    clear("di-css");
    $("di-css-card").hidden = !payload;
    if (!payload) return;
    const list = [payload.css.best, ...(payload.css.candidates || [])].filter(Boolean);
    const seen = new Set();
    for (const item of list) {
      if (seen.has(item.selector)) continue;
      seen.add(item.selector);
      box.appendChild(makeRow({ code: item.selector, count: item.count, type: "css", label: stabilityLabel(item) }));
    }
  };

  const renderXpath = () => {
    const box = $("di-xpath");
    clear("di-xpath");
    $("di-xpath-card").hidden = !payload;
    if (!payload) return;
    const rows = [];
    if (payload.xpath.best) rows.push({ code: payload.xpath.best.xpath, count: payload.xpath.best.count, type: "xpath", label: stabilityLabel(payload.xpath.best) });
    for (const item of payload.xpath.candidates || []) rows.push({ code: item.xpath, count: item.count, type: "xpath", label: stabilityLabel(item) });
    if (payload.xpath.indexed) rows.push({ code: payload.xpath.indexed.xpath, count: payload.xpath.indexed.count, type: "xpath", label: "indexed" });
    if (payload.xpath.absolute) rows.push({ code: payload.xpath.absolute, count: null, type: "xpath", label: "absolute" });
    const seen = new Set();
    for (const row of rows) {
      if (!row.code || seen.has(row.code)) continue;
      seen.add(row.code);
      box.appendChild(makeRow(row));
    }
  };

  const pwCode = (selector) => {
    if (lang === "python") return selector; // selector strings are language-neutral here
    return selector;
  };

  const renderPlaywright = () => {
    const box = $("di-pw");
    clear("di-pw");
    $("di-pw-card").hidden = !payload;
    if (!payload) return;
    for (const item of payload.playwright || []) {
      let code = pwCode(item.selector);
      if (lang === "python") code = code.replace(/page\./g, "page.").replace(/getBy([A-Z])/g, (_, c) => "get_by_" + c.toLowerCase());
      if (lang === "java") code = code.replace(/getByRole\('([^']+)', \{ name: '([^']+)' \}\)/g, "getByRole(AriaRole.$1, new Page.GetByRoleOptions().setName(\"$2\"))");
      if (lang === "csharp") code = code.replace(/getByRole\('([^']+)', \{ name: '([^']+)' \}\)/g, "GetByRole(AriaRole.$1, new Page.GetByRoleOptions { Name = \"$2\" })").replace(/^page/, "Page");
      box.appendChild(makeRow({ code, count: item.count, type: "playwright", label: stabilityLabel(item) }));
    }
  };

  const renderSelenium = () => {
    const box = $("di-selenium");
    const fmt = $("di-formats");
    clear("di-selenium");
    clear("di-formats");
    $("di-selenium-card").hidden = !payload;
    if (!payload) return;
    for (const item of payload.selenium || []) {
      if (!item.value) continue;
      box.appendChild(makeRow({ code: item.value, count: item.count, type: "css", label: "By." + item.type }));
    }
    for (const item of payload.formats || []) {
      fmt.appendChild(makeRow({ code: item.code, count: null, label: item.type }));
    }
  };

  const renderInfo = () => {
    const box = $("di-info");
    const ctx = $("di-context");
    box.textContent = "";
    ctx.textContent = "";
    $("di-info-card").hidden = !payload;
    if (!payload) return;
    const pairs = [
      ["Tag", payload.element.tag],
      ["ID", payload.element.id],
      ["Classes", payload.element.classes],
      ["Role", payload.element.role],
      ["Name", payload.element.accessibleName],
      ["Text", payload.element.text],
      ["Visible", payload.element.visible ? "yes" : "no"],
      ["URL", payload.url]
    ];
    for (const [key, value] of pairs) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value || "—";
      box.append(dt, dd);
    }
    const badges = [];
    if (payload.shadow && payload.shadow.inShadow) badges.push("shadow DOM (" + payload.shadow.hosts.length + " host(s))");
    if (payload.frame && payload.frame.depth) badges.push("iframe depth " + payload.frame.depth);
    if (payload.xpath && payload.xpath.absolute == null) badges.push("XPath unavailable");
    if (payload.css && payload.css.best && payload.css.best.count !== 1) badges.push("CSS not unique");
    for (const text of badges) {
      const badge = document.createElement("span");
      badge.className = "badge warn";
      badge.textContent = text;
      ctx.appendChild(badge);
    }
  };

  const renderAll = () => {
    renderInfo();
    renderCss();
    renderXpath();
    renderPlaywright();
    renderSelenium();
  };

  $("di-pick").addEventListener("click", async () => {
    try {
      await sendToTab({ type: "DI_START" });
      setStatus("Picking… click an element. Esc or Stop to cancel.");
    } catch (error) {
      setStatus("Cannot start picker: " + error.message, "bad");
    }
  });

  $("di-stop").addEventListener("click", async () => {
    try {
      await sendToTab({ type: "DI_STOP" });
      setStatus("Picker stopped.");
    } catch (_) {}
  });

  $("di-lang").addEventListener("change", (event) => {
    lang = event.target.value;
    renderPlaywright();
  });

  $("di-test").addEventListener("click", async () => {
    const value = $("di-input").value.trim();
    const type = $("di-type").value;
    const result = $("di-result");
    if (!value) {
      result.textContent = "Enter a locator first.";
      result.className = "result bad";
      return;
    }
    try {
      const res = await sendToTab({ type: "DI_TEST", locatorType: type, value, highlight: true });
      if (!res) throw new Error("no content script");
      result.textContent = res.ok
        ? `Valid ${res.type}: ${res.count} match${res.count === 1 ? "" : "es"} (highlighted).`
        : `Invalid: ${res.error}`;
      result.className = "result " + (res.ok ? "ok" : "bad");
    } catch (error) {
      result.textContent = "Test failed: " + error.message;
      result.className = "result bad";
    }
  });

  $("di-clear").addEventListener("click", async () => {
    try { await sendToTab({ type: "DI_CLEAR" }); } catch (_) {}
    $("di-result").textContent = "Highlights cleared.";
    $("di-result").className = "result";
  });

  const bestOf = (type) => {
    if (!payload) return "";
    if (type === "css") return payload.css.best ? payload.css.best.selector : "";
    if (type === "xpath") return payload.xpath.best ? payload.xpath.best.xpath : "";
    if (type === "playwright") {
      const item = (payload.playwright || []).find((p) => p.count === 1) || (payload.playwright || [])[0];
      return item ? item.selector : "";
    }
    if (type === "selenium") {
      const item = (payload.selenium || []).find((p) => p.count === 1) || (payload.selenium || [])[0];
      return item ? item.value : "";
    }
    return "";
  };

  $("di-add-batch").addEventListener("click", () => {
    if (!payload) return;
    batch.push({
      label: (payload.element.text || payload.element.tag || "element").slice(0, 40),
      css: bestOf("css"),
      xpath: bestOf("xpath"),
      playwright: bestOf("playwright"),
      selenium: bestOf("selenium")
    });
    store("di:batch", batch);
    renderBatch();
    setStatus("Added to batch (" + batch.length + ").", "ok");
  });

  $("di-save").addEventListener("click", () => {
    const value = (payload && (bestOf("css") || bestOf("xpath") || bestOf("playwright"))) || $("di-input").value.trim();
    if (!value) return;
    saved = [value, ...saved.filter((s) => s !== value)].slice(0, 10);
    store("di:saved", saved);
    renderSaved();
    setStatus("Saved (" + saved.length + "/10).", "ok");
  });

  $("di-batch-clear").addEventListener("click", () => { batch = []; store("di:batch", batch); renderBatch(); });
  $("di-saved-clear").addEventListener("click", () => { saved = []; store("di:saved", saved); renderSaved(); });

  $("di-batch-copy").addEventListener("click", () => {
    const text = ["label\tcss\txpath\tplaywright\tselenium", ...batch.map((b) => [b.label, b.css, b.xpath, b.playwright, b.selenium].join("\t"))].join("\n");
    if (text.trim()) copy(text);
  });
  $("di-batch-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ createdAt: new Date().toISOString(), items: batch }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "locators.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("di-batch-csv").addEventListener("click", () => {
    const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const rows = [["label", "css", "xpath", "playwright", "selenium"], ...batch.map((b) => [b.label, b.css, b.xpath, b.playwright, b.selenium])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "locators.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const extractLocators = (text) => {
    const out = [];
    const add = (v) => { v = v.trim(); if (v && !out.includes(v)) out.push(v); };
    for (const m of text.matchAll(/(['"`])((?:\/{1,2}|\(\s*\/{1,2}|page\.|#|\.|\[)[^'"`]{1,300})\1/g)) add(m[2]);
    return out.slice(0, 100);
  };

  $("di-heal").addEventListener("click", async () => {
    const box = $("di-heal-rows");
    box.textContent = "";
    const list = extractLocators($("di-script").value || "");
    if (!list.length) {
      box.textContent = "No quoted locators found.";
      return;
    }
    let ok = 0;
    for (const value of list) {
      let result = null;
      try { result = await sendToTab({ type: "DI_TEST", locatorType: "auto", value, highlight: false }); } catch (_) {}
      const row = document.createElement("div");
      row.className = "row";
      const code = document.createElement("code");
      code.textContent = value;
      row.appendChild(code);
      const badge = document.createElement("span");
      badge.className = "count " + (result && result.ok ? "ok" : "zero");
      badge.textContent = result ? String(result.count) : "?";
      row.appendChild(badge);
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = "Use";
      use.addEventListener("click", () => { $("di-input").value = value; });
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", () => copy(value));
      actions.append(use, copyBtn);
      row.appendChild(actions);
      if (result && result.ok) ok += 1;
      box.appendChild(row);
    }
    setStatus(`Healed: ${ok}/${list.length} locators resolved.`, ok === list.length ? "ok" : "bad");
  });
  $("di-heal-clear").addEventListener("click", () => { $("di-heal-rows").textContent = ""; });

  load("di:batch").then((value) => { batch = Array.isArray(value) ? value : []; renderBatch(); });
  load("di:saved").then((value) => { saved = Array.isArray(value) ? value : []; renderSaved(); });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "DI_ELEMENT" && message.payload) {
      payload = message.payload;
      renderAll();
      $("di-add-batch").disabled = false;
      $("di-save").disabled = false;
      setStatus("Element captured. " + (payload.css.best ? "Best CSS matches " + payload.css.best.count + "." : ""), "ok");
    }
  });

  chrome.runtime.sendMessage({ type: "DI_GET_LAST" }).then((res) => {
    if (res && res.payload && !payload) {
      payload = res.payload;
      renderAll();
      $("di-add-batch").disabled = false;
      $("di-save").disabled = false;
      setStatus("Restored last picked element.");
    }
  }).catch(() => {});
})();
