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
    if (/^id\(\s*['"]/.test(v)) return "xpath";
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
    for (const el of U.deepContentElements(doc, [])) {
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
    for (const el of U.deepContentElements(doc, [])) {
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
      const all = U.deepContentElements(doc, []);
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
    const roleCall = DI.playwright.callArg(expr, "getByRole");
    if (roleCall) {
      const regex = expr.match(/name:\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      const name = expr.match(/name:\s*['"]((?:\\.|[^'"])+)['"]/);
      const exact = /exact:\s*true/.test(expr);
      const options = DI.playwright.roleOptions(expr);
      const re = regex ? DI.playwright.buildRegex(regex[1], regex[2]) : null;
      return U.deepContentElements(doc, []).filter((el) => {
        if (DI.playwright.implicitRole(el) !== roleCall.value) return false;
        if (!options.includeHidden && !DI.playwright.roleEligible(el)) return false;
        if (options.level && roleCall.value === "heading" && DI.playwright.roleLevel(el) !== options.level) return false;
        if (!DI.playwright.roleStateMatches(el, options)) return false;
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
    const labelCall = DI.playwright.callArg(expr, "getByLabel");
    if (labelCall) return labelTargets(labelCall.value, /exact:\s*true/.test(expr), doc);
    const textRegex = expr.match(/getByText\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (textRegex) {
      const re = DI.playwright.buildRegex(textRegex[1], textRegex[2]);
      return re ? U.deepContentElements(doc, []).filter((el) => DI.playwright.matchesTextRegexSmallest(el, re)) : [];
    }
    const textCall = DI.playwright.callArg(expr, "getByText");
    if (textCall) {
      return U.deepContentElements(doc, []).filter((el) => textMatches(el, textCall.value, /exact:\s*true/.test(expr)));
    }
    const byAttr = (name, value, exact = false, normalize = true) => {
      const wanted = normalize ? U.normalizeText(value) : String(value).trim();
      const needle = exact ? wanted : wanted.toLowerCase();
      return U.deepContentElements(doc, []).filter((el) => {
        const rawActual = U.attr(el, name);
        const actual = normalize ? U.normalizeText(rawActual) : rawActual;
        return exact ? actual === needle : actual.toLowerCase().includes(needle);
      });
    };
    const isExact = /exact:\s*true/.test(expr);
    const byAttrRegex = (name, regexMatch) => {
      const re = DI.playwright.buildRegex(regexMatch[1], regexMatch[2]);
      if (!re) return [];
      return U.deepContentElements(doc, []).filter((el) => {
        re.lastIndex = 0;
        return re.test(U.attr(el, name));
      });
    };
    const placeholderRegex = expr.match(/getByPlaceholder\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (placeholderRegex) return byAttrRegex("placeholder", placeholderRegex);
    const placeholder = DI.playwright.callArg(expr, "getByPlaceholder");
    if (placeholder) return byAttr("placeholder", placeholder.value, isExact);
    const altRegex = expr.match(/getByAltText\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (altRegex) return byAttrRegex("alt", altRegex);
    const alt = DI.playwright.callArg(expr, "getByAltText");
    if (alt) return byAttr("alt", alt.value, isExact);
    const titleRegex = expr.match(/getByTitle\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (titleRegex) return byAttrRegex("title", titleRegex);
    const title = DI.playwright.callArg(expr, "getByTitle");
    if (title) return byAttr("title", title.value, isExact);
    const testIdRegex = expr.match(/getByTestId\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
    if (testIdRegex) {
      const re = DI.playwright.buildRegex(testIdRegex[1], testIdRegex[2]);
      if (!re) return [];
      return U.deepContentElements(doc, []).filter((el) => {
        re.lastIndex = 0;
        return re.test(U.attr(el, "data-testid"));
      });
    }
    const testId = DI.playwright.callArg(expr, "getByTestId");
    if (testId) return byAttr("data-testid", testId.value, true, false);

    const chainedLocators = [...expr.matchAll(/\.locator\(\s*(['"`])([\s\S]*?)\1\s*\)/g)]
      .map((match) => U.unescapeString(match[2]));
    if (chainedLocators.length > 1) {
      let nodes = U.deepQueryAll(chainedLocators[0], doc);
      for (let i = 1; i < chainedLocators.length; i += 1) {
        const next = [];
        for (const node of nodes) {
          try {
            const scope = node.shadowRoot || node;
            next.push(...scope.querySelectorAll(chainedLocators[i]));
          } catch (_) { /* ignore */ }
        }
        nodes = next;
      }
      return nodes;
    }
    const call = DI.playwright.parseLocatorCall(expr);
    if (!call) return [];
    const arg = call.arg;
    const engine = arg.match(/^(.*?):(has-text|text-is|text)\(\s*(['"])([\s\S]*)\3\s*\)\s*$/);
    if (engine) {
      const tag = (engine[1] || "").trim() || "*";
      const mode = engine[2];
      const value = U.unescapeString(engine[4]);
      return U.deepContentElements(doc, []).filter((el) => {
        if (tag !== "*" && U.tagOf(el) !== tag) return false;
        if (mode === "has-text") {
          const hay = U.normalizeText(el.textContent).toLowerCase();
          return hay.includes(U.normalizeText(value).toLowerCase());
        }
        return textMatches(el, value, mode === "text-is");
      });
    }
    const visibility = arg.match(/^(.*?):(visible|hidden)$/);
    if (visibility) {
      const base = (visibility[1] || "*").trim() || "*";
      const wantVisible = visibility[2] === "visible";
      return U.deepQueryAll(base, doc).filter((el) => U.isVisible(el) === wantVisible);
    }
    if (arg.startsWith("css=")) return U.deepQueryAll(arg.slice(4), doc);
    if (arg.startsWith("xpath=")) return DI.xpath.snapshot(arg.slice(6), doc);
    if (arg.startsWith("text=")) {
      const raw = arg.slice(5);
      const spec = DI.playwright.parseTextFilter(raw);
      if (!spec) return [];
      const quoted = /^(['"])[\s\S]*\1$/.test(raw.trim());
      const all = U.deepContentElements(doc, []);
      if (spec.regex) return all.filter((el) => DI.playwright.matchesTextRegexSmallest(el, spec.regex));
      return all.filter((el) => textMatches(el, spec.text, quoted));
    }
    if (arg.startsWith("//") || arg.startsWith("(")) return DI.xpath.snapshot(arg, doc);
    try { return U.deepQueryAll(arg, doc); } catch (_) { return []; }
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

  const HIGHLIGHT_LIMIT = 500;

  const highlight = (elements) => {
    clearHighlight();
    let marked = 0;
    for (const el of elements) {
      if (!el || el.nodeType !== 1 || !el.isConnected) continue;
      if (marked >= HIGHLIGHT_LIMIT) break;
      highlighted.set(el, { outline: el.style.outline, offset: el.style.outlineOffset });
      el.style.outline = "2px solid #ff5a1f";
      el.style.outlineOffset = "1px";
      marked += 1;
    }
    if (elements[0] && elements[0].scrollIntoView) {
      try { elements[0].scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) {}
    }
  };

  const test = (type, value) => {
    const actualType = type === "auto" ? detectType(value) : type;
    const { elements, error } = resolve(actualType, value);
    // Attribute and text node XPath results are not element locators.
    const nodes = (elements || []).filter((node) => node && node.nodeType === 1);
    return {
      ok: !error && nodes.length > 0,
      type: actualType,
      count: nodes.length,
      error: error || (nodes.length ? null : "No elements matched"),
      elements: nodes
    };
  };

  DI.validate = { detectType, resolve, test, highlight, clearHighlight };
})();
