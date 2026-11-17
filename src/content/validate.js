/* DOM Inspector — locator detection, validation, match resolution and highlighting. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  const cssValue = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const detectType = (value) => {
    const v = String(value || "").trim();
    if (!v) return "css";
    if (v.startsWith("page.") || v.startsWith("getBy") || v.startsWith("locator(") || v.includes(".locator(")) return "playwright";
    if (v.startsWith("//") || v.startsWith("(/") || v.startsWith("./") || v.startsWith("(")) return "xpath";
    return "css";
  };

  const textMatches = (el, value, exact) => {
    const own = U.normalizeText(el.textContent);
    if (!own) return false;
    if (exact ? own !== value : !own.includes(value)) return false;
    for (const child of el.children) {
      const t = U.normalizeText(child.textContent);
      if (t && (exact ? t === value : t.includes(value))) return false;
    }
    return true;
  };

  const labelTargets = (value, exact, doc = document) => {
    const out = new Set();
    for (const el of U.deepEveryElement(doc, [])) {
      if (U.tagOf(el) === "label") {
        const text = U.normalizeText(el.textContent);
        if (exact ? text === value : text.includes(value)) {
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
      if (aria && (exact ? aria === value : aria.includes(value))) out.add(el);
      const ids = U.attr(el, "aria-labelledby");
      if (ids) {
        const root = el.getRootNode ? el.getRootNode() : doc;
        const by = ids.split(/\s+/).map((id) => {
          const node = root.getElementById ? root.getElementById(id) : null;
          return node ? U.normalizeText(node.textContent) : "";
        }).join(" ").trim();
        if (by && (exact ? by === value : by.includes(value))) out.add(el);
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
    const role = expr.match(/getByRole\(\s*['"]([^'"]+)['"]/);
    if (role) {
      const regex = expr.match(/name:\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      const name = expr.match(/name:\s*['"]([^'"]+)['"]/);
      const exact = /exact:\s*true/.test(expr);
      let re = null;
      if (regex) {
        try { re = new RegExp(regex[1].replace(/\\\//g, "/"), regex[2]); } catch (_) { re = null; }
      }
      return U.deepEveryElement(doc, []).filter((el) => {
        if (DI.playwright.implicitRole(el) !== role[1]) return false;
        const actual = U.normalizeText(DI.playwright.accessibleName(el));
        if (re) return re.test(actual);
        if (!name) return true;
        return exact ? actual === name[1] : actual.includes(name[1]);
      });
    }
    const label = expr.match(/getByLabel\(\s*['"]([^'"]+)['"]/);
    if (label) return labelTargets(U.unescapeString(label[1]), /exact:\s*true/.test(expr), doc);
    const text = expr.match(/getByText\(\s*['"]([^'"]+)['"]/);
    if (text) return U.deepEveryElement(doc, []).filter((el) => textMatches(el, U.unescapeString(text[1]), /exact:\s*true/.test(expr)));
    const placeholder = expr.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/);
    if (placeholder) return U.deepQueryAll(`[placeholder="${cssValue(U.unescapeString(placeholder[1]))}"]`, doc);
    const alt = expr.match(/getByAltText\(\s*['"]([^'"]+)['"]/);
    if (alt) return U.deepQueryAll(`[alt="${cssValue(U.unescapeString(alt[1]))}"]`, doc);
    const title = expr.match(/getByTitle\(\s*['"]([^'"]+)['"]/);
    if (title) return U.deepQueryAll(`[title="${cssValue(U.unescapeString(title[1]))}"]`, doc);
    const testId = expr.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
    if (testId) {
      return ["data-testid", "data-test-id", "data-test", "data-cy"]
        .flatMap((name) => U.deepQueryAll(`[${name}="${cssValue(U.unescapeString(testId[1]))}"]`, doc));
    }
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
      const exact = expr.includes(":text-is(");
      return U.deepEveryElement(doc, []).filter((el) => {
        if (tag !== "*" && U.tagOf(el) !== tag) return false;
        return textMatches(el, value, exact);
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
    const filtered = expr.match(/locator\(\s*['"]([^'"]+)['"]\s*\)\.filter\(\{\s*hasText:\s*['"]((?:\\.|[^'"])+)['"]\s*\}\)/);
    if (filtered) {
      return U.deepQueryAll(filtered[1], doc).filter((el) => U.normalizeText(el.textContent).includes(U.unescapeString(filtered[2])));
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
    for (const doc of frameDocs()) out.push(...U.deepQueryAll(selector, doc));
    return out;
  };

  const xpathWithFrames = (xpath) => {
    const out = DI.xpath.snapshot(xpath);
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
