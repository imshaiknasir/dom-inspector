/* DOM Inspector — locator detection, validation, match resolution and highlighting. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;


  /* Strip quoted text so path/axis characters inside values stay CSS. */
  const unquoted = (value) => {
    let out = "";
    let quote = null;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "\\") { out += ch; i += 1; continue; }
      out += ch;
    }
    return out;
  };

  const AXIS = /(?:^|[/(|\s])(ancestor|ancestor-or-self|attribute|child|descendant|descendant-or-self|following|following-sibling|namespace|parent|preceding|preceding-sibling|self)::/;

  const detectType = (value) => {
    const v = String(value || "").trim();
    if (!v) return "css";
    if (v.startsWith("page.") || v.startsWith("getBy") || v.startsWith("locator(") || v.includes(".locator(")) return "playwright";
    if (v.startsWith("//") || v.startsWith("(/") || v.startsWith("./") || v.startsWith("(")) return "xpath";
    // A bare relative path (`html/body/div`) or an explicit axis
    // (`following-sibling::button`) is XPath even without a leading slash.
    const plain = unquoted(v);
    if (plain.includes("/") || AXIS.test(plain)) return "xpath";
    return "css";
  };

  const textMatches = (el, value, exact) => {
    const own = U.normalizeText(el.textContent);
    if (!own) return false;
    const normalized = U.normalizeText(value);
    const wanted = exact ? normalized : normalized.toLowerCase();
    const has = exact ? own === wanted : own.toLowerCase().includes(wanted);
    if (!has) return false;
    for (const child of el.children) {
      const t = U.normalizeText(child.textContent);
      if (!t) continue;
      const childHas = exact ? t === wanted : t.toLowerCase().includes(wanted);
      if (childHas) return false;
    }
    return true;
  };

  const labelTargets = (value, exact, doc = document) => {
    const wanted = U.normalizeText(value);
    const needle = exact ? wanted : wanted.toLowerCase();
    const out = new Set();
    for (const el of U.deepEveryElement(doc, [])) {
      if (U.tagOf(el) === "label") {
        const text = U.normalizeText(el.textContent);
        if (exact ? text === wanted : text.toLowerCase().includes(needle)) {
          const id = el.getAttribute("for");
          const root = el.getRootNode ? el.getRootNode() : document;
          let target = null;
          if (id) {
            target = (root.getElementById && root.getElementById(id)) ||
              U.deepQueryAll("#" + U.cssEscape(id), root)[0] ||
              (doc.getElementById ? doc.getElementById(id) : null);
          } else {
            target = el.querySelector("input, select, textarea");
          }
          if (target) out.add(target);
        }
      }
      const aria = U.attr(el, "aria-label");
      if (aria && (exact ? aria === wanted : aria.toLowerCase().includes(needle))) out.add(el);
      const ids = U.attr(el, "aria-labelledby");
      if (ids) {
        const root = el.getRootNode ? el.getRootNode() : doc;
        const by = ids.split(/\s+/).map((id) => {
          const node = root.getElementById ? root.getElementById(id) : null;
          return node ? U.normalizeText(node.textContent) : "";
        }).join(" ").trim();
        if (by && (exact ? by === wanted : by.toLowerCase().includes(needle))) out.add(el);
      }
    }
    return [...out];
  };

  const labelTargetsRegex = (regex, doc = document) => {
    const out = new Set();
    const test = (text) => { regex.lastIndex = 0; return regex.test(text); };
    for (const el of U.deepEveryElement(doc, [])) {
      if (U.tagOf(el) === "label") {
        if (test(U.normalizeText(el.textContent))) {
          const id = el.getAttribute("for");
          const root = el.getRootNode ? el.getRootNode() : document;
          let target = null;
          if (id) {
            target = (root.getElementById && root.getElementById(id)) ||
              U.deepQueryAll("#" + U.cssEscape(id), root)[0] ||
              (doc.getElementById ? doc.getElementById(id) : null);
          } else {
            target = el.querySelector("input, select, textarea");
          }
          if (target) out.add(target);
        }
      }
      const aria = U.attr(el, "aria-label");
      if (aria && test(aria)) out.add(el);
      const ids = U.attr(el, "aria-labelledby");
      if (ids) {
        const root = el.getRootNode ? el.getRootNode() : doc;
        const by = ids.split(/\s+/).map((id) => {
          const node = root.getElementById ? root.getElementById(id) : null;
          return node ? U.normalizeText(node.textContent) : "";
        }).join(" ").trim();
        if (by && test(by)) out.add(el);
      }
    }
    return [...out];
  };

  const resolvePlaywright = (expr, doc = document) => {
    const modifier = expr.match(/\.(first|last|nth)\((\d*)\)$/);
    if (modifier) {
      const base = resolvePlaywright(expr.slice(0, modifier.index), doc);
      if (modifier[1] === "first") return base.slice(0, 1);
      if (modifier[1] === "last") return base.slice(-1);
      return base[Number(modifier[2])] ? [base[Number(modifier[2])]] : [];
    }
    const filterMatch = expr.match(/\.filter\(\s*\{\s*hasText\s*:\s*([^}]+?)\s*\}\s*\)/);
    if (filterMatch && filterMatch.index > 0) {
      const spec = DI.playwright.parseTextFilter(filterMatch[1]);
      if (!spec) return [];
      return resolvePlaywright(expr.slice(0, filterMatch.index), doc)
        .filter((el) => DI.playwright.matchesHasText(el, spec));
    }
    const locatorOption = expr.match(/locator\(\s*(['"])([\s\S]*?)\1\s*,\s*\{\s*hasText\s*:\s*([^}]+?)\s*\}\s*\)\s*$/);
    if (locatorOption) {
      const spec = DI.playwright.parseTextFilter(locatorOption[3]);
      if (!spec) return [];
      return U.deepQueryAll(locatorOption[2], doc).filter((el) => DI.playwright.matchesHasText(el, spec));
    }
    const cssEngine = expr.match(/locator\(\s*['"]css=([\s\S]*?)['"]\s*\)\s*$/);
    if (cssEngine) return U.deepQueryAll(cssEngine[1], doc);
    const xpathEngine = expr.match(/locator\(\s*['"]xpath=([\s\S]*?)['"]\s*\)\s*$/);
    if (xpathEngine) return DI.xpath.snapshot(xpathEngine[1], doc);
    const textEngine = expr.match(/locator\(\s*['"]text=([\s\S]*?)['"]\s*\)\s*$/);
    if (textEngine) {
      const spec = DI.playwright.parseTextFilter(textEngine[1]);
      if (!spec) return [];
      const quoted = /^(['"])[\s\S]*\1$/.test(textEngine[1].trim());
      const all = U.deepEveryElement(doc, []);
      if (spec.regex) return all.filter((el) => DI.playwright.matchesTextRegexSmallest(el, spec.regex));
      return all.filter((el) => textMatches(el, spec.text, quoted));
    }
    const framePattern = /\.frameLocator\(\s*(['"])(.*?)\1\s*\)/g;
    const frameSelectors = [];
    let fm;
    while ((fm = framePattern.exec(expr)) !== null) frameSelectors.push(fm[2]);
    if (frameSelectors.length) {
      let currentDoc = doc;
      for (const sel of frameSelectors) {
        const frame = U.deepQueryAll(sel, currentDoc)[0];
        if (!frame) return [];
        let nextDoc = null;
        try { nextDoc = frame.contentDocument || frame.contentWindow.document; } catch (_) { return []; }
        if (!nextDoc) return [];
        currentDoc = nextDoc;
      }
      const rest = expr.replace(framePattern, "").replace(/^page/, "page");
      return resolvePlaywright(rest, currentDoc);
    }
    const role = expr.match(/getByRole\(\s*['"]((?:\\.|[^'"])+)['"]/);
    if (role) {
      const regex = expr.match(/name:\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      const name = expr.match(/name:\s*['"]((?:\\.|[^'"])+)['"]/);
      const exact = /exact:\s*true/.test(expr);
      let re = null;
      if (regex) {
        try { re = new RegExp(regex[1].replace(/\\\//g, "/"), regex[2]); } catch (_) { re = null; }
      }
      return U.deepEveryElement(doc, []).filter((el) => {
        if (DI.playwright.implicitRole(el) !== role[1]) return false;
        const actual = U.normalizeText(DI.playwright.accessibleName(el));
        if (re) { re.lastIndex = 0; return re.test(actual); }
        if (!name) return true;
        const wanted = U.normalizeText(U.unescapeString(name[1]));
        return exact ? actual === wanted : actual.toLowerCase().includes(wanted.toLowerCase());
      });
    }
    const labelRegex = expr.match(/getByLabel\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (labelRegex) {
      const re = DI.playwright.buildRegex(labelRegex[1], labelRegex[2]);
      return re ? labelTargetsRegex(re, doc) : [];
    }
    const label = expr.match(/getByLabel\(\s*['"]((?:\\.|[^'"])+)['"]/);
    if (label) return labelTargets(U.unescapeString(label[1]), /exact:\s*true/.test(expr), doc);
    const textRegex = expr.match(/getByText\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (textRegex) {
      const re = DI.playwright.buildRegex(textRegex[1], textRegex[2]);
      return re ? U.deepEveryElement(doc, []).filter((el) => DI.playwright.matchesTextRegexSmallest(el, re)) : [];
    }
    const text = expr.match(/getByText\(\s*['"]((?:\\.|[^'"])+)['"]/);
    if (text) return U.deepEveryElement(doc, []).filter((el) => textMatches(el, U.unescapeString(text[1]), /exact:\s*true/.test(expr)));
    const byAttr = (name, raw, exact = false, normalize = true) => {
      const value = U.unescapeString(raw);
      const wanted = normalize ? U.normalizeText(value) : String(value).trim();
      const needle = exact ? wanted : wanted.toLowerCase();
      return U.deepEveryElement(doc, []).filter((el) => {
        const rawActual = U.attr(el, name);
        const actual = normalize ? U.normalizeText(rawActual) : rawActual;
        return exact ? actual === needle : actual.toLowerCase().includes(needle);
      });
    };
    const isExact = /exact:\s*true/.test(expr);
    const placeholder = expr.match(/getByPlaceholder\(\s*['"]((?:\\.|[^'"])+)['"]/);
    if (placeholder) return byAttr("placeholder", placeholder[1], isExact);
    const alt = expr.match(/getByAltText\(\s*['"]((?:\\.|[^'"])+)['"]/);
    if (alt) return byAttr("alt", alt[1], isExact);
    const title = expr.match(/getByTitle\(\s*['"]((?:\\.|[^'"])+)['"]/);
    if (title) return byAttr("title", title[1], isExact);
    const testIdRegex = expr.match(/getByTestId\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (testIdRegex) {
      const re = DI.playwright.buildRegex(testIdRegex[1], testIdRegex[2]);
      if (!re) return [];
      return U.deepEveryElement(doc, []).filter((el) => {
        re.lastIndex = 0;
        return re.test(U.attr(el, "data-testid"));
      });
    }
    const testId = expr.match(/getByTestId\(\s*['"]((?:\\.|[^'"])+)['"]/);
    if (testId) return byAttr("data-testid", testId[1], true, false);
    const visibility = expr.match(/locator\(\s*['"]([^'"]*?):(visible|hidden)['"]\s*\)/);
    if (visibility) {
      const base = (visibility[1] || "*").trim() || "*";
      const wantVisible = visibility[2] === "visible";
      return U.deepQueryAll(base, doc).filter((el) => U.isVisible(el) === wantVisible);
    }
    const engine = expr.match(/locator\(\s*['"]([^'"]*?)(?::has-text|:text-is|:text)\(["']((?:\\.|[^"'])+)["']\)[^'"]*['"]\s*\)/);
    if (engine) {
      const tag = (engine[1] || "").trim() || "*";
      const value = U.unescapeString(engine[2]);
      const mode = expr.includes(":has-text(") ? "has-text"
        : expr.includes(":text-is(") ? "text-is" : "text";
      return U.deepEveryElement(doc, []).filter((el) => {
        if (tag !== "*" && U.tagOf(el) !== tag) return false;
        // `:has-text` also matches ancestors; `:text`/`:text-is` keep the
        // smallest matching element, mirroring Playwright.
        if (mode === "has-text") {
          const hay = U.normalizeText(el.textContent).toLowerCase();
          return hay.includes(U.normalizeText(value).toLowerCase());
        }
        return textMatches(el, value, mode === "text-is");
      });
    }
    const chained = [...expr.matchAll(/\.locator\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map((m) => m[1]);
    if (chained.length > 1) {
      let nodes = U.deepQueryAll(chained[0], doc);
      for (let i = 1; i < chained.length; i += 1) {
        const next = [];
        for (const node of nodes) {
          try {
            const scope = node.shadowRoot || node;
            next.push(...scope.querySelectorAll(chained[i]));
          } catch (_) { /* ignore */ }
        }
        nodes = next;
      }
      return nodes;
    }
    const css = expr.match(/locator\(\s*['"]([^'"]+)['"]\s*\)/);
    if (css && !css[1].startsWith("/")) return U.deepQueryAll(css[1], doc);
    const xp = expr.match(/locator\(\s*`([^`]+)`\s*\)/) || expr.match(/locator\(\s*['"](\/\/[^'"]+)['"]\s*\)/);
    if (xp) return DI.xpath.snapshot(xp[1], doc);
    return [];
  };

  const frameDocs = (doc = document, seen = new Set()) => {
    const docs = [];
    if (!doc || seen.has(doc)) return docs;
    seen.add(doc);
    for (const frame of doc.querySelectorAll("iframe, frame")) {
      let child = null;
      try { child = frame.contentDocument || frame.contentWindow.document; } catch (_) { continue; }
      if (!child) continue;
      docs.push(child);
      docs.push(...frameDocs(child, seen));
    }
    return docs;
  };

  const queryAllWithFrames = (selector) => {
    const out = U.deepQueryAll(selector);
    if (out.length) return out;
    for (const doc of frameDocs()) out.push(...U.deepQueryAll(selector, doc));
    return out;
  };

  const xpathWithFrames = (xpath) => {
    const out = DI.xpath.snapshot(xpath);
    if (out.length) return out;
    for (const doc of frameDocs()) out.push(...DI.xpath.snapshot(xpath, doc));
    return out;
  };

  const resolve = (type, value) => {
    const v = String(value || "").trim();
    if (!v) return { elements: [], error: "Empty locator" };
    if (type === "playwright") {
      try {
        return { elements: resolvePlaywright(v), error: null };
      } catch (error) {
        return { elements: [], error: error.message };
      }
    }
    if (type === "xpath") {
      try {
        const elements = xpathWithFrames(v);
        if (!elements.length) {
          document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        }
        return { elements, error: null };
      } catch (error) {
        return { elements: [], error: error.message };
      }
    }
    try {
      document.querySelectorAll(v);
      return { elements: queryAllWithFrames(v), error: null };
    } catch (error) {
      return { elements: [], error: error.message };
    }
  };

  const highlighted = new Map();
  const clearHighlight = () => {
    for (const [el, style] of highlighted) {
      el.style.outline = style.outline;
      el.style.outlineOffset = style.offset;
    }
    highlighted.clear();
  };

  const highlight = (elements) => {
    clearHighlight();
    for (const el of elements) {
      if (!el || el.nodeType !== 1) continue;
      highlighted.set(el, { outline: el.style.outline, offset: el.style.outlineOffset });
      el.style.outline = "2px solid #ff5a1f";
      el.style.outlineOffset = "1px";
    }
    if (elements[0] && elements[0].scrollIntoView) {
      try { elements[0].scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) {}
    }
  };

  const test = (type, value) => {
    const actualType = type === "auto" ? detectType(value) : type;
    const { elements, error } = resolve(actualType, value);
    return {
      ok: !error && elements.length > 0,
      type: actualType,
      count: elements.length,
      error: error || (elements.length ? null : "No elements matched"),
      elements
    };
  };

  DI.validate = { detectType, resolve, test, highlight, clearHighlight };
})();
