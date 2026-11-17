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
      box.appendChild(makeRow({ code: item.selector, count: item.count, type: "css", label: item.strategy }));
    }
  };

  const renderXpath = () => {
    const box = $("di-xpath");
    clear("di-xpath");
    $("di-xpath-card").hidden = !payload;
    if (!payload) return;
    const rows = [];
    if (payload.xpath.best) rows.push({ code: payload.xpath.best.xpath, count: payload.xpath.best.count, type: "xpath", label: payload.xpath.best.strategy });
    for (const item of payload.xpath.candidates || []) rows.push({ code: item.xpath, count: item.count, type: "xpath", label: item.strategy });
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
      box.appendChild(makeRow({ code, count: item.count, type: "playwright", label: item.type }));
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "DI_ELEMENT" && message.payload) {
      payload = message.payload;
      renderAll();
      setStatus("Element captured. " + (payload.css.best ? "Best CSS matches " + payload.css.best.count + "." : ""), "ok");
    }
  });

  chrome.runtime.sendMessage({ type: "DI_GET_LAST" }).then((res) => {
    if (res && res.payload && !payload) {
      payload = res.payload;
      renderAll();
      setStatus("Restored last picked element.");
    }
  }).catch(() => {});
})();
