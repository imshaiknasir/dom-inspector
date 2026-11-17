/* DOM Inspector — fix-selector repair loop.
 * Normalises a broken selector, validates it, and if it still fails, finds the
 * best-matching element from its tokens and regenerates stable locators.
 */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  const normalize = (input) => {
    let value = String(input == null ? "" : input)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\u00a0/g, " ")
      .trim();
    if (!value) return "";
    const wrapped = value.match(/^(['"`])([\s\S]*)\1$/);
    if (wrapped) value = wrapped[2].trim();
    value = value.replace(/\/{3,}/g, "//");
    value = value.replace(/\s+/g, " ");
    value = value.replace(/^[>+~]+/, "").trim();
    value = value.replace(/[;,]+$/g, "").trim();
    value = value.replace(/[>+\s]+$/g, "").trim();
    // Balance quotes, brackets and parentheses.
    for (const [open, close] of [["[", "]"], ["(", ")"], ["'", "'"], ['"', '"']]) {
      const opens = value.split(open).length - 1;
      const closes = value.split(close).length - 1;
      if (opens > closes && !(open === close && opens % 2 === 0)) {
        value += close.repeat(opens - closes);
      }
    }
    return value;
  };

  const tokens = (value) => {
    const out = [];
    const add = (type, token) => { if (token) out.push({ type, token: String(token) }); };
    for (const m of value.matchAll(/#([A-Za-z0-9_\-:.]+)/g)) add("id", m[1]);
    for (const m of value.matchAll(/\.([A-Za-z0-9_\-]+)/g)) add("class", m[1]);
    for (const m of value.matchAll(/\[\s*([A-Za-z0-9_\-:]+)\s*=\s*(['"]?)([^'"\]]+)\2\s*\]/g)) add("attr:" + m[1], m[3]);
    for (const m of value.matchAll(/(?:^|[\/\s>+~])([a-zA-Z][a-zA-Z0-9-]{0,20})(?=[\[\s.:#>\[]|$)/g)) add("tag", m[1].toLowerCase());
    for (const m of value.matchAll(/['"]([^'"]{2,40})['"]/g)) add("text", m[1]);
    return out;
  };

  const score = (el, list) => {
    let total = 0;
    const id = U.attr(el, "id");
    const cls = U.attr(el, "class");
    const name = U.attr(el, "name");
    const text = U.normalizeText(el.textContent);
    for (const { type, token } of list) {
      if (type === "id") total += id === token ? 60 : id.includes(token) ? 24 : 0;
      else if (type === "class") total += cls.split(/\s+/).includes(token) ? 20 : cls.includes(token) ? 8 : 0;
      else if (type === "tag") total += U.tagOf(el) === token ? 4 : 0;
      else if (type.startsWith("attr:")) {
        const attr = type.slice(5);
        total += U.attr(el, attr) === token ? 26 : U.attr(el, attr).includes(token) ? 10 : 0;
      } else if (type === "text") total += text.includes(token) ? 12 : 0;
    }
    return total;
  };

  const bestElement = (list) => {
    let best = null;
    let bestScore = 0;
    for (const el of U.deepEveryElement(document, [])) {
      const s = score(el, list);
      if (s > bestScore || (s === bestScore && s > 0 && best && U.isVisible(el) && !U.isVisible(best))) {
        best = el;
        bestScore = s;
      }
    }
    return bestScore >= 4 ? { element: best, score: bestScore } : null;
  };

  const locatorsFor = (el) => {
    const css = DI.css.best(el);
    const xp = DI.xpath.best(el);
    const pw = DI.playwright.generate(el).find((c) => c.count === 1) || DI.playwright.generate(el)[0] || null;
    const selenium = DI.formats.generate(el);
    return {
      css: css ? css.selector : null,
      xpath: xp ? xp.xpath : null,
      playwright: pw ? pw.selector : null,
      id: (selenium.find((r) => r.type === "id" && r.count === 1) || {}).value || null,
      matchCount: css ? css.count : null
    };
  };

  const fix = (input) => {
    const original = String(input == null ? "" : input).trim();
    const attempts = [];
    const first = normalize(original);
    if (first) attempts.push(first);
    for (const value of attempts) {
      const result = DI.validate.test("auto", value);
      if (result.ok) {
        return { ok: true, repaired: value !== original, fixed: value, count: result.count, type: result.type, locators: locatorsFor(result.elements[0]) };
      }
    }
    const list = tokens(original);
    const found = bestElement(list);
    if (!found) {
      return { ok: false, fixed: first || original, error: "No matching element found", tokens: list };
    }
    const locators = locatorsFor(found.element);
    const fixed = locators.css || locators.xpath || first || original;
    return {
      ok: true,
      repaired: true,
      fixed,
      type: locators.css ? "css" : "xpath",
      count: 1,
      score: found.score,
      element: { tag: U.tagOf(found.element), id: U.attr(found.element, "id"), text: U.normalizeText(found.element.textContent).slice(0, 80) },
      locators
    };
  };

  DI.repair = { normalize, tokens, fix };
})();
