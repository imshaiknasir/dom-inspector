/* DOM Inspector — fix-selector repair loop.
 * Normalises a broken selector, validates it, and if it still fails, finds the
 * best-matching element from its tokens and regenerates stable locators.
 */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  const attrValue = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const bySelector = (kind, inner) => {
    if (kind === "id") return "#" + U.cssEscape(inner);
    if (kind === "name") return `[name="${attrValue(inner)}"]`;
    if (kind === "className") return "." + U.cssEscape(String(inner).trim().split(/\s+/)[0] || "");
    if (kind === "tagName") return String(inner).trim();
    return inner;
  };

  /* Extract the raw locator from a pasted one-line client call. */
  const unwrap = (value) => {
    const nested = value.match(
      /^(?:await\s+)?[\w$.]+\.findElement\(\s*By\.(cssSelector|xpath|id|name|className|tagName)\(\s*(['"])([\s\S]*?)\2\s*\)\s*\)\s*;?$/
    );
    if (nested) return bySelector(nested[1], nested[3]);
    const by = value.match(
      /^(?:await\s+)?By\.(cssSelector|xpath|id|name|className|tagName)\(\s*(['"])([\s\S]*?)\2\s*\)\s*;?$/
    );
    if (by) return bySelector(by[1], by[3]);
    const idCall = value.match(/^(?:await\s+)?document\.getElementById\(\s*(['"])([\s\S]*?)\1\s*\)\s*;?$/);
    if (idCall) return "#" + U.cssEscape(idCall[2]);
    const call = value.match(
      /^(?:await\s+)?(?:document\.querySelector(?:All)?|page\.locator|cy\.(?:get|xpath)|\$|jQuery)\(\s*(['"])([\s\S]*?)\1\s*\)(?:\[\s*\d+\s*\])?\s*;?$/
    );
    if (call) return call[2];
    const testId = value.match(/^(?:await\s+)?page\.getByTestId\(\s*(['"])([\s\S]*?)\1\s*\)\s*;?$/);
    if (testId) return `[data-testid="${attrValue(testId[2])}"]`;
    return value;
  };

  /* Collapse whitespace outside quoted values so attribute strings survive. */
  const normalizeSpaces = (value) => {
    let out = "";
    let quote = null;
    let space = false;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (quote) {
        out += ch;
        if (ch === "\\") { if (i + 1 < value.length) { i += 1; out += value[i]; } }
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        if (space && out) out += " ";
        space = false;
        quote = ch;
        out += ch;
        continue;
      }
      if (/\s/.test(ch)) { space = true; continue; }
      if (space && out) out += " ";
      space = false;
      out += ch;
    }
    return out;
  };

  const normalize = (input) => {
    let value = String(input == null ? "" : input)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\u00a0/g, " ")
      .trim();
    if (!value) return "";
    value = unwrap(value).trim();
    const wrapped = value.match(/^(['"`])([\s\S]*)\1$/);
    if (wrapped) value = wrapped[2].trim();
    value = value.replace(/\/{3,}/g, "//");
    value = normalizeSpaces(value);
    value = value.replace(/^[>+~]+/, "").trim();
    value = value.replace(/[;,]+$/g, "").trim();
    value = value.replace(/[>+\s]+$/g, "").trim();
    if (balanced(value)) return value;
    // Balance in the order a human would close: quotes, parentheses, brackets.
    for (const quote of ["'", '"']) {
      const count = value.split(quote).length - 1;
      if (count % 2 === 1) value += quote;
    }
    for (const [open, close] of [["{", "}"], ["(", ")"], ["[", "]"]]) {
      const opens = value.split(open).length - 1;
      const closes = value.split(close).length - 1;
      if (opens > closes) value += close.repeat(opens - closes);
    }
    return value;
  };

  const balanced = (value) => {
    let quote = null;
    let brackets = 0;
    let parens = 0;
    let braces = 0;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === "\\") { i += 1; continue; }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "[") brackets += 1;
      else if (ch === "]") brackets -= 1;
      else if (ch === "(") parens += 1;
      else if (ch === ")") parens -= 1;
      else if (ch === "{") braces += 1;
      else if (ch === "}") braces -= 1;
      if (brackets < 0 || parens < 0 || braces < 0) return false;
    }
    return quote === null && brackets === 0 && parens === 0 && braces === 0;
  };

  const tokens = (value) => {
    const out = [];
    const add = (type, token) => { if (token) out.push({ type, token: String(token) }); };
    for (const m of value.matchAll(/#([A-Za-z0-9_\-:.]+)/g)) add("id", m[1]);
    for (const m of value.matchAll(/\.([A-Za-z0-9_\-]+)/g)) add("class", m[1]);
    for (const m of value.matchAll(/\[\s*([A-Za-z0-9_\-:]+)\s*=\s*(['"]?)([^'"\]]+)\2\s*\]/g)) add("attr:" + m[1], m[3]);
    for (const m of value.matchAll(/(?:^|[\/\s>+~])([a-zA-Z][a-zA-Z0-9-]{0,20})(?=[\[\s.:#>\[]|$)/g)) add("tag", m[1].toLowerCase());

    if (/getBy[A-Za-z]+\(/.test(value)) {
      // Playwright arguments carry the intent: role + name, label, placeholder,
      // alt, title or test id. Score these fuzzily so near-miss wording still
      // finds the element the author meant.
      const roleCall = value.match(/getByRole\(\s*(['"])((?:\\.|[^'"])+)\1\s*(?:,\s*\{([\s\S]*?)\})?/);
      if (roleCall) {
        add("role", U.unescapeString(roleCall[2]));
        const named = roleCall[3] && roleCall[3].match(/name:\s*(['"])((?:\\.|[^'"])+)\1/);
        if (named) add("text", U.unescapeString(named[2]));
      }
      const kinds = { Label: "label", Placeholder: "placeholder", AltText: "alt", Title: "title", TestId: "testid", Text: "text" };
      for (const m of value.matchAll(/getBy(Label|Placeholder|AltText|Title|TestId|Text)\(\s*(['"])((?:\\.|[^'"])+)\2/g)) {
        add(kinds[m[1]], U.unescapeString(m[3]));
      }
    } else {
      for (const m of value.matchAll(/['"]([^'"]{2,40})['"]/g)) add("text", m[1]);
    }
    return out;
  };

  /* Levenshtein-based similarity in [0, 1]; tokens are short. */
  const similarity = (a, b) => {
    const x = U.normalizeText(a).toLowerCase();
    const y = U.normalizeText(b).toLowerCase();
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return 0.86;
    const longest = Math.max(x.length, y.length);
    if (Math.abs(x.length - y.length) > longest * 0.5) return 0;
    let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i += 1) {
      const row = [i];
      for (let j = 1; j <= y.length; j += 1) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return 1 - prev[y.length] / longest;
  };

  const nameScore = (values, token) => {
    let best = 0;
    for (const value of values) {
      if (!value) continue;
      const sim = similarity(value, token);
      if (sim >= 0.62) best = Math.max(best, Math.round(sim * 26));
    }
    return best;
  };

  const score = (el, list) => {
    let total = 0;
    const id = U.attr(el, "id");
    const cls = U.attr(el, "class");
    const name = U.attr(el, "name");
    const tag = U.tagOf(el);
    const text = tag === "html" || tag === "body" ? "" : U.normalizeText(el.textContent);
    const labels = el.labels && el.labels.length
      ? Array.from(el.labels).map((label) => U.normalizeText(label.textContent))
      : [];
    const accessibleName = () => (DI.playwright ? DI.playwright.accessibleName(el) : "");
    for (const { type, token } of list) {
      if (type === "id") total += id === token ? 60 : id.includes(token) ? 24 : 0;
      else if (type === "class") total += cls.split(/\s+/).includes(token) ? 20 : cls.includes(token) ? 8 : 0;
      else if (type === "tag") total += tag === token ? 4 : 0;
      else if (type.startsWith("attr:")) {
        const attr = type.slice(5);
        const raw = U.rawAttr(el, attr);
        const wanted = U.unescapeString(token);
        total += raw === wanted ? 26
          : raw.trim() === wanted.trim() ? 20
            : raw.includes(wanted) ? 10 : 0;
      } else if (type === "role") total += DI.playwright && DI.playwright.implicitRole(el) === token ? 8 : 0;
      else if (type === "label") {
        // getByLabel resolves the labelled control, not the label element.
        const explicit = nameScore(labels, token);
        const viaName = tag === "label" ? 0 : nameScore([accessibleName()], token);
        total += Math.max(explicit, viaName);
      }
      else if (type === "placeholder") total += nameScore([U.attr(el, "placeholder")], token);
      else if (type === "alt") total += nameScore([U.attr(el, "alt")], token);
      else if (type === "title") total += nameScore([U.attr(el, "title")], token);
      else if (type === "testid") {
        const raw = U.rawAttr(el, "data-testid");
        total += raw === token ? 28 : raw.trim() === token.trim() ? 22 : raw.includes(token) ? 12 : 0;
      }
      else if (type === "text") total += nameScore([text, accessibleName()], token);
    }
    return total;
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

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK", "BASE"]);

  const collect = (root, out) => {
    for (const node of root.querySelectorAll("*")) {
      if (SKIP_TAGS.has(node.tagName)) continue;
      out.push(node);
      if (node.shadowRoot) collect(node.shadowRoot, out);
    }
    return out;
  };

  const allElements = () => {
    const out = collect(document, []);
    for (const doc of frameDocs()) collect(doc, out);
    return out;
  };

  const bestElement = (list, candidates) => {
    let best = null;
    let bestScore = 0;
    const elements = candidates || allElements();
    for (const el of elements) {
      const s = score(el, list);
      if (s > bestScore || (s === bestScore && s > 0 && best && U.isVisible(el) && !U.isVisible(best))) {
        best = el;
        bestScore = s;
      }
    }
    return bestScore >= 4 ? { element: best, score: bestScore } : null;
  };

  const locatorsFor = (el) => {
    const frames = U.iframeChain(el.ownerDocument && el.ownerDocument.defaultView
      ? el.ownerDocument.defaultView : window);
    const frameCss = frames.map((frame) => {
      const id = U.attr(frame, "id");
      if (id) return "#" + U.cssEscape(id);
      const name = U.attr(frame, "name");
      if (name) return `[name="${name.replace(/"/g, '\\"')}"]`;
      const best = DI.css.best(frame);
      return best && best.selector ? best.selector : "iframe";
    });
    const frameXpath = frames.map((frame) => {
      const id = U.attr(frame, "id");
      if (id) return `//iframe[@id=${U.xpathLiteral(id)}]`;
      const name = U.attr(frame, "name");
      if (name) return `//iframe[@name=${U.xpathLiteral(name)}]`;
      return DI.xpath.absoluteXPath(frame) || "//iframe";
    });
    const css = DI.css.best(el);
    const xp = DI.xpath.best(el);
    const pwCandidates = DI.playwright.generate(el);
    const pw = pwCandidates.find((c) => c.count === 1) || pwCandidates[0] || null;
    const selenium = DI.formats.generate(el);
    return {
      css: css ? css.selector : null,
      xpath: xp ? xp.xpath : null,
      playwright: pw ? pw.selector : null,
      id: (selenium.find((r) => r.type === "id" && r.count === 1) || {}).value || null,
      frameCss,
      frameXpath,
      matchCount: css ? css.count : null
    };
  };

  const fix = (input, candidates) => {
    const original = String(input == null ? "" : input).trim();
    const attempts = [];
    const hasRegex = /(?:name|hasText):\s*\//.test(original);
    if (original && (balanced(original) || hasRegex)) attempts.push(original);
    const first = normalize(original);
    if (first && first !== original) attempts.push(first);
    for (const value of attempts) {
      const result = DI.validate.test("auto", value);
      if (result.ok) {
        const el = result.elements.find((node) => node && node.nodeType === 1) || null;
        let locators = null;
        if (el) {
          try { locators = locatorsFor(el); } catch (_) { locators = null; }
        }
        return {
          ok: true,
          repaired: value !== original,
          fixed: value,
          count: result.count,
          type: result.type,
          element: el ? { tag: U.tagOf(el), id: U.attr(el, "id"), text: U.normalizeText(el.textContent).slice(0, 80) } : null,
          locators
        };
      }
    }
    // A structurally valid XPath that selects text/attribute nodes is not an
    // element locator, but it is not "broken" either: report it as-is.
    const candidate = first || original;
    if (DI.validate.detectType(candidate) === "xpath") {
      let nodes = [];
      try { nodes = DI.xpath.snapshot(candidate); } catch (_) { nodes = []; }
      if (!nodes.length) {
        for (const doc of frameDocs()) nodes.push(...DI.xpath.snapshot(candidate, doc));
      }
      if (nodes.length && !nodes.some((node) => node && node.nodeType === 1)) {
        return {
          ok: true,
          repaired: candidate !== original,
          fixed: candidate,
          count: nodes.length,
          type: "xpath",
          element: null,
          locators: null
        };
      }
    }
    const list = tokens(candidate);
    const found = bestElement(list, candidates);
    if (!found) {
      return { ok: false, fixed: first || original, error: "No matching element found", tokens: list };
    }
    let locators = null;
    try { locators = locatorsFor(found.element); } catch (_) { locators = null; }
    const fixed = (locators && (locators.css || locators.xpath)) || first || original;
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

  const fixMany = (values) => {
    const list = Array.isArray(values) ? values.slice(0, 200) : [];
    if (!list.length) return [];
    // Scan the document once for the whole batch instead of once per value.
    const candidates = allElements();
    return list.map((value) => fix(value, candidates));
  };

  DI.repair = { normalize, tokens, fix, fixMany };
})();
