/* DOM Inspector — locator detection, validation, match resolution and highlighting. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  const detectType = (value) => {
    const v = String(value || "").trim();
    if (!v) return "css";
    if (v.startsWith("page.") || v.startsWith("getBy")) return "playwright";
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

  const labelTargets = (value, exact) => {
    const out = new Set();
    for (const el of U.deepEveryElement(document, [])) {
      if (U.tagOf(el) === "label") {
        const text = U.normalizeText(el.textContent);
        if (exact ? text === value : text.includes(value)) {
          const id = el.getAttribute("for");
          const target = id ? document.getElementById(id) : el.querySelector("input, select, textarea");
          if (target) out.add(target);
        }
      }
      const aria = U.attr(el, "aria-label");
      if (aria && (exact ? aria === value : aria.includes(value))) out.add(el);
    }
    return [...out];
  };

  const resolvePlaywright = (expr) => {
    const role = expr.match(/getByRole\(\s*['"]([^'"]+)['"]/);
    if (role) {
      const name = expr.match(/name:\s*['"]([^'"]+)['"]/);
      const exact = /exact:\s*true/.test(expr);
      return U.deepEveryElement(document, []).filter((el) => {
        if (DI.playwright.implicitRole(el) !== role[1]) return false;
        if (!name) return true;
        const actual = U.normalizeText(DI.playwright.accessibleName(el));
        return exact ? actual === name[1] : actual.includes(name[1]);
      });
    }
    const label = expr.match(/getByLabel\(\s*['"]([^'"]+)['"]/);
    if (label) return labelTargets(label[1], /exact:\s*true/.test(expr));
    const text = expr.match(/getByText\(\s*['"]([^'"]+)['"]/);
    if (text) return U.deepEveryElement(document, []).filter((el) => textMatches(el, text[1], /exact:\s*true/.test(expr)));
    const placeholder = expr.match(/getByPlaceholder\(\s*['"]([^'"]+)['"]/);
    if (placeholder) return U.deepQueryAll(`[placeholder="${placeholder[1].replace(/"/g, '\\"')}"]`);
    const alt = expr.match(/getByAltText\(\s*['"]([^'"]+)['"]/);
    if (alt) return U.deepQueryAll(`[alt="${alt[1].replace(/"/g, '\\"')}"]`);
    const title = expr.match(/getByTitle\(\s*['"]([^'"]+)['"]/);
    if (title) return U.deepQueryAll(`[title="${title[1].replace(/"/g, '\\"')}"]`);
    const testId = expr.match(/getByTestId\(\s*['"]([^'"]+)['"]/);
    if (testId) {
      return ["data-testid", "data-test-id", "data-test", "data-cy"]
        .flatMap((name) => U.deepQueryAll(`[${name}="${testId[1].replace(/"/g, '\\"')}"]`));
    }
    const css = expr.match(/locator\(\s*['"]([^'"]+)['"]\s*\)/);
    if (css && !css[1].startsWith("/")) return U.deepQueryAll(css[1]);
    const xp = expr.match(/locator\(\s*`([^`]+)`\s*\)/) || expr.match(/locator\(\s*['"](\/\/[^'"]+)['"]\s*\)/);
    if (xp) return DI.xpath.snapshot(xp[1]);
    return [];
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
        const elements = DI.xpath.snapshot(v);
        if (!elements.length) {
          document.evaluate(v, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        }
        return { elements, error: null };
      } catch (error) {
        return { elements: [], error: error.message };
      }
    }
    try {
      const probe = document.querySelectorAll(v);
      return { elements: U.deepQueryAll(v), error: probe ? null : null };
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
