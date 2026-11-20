/* DOM Inspector MCP — browser-side probe.
 *
 * Runs after the extension content modules are injected into a frame. It has
 * no Node dependencies and only reads the DOM; it never highlights or mutates
 * page state. Results are plain JSON so they can cross the Playwright bridge.
 */
(() => {
  const M = (globalThis.DIMCP = globalThis.DIMCP || {});
  const U = DI.util;

  const TEXT_LIMIT = 200;

  const jsQuote = (value) => "'" + String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n") + "'";

  const attrObject = (el) => {
    const out = {};
    const names = [];
    for (const attribute of Array.from(el.attributes || [])) {
      if (!/^(id|name|type|role|value|href|src|alt|title|placeholder|class|for|tabindex|disabled|checked|selected|contenteditable)$/.test(attribute.name) &&
          !/^(aria-|data-)/.test(attribute.name)) continue;
      names.push(attribute.name);
    }
    names.sort().slice(0, 20).forEach((name) => {
      out[name] = String(el.getAttribute(name)).slice(0, 300);
    });
    return out;
  };

  const describe = (el) => {
    let visible = false;
    try { visible = U.isVisible(el); } catch (_) { visible = false; }
    let role = null;
    try { role = DI.playwright.implicitRole(el); } catch (_) { role = null; }
    let accessibleName = "";
    try { accessibleName = U.normalizeText(DI.playwright.accessibleName(el)); } catch (_) { accessibleName = ""; }
    let rect = null;
    try {
      const box = el.getBoundingClientRect();
      rect = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    } catch (_) { rect = null; }
    return {
      tag: U.tagOf(el),
      id: U.attr(el, "id"),
      name: U.attr(el, "name"),
      classes: String(el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 20),
      role,
      accessibleName,
      text: U.normalizeText(el.textContent).slice(0, TEXT_LIMIT),
      visible,
      disabled: el.matches ? el.matches(":disabled") : false,
      rect,
      attributes: attrObject(el)
    };
  };

  const frameLocators = (el) => {
    try {
      const win = el && el.ownerDocument && el.ownerDocument.defaultView;
      return DI.playwright.framePrefix(win || window);
    } catch (_) {
      return [];
    }
  };

  const candidateRow = (item, valueKey) => ({
    value: item[valueKey],
    matchCount: item.count,
    unique: item.count === 1,
    selectsTarget: item.selectsTarget !== false,
    strategy: item.strategy || item.type || null,
    score: typeof item.score === "number" ? item.score : null,
    stability: typeof item.stability === "number" ? item.stability : null
  });

  const bestOf = (rows) => rows.find((row) => row.unique) || rows[0] || null;

  const seleniumRow = (rows, type) => {
    const row = rows.find((item) => item.type === type);
    if (!row) return null;
    return { value: row.value, matchCount: row.count, unique: row.count === 1 };
  };

  const seleniumSnippet = (by, value) => value == null ? null
    : `driver.findElement(By.${by}(${jsQuote(value)}))`;

  const selenium = (rows, formatRows) => {
    const strategies = {};
    for (const type of ["id", "name", "className", "tagName", "linkText", "partialLinkText", "cssSelector", "xpath"]) {
      strategies[type] = seleniumRow(rows, type);
    }
    const cssValue = strategies.cssSelector && strategies.cssSelector.value;
    const xpathValue = strategies.xpath && strategies.xpath.value;
    const snippets = {
      css: seleniumSnippet("cssSelector", cssValue),
      xpath: seleniumSnippet("xpath", xpathValue),
      id: seleniumSnippet("id", strategies.id && strategies.id.value),
      name: seleniumSnippet("name", strategies.name && strategies.name.value),
      className: seleniumSnippet("className", strategies.className && strategies.className.value),
      tagName: seleniumSnippet("tagName", strategies.tagName && strategies.tagName.value),
      linkText: seleniumSnippet("linkText", strategies.linkText && strategies.linkText.value),
      partialLinkText: seleniumSnippet("partialLinkText", strategies.partialLinkText && strategies.partialLinkText.value)
    };
    const frame = formatRows.find((row) => row.type === "selenium-frame");
    const shadow = formatRows.find((row) => row.type === "selenium-shadow");
    return {
      strategies,
      snippets,
      frame: frame ? frame.code : null,
      shadow: shadow ? shadow.code : null
    };
  };

  const cypress = (rows) => {
    const byType = Object.fromEntries(rows.map((row) => [row.type, row.code]));
    return {
      css: byType["cypress-css"] || null,
      xpath: byType["cypress-xpath"] || null,
      shadow: byType["cypress-shadow"] || null,
      jquery: byType.jquery || null,
      javascript: byType.js || null,
      xpathJavascript: byType["js-xpath"] || null,
      testRigor: byType.testRigor || null,
      snippets: rows
    };
  };

  const recommend = (analysis, prefer) => {
    const order = prefer === "css" ? ["css", "xpath", "playwright"]
      : prefer === "xpath" ? ["xpath", "css", "playwright"]
        : ["playwright", "css", "xpath"];
    for (const key of order) {
      const best = analysis[key] && analysis[key].best;
      if (best && best.unique) return { format: key, value: best.value };
    }
    for (const key of ["playwright", "css", "xpath"]) {
      const found = (analysis[key] && analysis[key].candidates || []).find((row) => row.unique);
      if (found) return { format: key, value: found.value };
    }
    return null;
  };

  M.analyze = (el, maxCandidates) => {
    const limit = Math.max(1, Math.min(Number(maxCandidates) || 12, 50));
    const cssCandidates = DI.css.candidates(el).slice(0, limit).map((item) => candidateRow(item, "selector"));
    const xpathCandidates = DI.xpath.candidates(el).slice(0, limit).map((item) => candidateRow(item, "xpath"));
    const playwrightCandidates = DI.playwright.generate(el).slice(0, limit).map((item) => candidateRow(item, "selector"));
    const seleniumRows = DI.formats.generate(el);
    const cypressRows = DI.formats.formats(el);

    const analysis = {
      element: describe(el),
      frameLocators: frameLocators(el),
      css: {
        best: bestOf(cssCandidates),
        candidates: cssCandidates
      },
      xpath: {
        best: bestOf(xpathCandidates),
        candidates: xpathCandidates
      },
      playwright: {
        best: bestOf(playwrightCandidates),
        candidates: playwrightCandidates
      },
      selenium: selenium(seleniumRows, cypressRows),
      cypress: cypress(cypressRows)
    };

    analysis.recommended = recommend(analysis, "playwright");
    return analysis;
  };

  M.summarize = (el) => {
    const css = DI.css.best(el);
    const xpath = DI.xpath.best(el);
    const playwright = DI.playwright.best(el);
    return {
      ...describe(el),
      locators: {
        css: css ? { value: css.selector, matchCount: css.count, unique: css.count === 1 } : null,
        xpath: xpath ? { value: xpath.xpath, matchCount: xpath.count, unique: xpath.count === 1 } : null,
        playwright: playwright
          ? { value: playwright.selector, matchCount: playwright.count, unique: playwright.count === 1 }
          : null
      },
      frameLocators: frameLocators(el)
    };
  };

  const pickIndex = (nodes, index) => {
    const at = Number.isInteger(index) && index >= 0 ? index : 0;
    return { nodes, at, element: nodes[at] || null };
  };

  M.resolveTarget = (target) => {
    const out = { elements: [], count: 0, type: null, error: null };
    if (!target || typeof target !== "object") {
      out.error = "Missing target";
      return out;
    }
    if (target.coordinates) {
      const x = Number(target.coordinates.x);
      const y = Number(target.coordinates.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        out.type = "coordinates";
        out.error = "Coordinates must be finite numbers";
        return out;
      }
      out.type = "coordinates";
      let el = document.elementFromPoint(x, y);
      while (el && el.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      if (el) out.elements = [el];
      out.count = el ? 1 : 0;
      return out;
    }
    if (target.css) {
      out.type = "css";
      try {
        document.querySelectorAll(target.css);
        out.elements = U.deepQueryAll(target.css, document).filter((node) => node && node.nodeType === 1);
        out.count = out.elements.length;
      } catch (error) {
        out.error = error.message;
      }
      return out;
    }
    if (target.xpath) {
      out.type = "xpath";
      try {
        out.elements = DI.xpath.snapshot(target.xpath, document).filter((node) => node && node.nodeType === 1);
        out.count = out.elements.length;
        document.evaluate(target.xpath, document, null, XPathResult.ANY_TYPE, null);
      } catch (error) {
        out.elements = [];
        out.count = 0;
        out.error = error.message;
      }
      return out;
    }
    if (target.playwright) {
      out.type = "playwright";
      try {
        const raw = String(target.playwright).trim().replace(/^await\s+/, "");
        const expression = /^page\./.test(raw) ? raw : `page.${raw}`;
        out.elements = DI.validate.resolve("playwright", expression).elements
          .filter((node) => node && node.nodeType === 1);
        out.count = out.elements.length;
      } catch (error) {
        out.error = error.message;
      }
      return out;
    }
    if (target.text != null && target.text !== "") {
      out.type = "text";
      try {
        const expression = `page.getByText(${JSON.stringify(String(target.text))}${target.exact ? ", { exact: true }" : ""})`;
        out.elements = DI.validate.resolve("playwright", expression).elements
          .filter((node) => node && node.nodeType === 1);
        out.count = out.elements.length;
      } catch (error) {
        out.error = error.message;
      }
      return out;
    }
    out.error = "Target must provide css, xpath, text, playwright, or coordinates";
    return out;
  };

  M.analyzeTarget = (target, maxCandidates) => {
    const resolved = M.resolveTarget(target);
    if (resolved.error) {
      return { found: false, error: resolved.error, type: resolved.type, matchCount: resolved.count };
    }
    const picked = pickIndex(resolved.elements, target.index);
    if (!picked.element) {
      return {
        found: false,
        type: resolved.type,
        matchCount: resolved.count,
        error: resolved.count
          ? `Target index ${picked.at} is out of range (${resolved.count} matches)`
          : "No element matched the target"
      };
    }
    return {
      found: true,
      type: resolved.type,
      matchCount: resolved.count,
      selectedIndex: picked.at,
      analysis: M.analyze(picked.element, maxCandidates)
    };
  };

  M.verify = (type, locator, maxMatches) => {
    const value = String(locator == null ? "" : locator).trim();
    if (!value) {
      return { ok: false, type: type || "auto", count: 0, unique: false, error: "Empty locator", matches: [] };
    }
    const actualType = !type || type === "auto" ? DI.validate.detectType(value) : type;
    let result;
    try {
      result = DI.validate.test(actualType, value);
    } catch (error) {
      return { ok: false, type: actualType, count: 0, unique: false, error: error.message, matches: [] };
    }
    const limit = Math.max(1, Math.min(Number(maxMatches) || 10, 50));
    return {
      ok: result.ok,
      type: result.type,
      count: result.count,
      unique: result.count === 1,
      error: result.error,
      matches: result.elements.slice(0, limit).map(describe)
    };
  };

  const statusFrom = (repair) => {
    if (!repair) return "not-found";
    if (repair.repaired) return "healed";
    return "valid";
  };

  M.heal = (locator, type, index, prefer) => {
    const value = String(locator == null ? "" : locator).trim();
    if (!value) {
      return { ok: false, status: "not-found", reason: "empty", error: "Empty locator", previous: null };
    }
    const actualType = !type || type === "auto" ? DI.validate.detectType(value) : type;
    let current;
    try {
      current = DI.validate.test(actualType, value);
    } catch (error) {
      current = { ok: false, type: actualType, count: 0, error: error.message, elements: [] };
    }

    if (current.elements.length === 1) {
      const analysis = M.analyze(current.elements[0]);
      return {
        ok: true,
        status: "valid",
        reason: "unique",
        fixed: value,
        type: current.type,
        previous: { locator: value, type: current.type, matchCount: 1, unique: true },
        choice: { format: current.type, value },
        analysis
      };
    }

    if (current.elements.length > 1) {
      const picked = pickIndex(current.elements, index);
      if (!picked.element) {
        return {
          ok: false,
          status: "not-found",
          reason: "index-out-of-range",
          error: `Index ${picked.at} is out of range (${current.elements.length} matches)`,
          previous: { locator: value, type: current.type, matchCount: current.elements.length, unique: false }
        };
      }
      const analysis = M.analyze(picked.element);
      const choice = recommend(analysis, prefer);
      return {
        ok: true,
        status: "healed",
        reason: "non-unique",
        fixed: choice ? choice.value : null,
        type: choice ? choice.format : null,
        selectedIndex: picked.at,
        previous: { locator: value, type: current.type, matchCount: current.elements.length, unique: false },
        choice,
        analysis
      };
    }

    const repair = DI.repair.fix(value);
    if (!repair.ok) {
      return {
        ok: false,
        status: "not-found",
        reason: "no-match",
        error: repair.error || "No matching element found",
        previous: { locator: value, type: current.type, matchCount: 0, unique: false },
        repair
      };
    }

    const repaired = String(repair.fixed || "").trim();
    let verified;
    try {
      verified = DI.validate.test("auto", repaired);
    } catch (error) {
      verified = { ok: false, type: "auto", count: 0, error: error.message, elements: [] };
    }

    if (verified.elements.length === 1) {
      const analysis = M.analyze(verified.elements[0]);
      const preferred = recommend(analysis, prefer);
      const choice = preferred || { format: verified.type, value: repaired };
      return {
        ok: true,
        status: statusFrom(repair),
        reason: repair.repaired ? "broken" : "valid",
        fixed: choice.value,
        type: choice.format,
        previous: { locator: value, type: current.type, matchCount: 0, unique: false },
        choice,
        analysis,
        repair
      };
    }

    if (verified.elements.length > 1) {
      const picked = pickIndex(verified.elements, index);
      const analysis = picked.element ? M.analyze(picked.element) : null;
      const choice = analysis ? recommend(analysis, prefer) : null;
      return {
        ok: Boolean(choice),
        status: choice ? "healed" : "not-unique",
        reason: "non-unique",
        fixed: choice ? choice.value : repaired,
        type: choice ? choice.format : verified.type,
        selectedIndex: picked.at,
        previous: { locator: value, type: current.type, matchCount: 0, unique: false },
        choice,
        analysis,
        repair
      };
    }

    return {
      ok: false,
      status: "not-found",
      reason: repair.repaired ? "repair-did-not-resolve" : "no-match",
      error: verified.error || "The repaired locator did not match an element",
      fixed: repaired || null,
      previous: { locator: value, type: current.type, matchCount: 0, unique: false },
      repair
    };
  };

  const DEFAULT_SELECTOR = [
    "a[href]",
    "area[href]",
    "button",
    "input:not([type=\"hidden\"])",
    "select",
    "textarea",
    "summary",
    "details",
    "[contenteditable=\"\"]",
    "[contenteditable=\"true\"]",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
    "[role=tab]",
    "[role=combobox]",
    "[role=menuitem]",
    "[role=option]"
  ].join(", ");

  M.list = (selector, limit, includeHidden) => {
    const wanted = selector && String(selector).trim() ? String(selector).trim() : DEFAULT_SELECTOR;
    const max = Math.max(1, Math.min(Number(limit) || 25, 200));
    let matches;
    try {
      document.querySelectorAll(wanted);
      matches = U.deepEveryElement(document).filter((el) => {
        try { return el.matches(wanted); } catch (_) { return false; }
      });
    } catch (error) {
      return { count: 0, returned: 0, error: error.message, elements: [] };
    }
    if (!includeHidden) {
      matches = matches.filter((el) => {
        try { return U.isVisible(el); } catch (_) { return false; }
      });
    }
    const total = matches.length;
    const elements = matches.slice(0, max).map((el) => M.summarize(el));
    return { count: total, returned: elements.length, selector: wanted, elements };
  };
})();
