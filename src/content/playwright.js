/* DOM Inspector — Playwright locators with a local counting engine. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  const SECTIONING = new Set(["ARTICLE", "ASIDE", "MAIN", "NAV", "SECTION"]);

  const hasSectioningAncestor = (el) => {
    let node = el.parentElement;
    while (node) {
      if (SECTIONING.has(node.tagName)) return true;
      node = node.parentElement;
    }
    return false;
  };

  const hasAccessibleLabel = (el) => !!(U.attr(el, "aria-label") || U.attr(el, "aria-labelledby") || U.attr(el, "title"));

  const ROLE_MAP = {
    a: (el) => (el.hasAttribute("href") ? "link" : null),
    area: (el) => (el.hasAttribute("href") ? "link" : null),
    article: () => "article",
    aside: () => "complementary",
    button: () => "button",
    caption: () => "caption",
    dialog: () => "dialog",
    fieldset: () => "group",
    figure: () => "figure",
    footer: (el) => (hasSectioningAncestor(el) ? null : "contentinfo"),
    form: (el) => (hasAccessibleLabel(el) ? "form" : null),
    h1: () => "heading", h2: () => "heading", h3: () => "heading",
    h4: () => "heading", h5: () => "heading", h6: () => "heading",
    header: (el) => (hasSectioningAncestor(el) ? null : "banner"),
    hr: () => "separator",
    img: (el) => (el.getAttribute("alt") === "" ? null : "img"),
    input: (el) => {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") return null;
      if (["button", "submit", "reset", "image", "file"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return "textbox";
    },
    li: () => "listitem",
    main: () => "main",
    nav: () => "navigation",
    ol: () => "list",
    option: () => "option",
    progress: () => "progressbar",
    section: (el) => (hasAccessibleLabel(el) ? "region" : null),
    select: (el) => (el.multiple || Number(el.getAttribute("size") || 0) > 1 ? "listbox" : "combobox"),
    table: () => "table",
    tbody: () => "rowgroup",
    td: () => "cell",
    textarea: () => "textbox",
    tfoot: () => "rowgroup",
    th: (el) => ((el.getAttribute("scope") || "").toLowerCase() === "row" ? "rowheader" : "columnheader"),
    thead: () => "rowgroup",
    tr: () => "row",
    ul: () => "list"
  };

  const implicitRole = (el) => {
    const explicit = (el.getAttribute("role") || "").split(/\s+/)[0];
    if (explicit) return explicit;
    const fn = ROLE_MAP[U.tagOf(el)];
    return fn ? fn(el) : null;
  };

  const labelledByText = (el) => {
    const ids = U.attr(el, "aria-labelledby");
    if (!ids) return "";
    const root = el.getRootNode ? el.getRootNode() : document;
    return ids.split(/\s+/).map((id) => {
      const node = root.getElementById ? root.getElementById(id) : null;
      return node ? U.normalizeText(node.textContent) : "";
    }).join(" ").trim();
  };

  const labelFor = (el) => {
    const id = el.getAttribute("id");
    if (id) {
      const root = el.getRootNode ? el.getRootNode() : document;
      const label = root.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (label) return U.normalizeText(label.textContent);
    }
    const wrapping = el.closest("label");
    return wrapping ? U.normalizeText(wrapping.textContent) : "";
  };

  const CONTENT_NAMED = ["button", "a", "h1", "h2", "h3", "h4", "h5", "h6", "option", "td", "th", "summary"];

  const accessibleName = (el) => {
    const aria = U.attr(el, "aria-label");
    if (aria) return aria;
    const labelledBy = U.attr(el, "aria-labelledby");
    if (labelledBy) {
      const root = el.getRootNode ? el.getRootNode() : document;
      const text = labelledBy.split(/\s+/).map((id) => {
        const node = root.getElementById ? root.getElementById(id) : document.getElementById(id);
        return node ? U.normalizeText(node.textContent) : "";
      }).join(" ").trim();
      if (text) return text;
    }
    const fromLabel = labelFor(el);
    if (fromLabel) return fromLabel;
    if (U.attr(el, "alt")) return U.attr(el, "alt");
    const tag = U.tagOf(el);
    if (tag === "input") {
      const type = (U.attr(el, "type") || "text").toLowerCase();
      if (["button", "submit", "reset"].includes(type) && U.attr(el, "value")) return U.attr(el, "value");
    }
    // Natively content-named elements and custom widgets (role=button etc.)
    // take their name from their contents when nothing earlier applied.
    if (CONTENT_NAMED.includes(tag) || U.attr(el, "role")) {
      const content = U.normalizeText(el.textContent);
      if (content) return content;
    }
    return U.attr(el, "placeholder") || U.attr(el, "title") || "";
  };

  /* Playwright excludes aria-hidden subtrees and closed/hidden widgets. */
  const isAriaHidden = (el) => {
    let node = el;
    while (node) {
      if (node.nodeType === 1 && (node.getAttribute("aria-hidden") || "").toLowerCase() === "true") return true;
      if (node.parentElement) node = node.parentElement;
      else {
        const root = node.getRootNode ? node.getRootNode() : null;
        node = root && root.host ? root.host : null;
      }
    }
    return false;
  };

  const roleEligible = (el) => U.isVisible(el) && !isAriaHidden(el);

  const textMatches = (el, value, exact) => {
    const own = U.normalizeText(el.textContent);
    if (!own) return false;
    const normalized = U.normalizeText(value);
    const wanted = exact ? normalized : normalized.toLowerCase();
    const has = exact ? own === wanted : own.toLowerCase().includes(wanted);
    if (!has) return false;
    for (const child of el.children) {
      const childText = U.normalizeText(child.textContent);
      if (!childText) continue;
      const childHas = exact ? childText === wanted : childText.toLowerCase().includes(wanted);
      if (childHas) return false;
    }
    return true;
  };

  const allElements = (root) => U.deepContentElements(root, []);

  const countRole = (role, name, exact, root) => allElements(root).filter((el) => {
    if (implicitRole(el) !== role) return false;
    if (!roleEligible(el)) return false;
    if (!name) return true;
    const actual = U.normalizeText(accessibleName(el));
    const wanted = exact ? U.normalizeText(name) : U.normalizeText(name).toLowerCase();
    return exact ? actual === wanted : actual.toLowerCase().includes(wanted);
  }).length;

  const countLabel = (value, exact, root) => {
    const wanted = U.normalizeText(value);
    const needle = exact ? wanted : wanted.toLowerCase();
    const seen = new Set();
    const add = (el) => { if (el) seen.add(el); };
    for (const el of allElements(root)) {
      if (U.tagOf(el) === "label") {
        const text = U.normalizeText(el.textContent);
        if (exact ? text === wanted : text.toLowerCase().includes(needle)) {
          const id = el.getAttribute("for");
          if (id) add((el.getRootNode ? el.getRootNode() : document).getElementById(id));
          else add(el.querySelector("input, select, textarea"));
        }
      }
      const aria = U.attr(el, "aria-label");
      if (aria && (exact ? aria === wanted : aria.toLowerCase().includes(needle))) add(el);
      const by = labelledByText(el);
      if (by && (exact ? by === wanted : by.toLowerCase().includes(needle))) add(el);
    }
    return seen.size;
  };

  const countText = (value, exact, root) => allElements(root).filter((el) => textMatches(el, value, exact)).length;

  /* `:has-text` also matches ancestors, unlike getByText's smallest element. */
  const countHasText = (tag, value, root) => {
    const needle = U.normalizeText(value).toLowerCase();
    return allElements(root).filter((el) => {
      if (tag !== "*" && U.tagOf(el) !== tag) return false;
      return U.normalizeText(el.textContent).toLowerCase().includes(needle);
    }).length;
  };

  const countAttr = (name, value, root, exact = false, normalize = true) => {
    const wanted = normalize ? U.normalizeText(value) : String(value == null ? "" : value).trim();
    const needle = exact ? wanted : wanted.toLowerCase();
    return allElements(root).filter((el) => {
      const raw = U.attr(el, name);
      const actual = normalize ? U.normalizeText(raw) : raw;
      return exact ? actual === needle : actual.toLowerCase().includes(needle);
    }).length;
  };

  const testRegex = (regex, text) => {
    regex.lastIndex = 0;
    return regex.test(text);
  };

  const buildRegex = (body, flags) => {
    try { return new RegExp(body.replace(/\\\//g, "/"), flags); } catch (_) { return null; }
  };

  /** Parse a Playwright text argument: `/re/flags`, `'text'`, `"text"` or bare text. */
  const parseTextFilter = (raw) => {
    const value = String(raw == null ? "" : raw).trim();
    if (!value) return null;
    const regex = value.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
    if (regex) {
      const re = buildRegex(regex[1], regex[2]);
      return re ? { regex: re } : null;
    }
    const quoted = value.match(/^(['"])([\s\S]*)\1$/);
    return { text: U.unescapeString(quoted ? quoted[2] : value) };
  };

  const matchesHasText = (el, spec) => {
    if (!spec) return false;
    const text = U.normalizeText(el.textContent);
    if (spec.regex) return testRegex(spec.regex, text);
    return text.toLowerCase().includes(U.normalizeText(spec.text).toLowerCase());
  };

  /* Playwright text engines pick the smallest element that matches. */
  const matchesTextRegexSmallest = (el, regex) => {
    const own = U.normalizeText(el.textContent);
    if (!testRegex(regex, own)) return false;
    for (const child of el.children) {
      if (testRegex(regex, U.normalizeText(child.textContent))) return false;
    }
    return true;
  };

  const countLabelRegex = (regex, root) => {
    const seen = new Set();
    const add = (el) => { if (el) seen.add(el); };
    for (const el of allElements(root)) {
      if (U.tagOf(el) === "label") {
        if (testRegex(regex, U.normalizeText(el.textContent))) {
          const id = el.getAttribute("for");
          if (id) add((el.getRootNode ? el.getRootNode() : document).getElementById(id));
          else add(el.querySelector("input, select, textarea"));
        }
      }
      const aria = U.attr(el, "aria-label");
      if (aria && testRegex(regex, aria)) add(el);
      const by = labelledByText(el);
      if (by && testRegex(regex, by)) add(el);
    }
    return seen.size;
  };

  const countExpr = (expr, root = document) => {
    const modifier = expr.match(/\.(first|last|nth)\((\d*)\)$/);
    if (modifier) {
      const base = expr.slice(0, modifier.index);
      const total = countExpr(base, root);
      if (modifier[1] === "first" || modifier[1] === "last") return total > 0 ? 1 : 0;
      return Number(modifier[2]) < total ? 1 : 0;
    }

    const filterMatch = expr.match(/\.filter\(\s*\{\s*hasText\s*:\s*([^}]+?)\s*\}\s*\)/);
    if (filterMatch && filterMatch.index > 0) {
      const spec = parseTextFilter(filterMatch[1]);
      if (!spec) return 0;
      const baseExpr = expr.slice(0, filterMatch.index);
      const elements = DI.validate && DI.validate.resolve
        ? DI.validate.resolve("playwright", baseExpr).elements
        : [];
      return elements.filter((el) => matchesHasText(el, spec)).length;
    }
    const locatorOption = expr.match(/locator\(\s*(['"])([\s\S]*?)\1\s*,\s*\{\s*hasText\s*:\s*([^}]+?)\s*\}\s*\)\s*$/);
    if (locatorOption) {
      const spec = parseTextFilter(locatorOption[3]);
      if (!spec) return 0;
      try { return U.deepQueryAll(locatorOption[2], root).filter((el) => matchesHasText(el, spec)).length; } catch (_) { return 0; }
    }

    if (/getByRole\(/.test(expr)) {
      const role = expr.match(/getByRole\(\s*['"]((?:\\.|[^'"])+)['"]/);
      const regex = expr.match(/name:\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      const name = expr.match(/name:\s*['"]((?:\\.|[^'"])+)['"]/);
      const exact = /exact:\s*true/.test(expr);
      if (!role) return 0;
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        if (!re) return 0;
        return allElements(root).filter((el) =>
          implicitRole(el) === role[1] && roleEligible(el) &&
          testRegex(re, U.normalizeText(accessibleName(el)))).length;
      }
      return countRole(role[1], name ? U.unescapeString(name[1]) : "", exact, root);
    }
    if (/getByLabel\(/.test(expr)) {
      const regex = expr.match(/getByLabel\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? countLabelRegex(re, root) : 0;
      }
      const m = expr.match(/getByLabel\(\s*['"]((?:\\.|[^'"])+)['"]/);
      return m ? countLabel(U.unescapeString(m[1]), /exact:\s*true/.test(expr), root) : 0;
    }
    if (/getByText\(/.test(expr)) {
      const regex = expr.match(/getByText\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? allElements(root).filter((el) => matchesTextRegexSmallest(el, re)).length : 0;
      }
      const m = expr.match(/getByText\(\s*['"]((?:\\.|[^'"])+)['"]/);
      return m ? countText(U.unescapeString(m[1]), /exact:\s*true/.test(expr), root) : 0;
    }
    if (/getByPlaceholder\(/.test(expr)) {
      const m = expr.match(/getByPlaceholder\(\s*['"]((?:\\.|[^'"])+)['"]/);
      return m ? countAttr("placeholder", U.unescapeString(m[1]), root, /exact:\s*true/.test(expr)) : 0;
    }
    if (/getByAltText\(/.test(expr)) {
      const m = expr.match(/getByAltText\(\s*['"]((?:\\.|[^'"])+)['"]/);
      return m ? countAttr("alt", U.unescapeString(m[1]), root, /exact:\s*true/.test(expr)) : 0;
    }
    if (/getByTitle\(/.test(expr)) {
      const m = expr.match(/getByTitle\(\s*['"]((?:\\.|[^'"])+)['"]/);
      return m ? countAttr("title", U.unescapeString(m[1]), root, /exact:\s*true/.test(expr)) : 0;
    }
    if (/getByTestId\(/.test(expr)) {
      const regex = expr.match(/getByTestId\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? allElements(root).filter((el) => testRegex(re, U.attr(el, "data-testid"))).length : 0;
      }
      const m = expr.match(/getByTestId\(\s*['"]((?:\\.|[^'"])+)['"]/);
      if (!m) return 0;
      return countAttr("data-testid", U.unescapeString(m[1]), root, true, false);
    }

    const cssEngine = expr.match(/locator\(\s*['"]css=([\s\S]*?)['"]\s*\)\s*$/);
    if (cssEngine) {
      try { return U.deepQueryAll(cssEngine[1], root).length; } catch (_) { return 0; }
    }
    const xpathEngine = expr.match(/locator\(\s*['"]xpath=([\s\S]*?)['"]\s*\)\s*$/);
    if (xpathEngine) return DI.xpath.count(xpathEngine[1], root);
    const textEngine = expr.match(/locator\(\s*['"]text=([\s\S]*?)['"]\s*\)\s*$/);
    if (textEngine) {
      const spec = parseTextFilter(textEngine[1]);
      if (!spec) return 0;
      const quoted = /^(['"])[\s\S]*\1$/.test(textEngine[1].trim());
      return allElements(root).filter((el) => (spec.regex
        ? matchesTextRegexSmallest(el, spec.regex)
        : textMatches(el, spec.text, quoted))).length;
    }

    const visibility = expr.match(/locator\(\s*['"]([^'"]*?):(visible|hidden)['"]\s*\)/);
    if (visibility) {
      const base = (visibility[1] || "*").trim() || "*";
      const wantVisible = visibility[2] === "visible";
      return U.deepQueryAll(base, root).filter((el) => U.isVisible(el) === wantVisible).length;
    }
    const engine = expr.match(/locator\(\s*['"]([^'"]*?)(?::has-text|:text-is|:text)\(["']((?:\\.|[^"'])+)["']\)[^'"]*['"]\s*\)/);
    if (engine) {
      const tag = (engine[1] || "").trim() || "*";
      const value = U.unescapeString(engine[2]);
      const mode = expr.includes(":has-text(") ? "has-text"
        : expr.includes(":text-is(") ? "text-is" : "text";
      return allElements(root).filter((el) => {
        if (tag !== "*" && U.tagOf(el) !== tag) return false;
        if (mode === "has-text") {
          const hay = U.normalizeText(el.textContent).toLowerCase();
          return hay.includes(U.normalizeText(value).toLowerCase());
        }
        return textMatches(el, value, mode === "text-is");
      }).length;
    }
    const chained = [...expr.matchAll(/\.locator\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map((m) => m[1]);
    if (chained.length > 1) {
      let nodes = U.deepQueryAll(chained[0], root);
      for (let i = 1; i < chained.length; i += 1) {
        const next = [];
        for (const node of nodes) {
          try {
            const scope = node.shadowRoot || node;
            next.push(...scope.querySelectorAll(chained[i]));
          } catch (_) { /* ignore invalid step */ }
        }
        nodes = next;
      }
      return nodes.length;
    }
    const css = expr.match(/locator\(\s*['"]([^'"]+)['"]\s*\)/);
    if (css && !css[1].startsWith("/") && !css[1].startsWith("(")) {
      try { return U.deepQueryAll(css[1], root).length; } catch (_) { return 0; }
    }
    const xp = expr.match(/locator\(\s*`([^`]+)`\s*\)/) || expr.match(/locator\(\s*['"](\/\/[^'"]+)['"]\s*\)/);
    if (xp) return DI.xpath.count(xp[1], root);
    return 0;
  };

  const framePrefix = (win = window) => {
    const frames = U.iframeChain(win);
    return frames.map((frame) => {
      const id = U.attr(frame, "id");
      if (id) return `frameLocator('#${U.cssEscape(id)}')`;
      const name = U.attr(frame, "name");
      if (name) return `frameLocator('[name="${name.replace(/"/g, '\\"')}"]')`;
      const title = U.attr(frame, "title");
      if (title) return `frameLocator('[title="${title.replace(/"/g, '\\"')}"]')`;
      const src = (U.attr(frame, "src").split("?")[0].split("/").pop() || "");
      if (src) return `frameLocator('[src*="${cssString(src)}"]')`;
      const css = DI.css.best(frame);
      return css && css.count === 1 ? `frameLocator(${quote(css.selector)})` : "frameLocator('iframe')";
    });
  };

  const quote = (value) => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "\\r").replace(/\n/g, "\\n")}'`;
  const cssString = (value) => U.cssAttr(value);

  /* A Playwright locator chain that reaches a shadow-DOM target from the
     document, adding .nth() only where a step is ambiguous in its own root. */
  const shadowLocator = (el, base = "page") => {
    if (!U.isInShadow(el)) return null;
    const hosts = U.shadowHosts(el).slice().reverse();
    const steps = hosts.concat([el]);
    let code = base;
    for (const node of steps) {
      const root = node.getRootNode ? node.getRootNode() : null;
      if (!root) return null;
      const best = DI.css.best(node);
      if (!best || !best.selector) return null;
      let matches;
      try { matches = U.deepQueryAll(best.selector, root); } catch (_) { return null; }
      const index = matches.indexOf(node);
      if (index < 0) return null;
      code += `.locator(${quote(best.selector)})`;
      if (matches.length > 1) code += `.nth(${index})`;
    }
    return code;
  };

  const generate = (el) => {
    const out = [];
    const prefix = framePrefix(el.ownerDocument && el.ownerDocument.defaultView ? el.ownerDocument.defaultView : window);
    const base = prefix.length ? `page.${prefix.join(".")}` : "page";
    // Playwright locators are page/frame scoped: count across the whole
    // document (including open shadow roots), not just the element's root.
    const root = el.ownerDocument || document;
    const stabilityFor = (type) => {
      if (type === "getByTestId") return 100;
      if (type === "getByRole" || type === "getByRole-regex") return 92;
      if (type === "getByLabel") return 90;
      if (type === "getByPlaceholder" || type === "getByAltText" || type === "getByTitle") return 78;
      if (type === "getByText") return 62;
      if (type === "locator+nth") return 20;
      if (type === "locator") return 50;
      return 55;
    };
    const add = (method, code, count, score, type) => {
      if (!code || count <= 0) return;
      const kind = type || method;
      out.push({ type: kind, selector: code, count, score, stability: stabilityFor(kind) });
    };
    const testId = U.attr(el, "data-testid");
    if (testId) add("getByTestId", `${base}.getByTestId(${quote(testId)})`, countAttr("data-testid", testId, root), 1);

    for (const name of ["data-test-id", "data-test", "data-cy"]) {
      const value = U.attr(el, name);
      if (value) add("locator", `${base}.locator('[${name}="${cssString(value)}"]')`, countAttr(name, value, root, true), 3);
    }

    const role = implicitRole(el);
    const name = U.normalizeText(accessibleName(el));
    if (role) {
      if (name && name.length <= 80) {
        add("getByRole", `${base}.getByRole(${quote(role)}, { name: ${quote(name)}, exact: true })`, countRole(role, name, true, root), 2);
        add("getByRole", `${base}.getByRole(${quote(role)}, { name: ${quote(name)} })`, countRole(role, name, false, root), 4);
        const pattern = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        add("getByRole-regex", `${base}.getByRole(${quote(role)}, { name: /${pattern}/i })`, countRole(role, name, false, root), 5);
      }
      add("getByRole", `${base}.getByRole(${quote(role)})`, countRole(role, "", false, root), 30);
    }

    const label = U.attr(el, "aria-label") || labelledByText(el) || labelFor(el);
    if (label && label.length <= 80) {
      add("getByLabel", `${base}.getByLabel(${quote(label)}, { exact: true })`, countLabel(label, true, root), 5);
      add("getByLabel", `${base}.getByLabel(${quote(label)})`, countLabel(label, false, root), 6);
    }
    const placeholder = U.attr(el, "placeholder");
    if (placeholder && placeholder.length <= 80) {
      add("getByPlaceholder", `${base}.getByPlaceholder(${quote(placeholder)}, { exact: true })`, countAttr("placeholder", placeholder, root, true), 7);
      add("getByPlaceholder", `${base}.getByPlaceholder(${quote(placeholder)})`, countAttr("placeholder", placeholder, root, false), 8);
    }
    const text = U.normalizeText(el.textContent);
    if (text && text.length <= 80) {
      const exactMatch = textMatches(el, text, true);
      const looseMatch = textMatches(el, text, false);
      if (exactMatch) add("getByText", `${base}.getByText(${quote(text)}, { exact: true })`, countText(text, true, root), 9);
      if (looseMatch) {
        add("getByText", `${base}.getByText(${quote(text)})`, countText(text, false, root), 10);
        add("locator", `${base}.locator('${U.tagOf(el)}:has-text("${cssString(text)}")')`, countHasText(U.tagOf(el), text, root), 22);
      }
    }
    const alt = U.attr(el, "alt");
    if (alt) {
      add("getByAltText", `${base}.getByAltText(${quote(alt)}, { exact: true })`, countAttr("alt", alt, root, true), 11);
      add("getByAltText", `${base}.getByAltText(${quote(alt)})`, countAttr("alt", alt, root, false), 12);
    }
    const title = U.attr(el, "title");
    if (title) {
      add("getByTitle", `${base}.getByTitle(${quote(title)}, { exact: true })`, countAttr("title", title, root, true), 13);
      add("getByTitle", `${base}.getByTitle(${quote(title)})`, countAttr("title", title, root, false), 14);
    }

    const css = DI.css.best(el);
    if (css && css.count === 1 && U.isInShadow(el)) {
      const chain = shadowLocator(el, base);
      if (chain) add("locator+shadow", chain, 1, 37);
    }
    if (css) {
      let cssCount = css.count;
      try { cssCount = U.deepQueryAll(css.selector, root).length; } catch (_) {}
      add("locator", `${base}.locator(${quote(css.selector)})`, cssCount, 38);
      // `:visible` narrows the CSS matches, so report the visible count, not
      // the unfiltered one (a hidden element has no visible matches).
      let visibleCount = 0;
      try { visibleCount = U.deepQueryAll(css.selector, root).filter((node) => U.isVisible(node)).length; } catch (_) {}
      if (visibleCount > 0) add("locator", `${base}.locator(${quote(css.selector + ":visible")})`, visibleCount, 40);
    }
    const xp = DI.xpath.best(el);
    if (xp) add("locator", `${base}.locator(\`${xp.xpath}\`)`, xp.count, 48);

    // Guarantee at least one exact locator when nothing is unique: nth fallback.
    if (!out.some((item) => item.count === 1)) {
      if (css) {
        const matches = U.deepQueryAll(css.selector, root);
        const index = matches.indexOf(el);
        if (index >= 0) add("locator+nth", `${base}.locator(${quote(css.selector)}).nth(${index})`, 1, 58);
      }
      if (xp) {
        const nodes = DI.xpath.snapshot(xp.xpath, root);
        const index = nodes.indexOf(el) + 1;
        if (index > 0) add("locator+nth", `${base}.locator(\`(${xp.xpath})[${index}]\`)`, 1, 59);
      }
    }

    return out
      .filter((item, index, arr) => arr.findIndex((other) => other.selector === item.selector) === index)
      .sort((a, b) => (a.count === 1 ? 0 : 1) - (b.count === 1 ? 0 : 1) || a.score - b.score || a.count - b.count);
  };

  const best = (el) => generate(el).find((c) => c.count === 1) || generate(el)[0] || null;

  /* Minimal language formatters for the generated JavaScript locator. */
  const toPython = (code) => {
    const loc = code.match(/page\.locator\(\s*[`'"]([\s\S]*?)[`'"]\s*\)$/);
    if (loc) {
      const inner = loc[1].replace(/"/g, '\\"');
      return `page.locator("${inner}")`;
    }
    const role = code.match(/page\.getByRole\(\s*['"]((?:\\.|[^'"])+)['"]\s*(?:,\s*\{([^}]*)\})?\s*\)$/);
    if (role) {
      const name = (role[2] || "").match(/name:\s*['"]((?:\\.|[^'"])+)['"]/);
      const exact = /exact:\s*true/.test(role[2] || "");
      const parts = [`page.get_by_role("${role[1]}"`];
      if (name) parts.push(`name="${name[1]}"`);
      if (exact) parts.push("exact=True");
      return parts.join(", ") + ")";
    }
    const simple = code.match(/page\.(getBy[A-Za-z]+)\(\s*['"]([^'"]+)['"]\s*\)$/);
    if (simple) {
      const method = simple[1].replace(/([A-Z])/g, "_$1").toLowerCase();
      return `page.${method}("${simple[2].replace(/"/g, '\\"')}")`;
    }
    return code.replace(/page\./g, "page.").replace(/([a-z])([A-Z])/g, "$1_$2");
  };
  const toJava = (code) => {
    const role = code.match(/getByRole\(\s*'([^']+)'\s*(?:,\s*\{([^}]*)\})?\s*\)/);
    if (role) {
      const name = (role[2] || "").match(/name:\s*'([^']+)'/);
      const exact = /exact:\s*true/.test(role[2] || "");
      const opts = [];
      if (name) opts.push(`setName("${name[1]}")`);
      if (exact) opts.push("setExact(true)");
      return opts.length
        ? `page.getByRole(AriaRole.${role[1]}, new Page.GetByRoleOptions().${opts.join(".")})`
        : `page.getByRole(AriaRole.${role[1]})`;
    }
    return code
      .replace(/getBy(Text|Label|Placeholder|AltText|Title|TestId)\('([^']+)'\)/g, 'getBy$1("$2")')
      .replace(/locator\('([^']+)'\)/g, 'locator("$1")');
  };
  const toCSharp = (code) => {
    const role = code.match(/getByRole\(\s*'([^']+)'\s*(?:,\s*\{([^}]*)\})?\s*\)/);
    if (role) {
      const name = (role[2] || "").match(/name:\s*'([^']+)'/);
      const exact = /exact:\s*true/.test(role[2] || "");
      const opts = [];
      if (name) opts.push(`Name = "${name[1]}"`);
      if (exact) opts.push("Exact = true");
      return opts.length
        ? `Page.GetByRole(AriaRole.${role[1]}, new Page.GetByRoleOptions { ${opts.join(", ")} })`
        : `Page.GetByRole(AriaRole.${role[1]})`;
    }
    return code
      .replace(/getBy(Text|Label|Placeholder|AltText|Title|TestId)\('([^']+)'\)/g, 'GetBy$1("$2")')
      .replace(/locator\('([^']+)'\)/g, 'Locator("$1")')
      .replace(/^page/, "Page");
  };

  DI.playwright = {
    implicitRole, accessibleName, labelledByText, countExpr, countHasText,
    parseTextFilter, matchesHasText, matchesTextRegexSmallest, buildRegex,
    isAriaHidden, roleEligible, shadowLocator,
    generate, best, framePrefix, toPython, toJava, toCSharp
  };
})();
