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

  const roleLevel = (el) => {
    const explicit = U.attr(el, "aria-level");
    if (/^\d+$/.test(explicit)) return Number(explicit);
    const match = /^h([1-6])$/.exec(U.tagOf(el));
    return match ? Number(match[1]) : null;
  };

  const boolOption = (expr, name) => {
    const match = expr.match(new RegExp(name + ":\\s*(true|false)"));
    return match ? match[1] === "true" : null;
  };

  const roleOptions = (expr) => {
    const level = expr.match(/level:\s*(\d+)/);
    return {
      level: level ? Number(level[1]) : null,
      includeHidden: /includeHidden:\s*true/.test(expr),
      checked: boolOption(expr, "checked"),
      selected: boolOption(expr, "selected"),
      expanded: boolOption(expr, "expanded"),
      disabled: boolOption(expr, "disabled"),
      pressed: boolOption(expr, "pressed")
    };
  };

  /* ARIA state filters for getByRole options ({ checked, selected, ... }). */
  const roleStateMatches = (el, options) => {
    const isDisabled = () => {
      const aria = U.attr(el, "aria-disabled");
      if (aria) return aria === "true";
      try { return !!el.matches(":disabled"); } catch (_) { return false; }
    };
    if (options.disabled != null && isDisabled() !== options.disabled) return false;
    if (options.checked != null) {
      const aria = U.attr(el, "aria-checked");
      const checked = aria ? aria === "true" : !!el.checked;
      if (checked !== options.checked) return false;
    }
    if (options.selected != null) {
      const aria = U.attr(el, "aria-selected");
      const selected = aria ? aria === "true" : !!el.selected;
      if (selected !== options.selected) return false;
    }
    if (options.expanded != null) {
      const aria = U.attr(el, "aria-expanded");
      if (!aria || (aria === "true") !== options.expanded) return false;
    }
    if (options.pressed != null) {
      const aria = U.attr(el, "aria-pressed");
      if (!aria || (aria === "true") !== options.pressed) return false;
    }
    return true;
  };

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

  const CONTENT_NAMED = ["button", "a", "h1", "h2", "h3", "h4", "h5", "h6", "option", "td", "th", "summary", "legend", "caption"];

  /* Name from a labelled descendant such as an icon: img/area alt text,
     svg aria-label or svg > title. Text-only controls reach this fallback. */
  const descendantName = (el) => {
    for (const node of el.querySelectorAll("[aria-label], img[alt], area[alt], svg")) {
      const label = U.attr(node, "aria-label");
      if (label) return label;
      if (node.tagName === "IMG" || node.tagName === "AREA") {
        const alt = U.attr(node, "alt");
        if (alt) return alt;
      }
      if (node.tagName.toLowerCase() === "svg") {
        const title = node.querySelector("title");
        const text = title ? U.normalizeText(title.textContent) : "";
        if (text) return text;
      }
    }
    return "";
  };

  const directChildText = (el, selector) => {
    const node = el.querySelector(selector);
    return node ? U.normalizeText(node.textContent) : "";
  };

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
    if (tag === "fieldset") {
      const legend = directChildText(el, "legend");
      if (legend) return legend;
    }
    if (tag === "table") {
      const caption = directChildText(el, "caption");
      if (caption) return caption;
    }
    if (tag === "figure") {
      const caption = directChildText(el, "figcaption");
      if (caption) return caption;
    }
    // Natively content-named elements and custom widgets (role=button etc.)
    // take their name from their contents when nothing earlier applied.
    if (CONTENT_NAMED.includes(tag) || U.attr(el, "role")) {
      const content = U.normalizeText(el.textContent);
      if (content) return content;
    }
    const icon = descendantName(el);
    if (icon) return icon;
    // Playwright prefers title over placeholder for text inputs.
    return U.attr(el, "title") || U.attr(el, "placeholder") || "";
  };

  /* Playwright's role filters hide aria-hidden subtrees and nodes whose own
     or inherited display/visibility removes them, without requiring a box. */
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

  const isDisplayHidden = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return true;
      if (node.parentElement) node = node.parentElement;
      else {
        const root = node.getRootNode ? node.getRootNode() : null;
        node = root && root.host ? root.host : null;
      }
    }
    return false;
  };

  const roleEligible = (el) => !isAriaHidden(el) && !isDisplayHidden(el);

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

  const countRole = (role, name, exact, root, options = {}) => allElements(root).filter((el) => {
    if (implicitRole(el) !== role) return false;
    if (!options.includeHidden && !roleEligible(el)) return false;
    if (options.level && role === "heading" && roleLevel(el) !== options.level) return false;
    if (!roleStateMatches(el, options)) return false;
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

  /* Read a quoted string argument from `locator(`/`getBy*(` code, honouring
     backslash escapes so the matching delimiter is found correctly. */
  const readQuoted = (source, start) => {
    const quote = source[start];
    if (quote !== "'" && quote !== '"' && quote !== "`") return null;
    let value = "";
    for (let i = start + 1; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "\\") {
        value += ch;
        if (i + 1 < source.length) { i += 1; value += source[i]; }
        continue;
      }
      if (ch === quote) return { raw: value, quote, end: i + 1 };
      value += ch;
    }
    return null;
  };

  const parseLocatorCall = (expr) => {
    const at = expr.lastIndexOf("locator(");
    if (at < 0) return null;
    let i = at + "locator(".length;
    while (i < expr.length && /\s/.test(expr[i])) i += 1;
    const quoted = readQuoted(expr, i);
    if (!quoted) return null;
    return { raw: quoted.raw, arg: U.unescapeString(quoted.raw), quote: quoted.quote, start: i };
  };

  /* First quoted string argument of a `getBy*(` call, decoded once. */
  const callArg = (expr, method) => {
    const at = expr.indexOf(method + "(");
    if (at < 0) return null;
    let i = at + method.length + 1;
    while (i < expr.length && /\s/.test(expr[i])) i += 1;
    const quoted = readQuoted(expr, i);
    return quoted ? { raw: quoted.raw, value: U.unescapeString(quoted.raw) } : null;
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

    const filterMatch = expr.match(/\.filter\(\s*\{\s*(hasText|hasNotText)\s*:\s*([^}]+?)\s*\}\s*\)/);
    if (filterMatch && filterMatch.index > 0) {
      const spec = parseTextFilter(filterMatch[2]);
      if (!spec) return 0;
      const negate = filterMatch[1] === "hasNotText";
      const baseExpr = expr.slice(0, filterMatch.index);
      const elements = DI.validate && DI.validate.resolve
        ? DI.validate.resolve("playwright", baseExpr).elements
        : [];
      return elements.filter((el) => matchesHasText(el, spec) !== negate).length;
    }
    const locatorOption = expr.match(/locator\(\s*(['"])([\s\S]*?)\1\s*,\s*\{\s*(hasText|hasNotText)\s*:\s*([^}]+?)\s*\}\s*\)\s*$/);
    if (locatorOption) {
      const spec = parseTextFilter(locatorOption[4]);
      if (!spec) return 0;
      const negate = locatorOption[3] === "hasNotText";
      try {
        return U.deepQueryAll(locatorOption[2], root).filter((el) => matchesHasText(el, spec) !== negate).length;
      } catch (_) { return 0; }
    }

    if (/getByRole\(/.test(expr)) {
      const roleCall = callArg(expr, "getByRole");
      const role = roleCall ? [null, roleCall.value] : null;
      const regex = expr.match(/name:\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      const name = expr.match(/name:\s*['"]((?:\\.|[^'"])+)['"]/);
      const exact = /exact:\s*true/.test(expr);
      const options = roleOptions(expr);
      if (!role) return 0;
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        if (!re) return 0;
        return allElements(root).filter((el) =>
          implicitRole(el) === role[1] &&
          (options.includeHidden || roleEligible(el)) &&
          (!options.level || role[1] !== "heading" || roleLevel(el) === options.level) &&
          roleStateMatches(el, options) &&
          testRegex(re, U.normalizeText(accessibleName(el)))).length;
      }
      return countRole(role[1], name ? U.unescapeString(name[1]) : "", exact, root, options);
    }
    if (/getByLabel\(/.test(expr)) {
      const regex = expr.match(/getByLabel\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? countLabelRegex(re, root) : 0;
      }
      const m = callArg(expr, "getByLabel");
      return m ? countLabel(m.value, /exact:\s*true/.test(expr), root) : 0;
    }
    if (/getByText\(/.test(expr)) {
      const regex = expr.match(/getByText\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? allElements(root).filter((el) => matchesTextRegexSmallest(el, re)).length : 0;
      }
      const m = callArg(expr, "getByText");
      return m ? countText(m.value, /exact:\s*true/.test(expr), root) : 0;
    }
    if (/getByPlaceholder\(/.test(expr)) {
      const regex = expr.match(/getByPlaceholder\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? allElements(root).filter((el) => testRegex(re, U.attr(el, "placeholder"))).length : 0;
      }
      const m = callArg(expr, "getByPlaceholder");
      return m ? countAttr("placeholder", m.value, root, /exact:\s*true/.test(expr)) : 0;
    }
    if (/getByAltText\(/.test(expr)) {
      const regex = expr.match(/getByAltText\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? allElements(root).filter((el) => testRegex(re, U.attr(el, "alt"))).length : 0;
      }
      const m = callArg(expr, "getByAltText");
      return m ? countAttr("alt", m.value, root, /exact:\s*true/.test(expr)) : 0;
    }
    if (/getByTitle\(/.test(expr)) {
      const regex = expr.match(/getByTitle\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? allElements(root).filter((el) => testRegex(re, U.attr(el, "title"))).length : 0;
      }
      const m = callArg(expr, "getByTitle");
      return m ? countAttr("title", m.value, root, /exact:\s*true/.test(expr)) : 0;
    }
    if (/getByTestId\(/.test(expr)) {
      const regex = expr.match(/getByTestId\(\s*\/((?:\\.|[^/])+)\/([gimsuy]*)/);
      if (regex) {
        const re = buildRegex(regex[1], regex[2]);
        return re ? allElements(root).filter((el) => testRegex(re, U.attr(el, "data-testid"))).length : 0;
      }
      const m = callArg(expr, "getByTestId");
      if (!m) return 0;
      return countAttr("data-testid", m.value, root, true, false);
    }

    const chainedLocators = [...expr.matchAll(/\.locator\(\s*(['"`])([\s\S]*?)\1\s*\)/g)]
      .map((match) => U.unescapeString(match[2]));
    if (chainedLocators.length > 1) {
      let nodes = U.deepQueryAll(chainedLocators[0], root);
      for (let i = 1; i < chainedLocators.length; i += 1) {
        const next = [];
        for (const node of nodes) {
          try {
            const scope = node.shadowRoot || node;
            next.push(...scope.querySelectorAll(chainedLocators[i]));
          } catch (_) { /* ignore invalid step */ }
        }
        nodes = next;
      }
      return nodes.length;
    }
    const call = parseLocatorCall(expr);
    if (!call) return 0;
    const arg = call.arg;
    const engine = arg.match(/^(.*?):(has-text|text-is|text)\(\s*(['"])([\s\S]*)\3\s*\)\s*$/);
    if (engine) {
      const tag = (engine[1] || "").trim() || "*";
      const mode = engine[2];
      const value = U.unescapeString(engine[4]);
      return allElements(root).filter((el) => {
        if (tag !== "*" && U.tagOf(el) !== tag) return false;
        if (mode === "has-text") {
          return U.normalizeText(el.textContent).toLowerCase().includes(U.normalizeText(value).toLowerCase());
        }
        return textMatches(el, value, mode === "text-is");
      }).length;
    }
    const visibility = arg.match(/^(.*?):(visible|hidden)$/);
    if (visibility) {
      const base = (visibility[1] || "*").trim() || "*";
      const wantVisible = visibility[2] === "visible";
      try { return U.deepQueryAll(base, root).filter((el) => U.isVisible(el) === wantVisible).length; } catch (_) { return 0; }
    }
    if (arg.startsWith("css=")) {
      try { return U.deepQueryAll(arg.slice(4), root).length; } catch (_) { return 0; }
    }
    if (arg.startsWith("xpath=")) return DI.xpath.count(arg.slice(6), root);
    if (arg.startsWith("text=")) {
      const raw = arg.slice(5);
      const spec = parseTextFilter(raw);
      if (!spec) return 0;
      const quoted = /^(['"])[\s\S]*\1$/.test(raw.trim());
      return allElements(root).filter((el) => (spec.regex
        ? matchesTextRegexSmallest(el, spec.regex)
        : textMatches(el, spec.text, quoted))).length;
    }
    if (arg.startsWith("//") || arg.startsWith("(")) return DI.xpath.count(arg, root);
    try { return U.deepQueryAll(arg, root).length; } catch (_) { return 0; }
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
      if (role === "heading") {
        const level = roleLevel(el);
        if (level) {
          const options = [`level: ${level}`];
          if (name && name.length <= 80) options.unshift(`name: ${quote(name)}`);
          add("getByRole-level", `${base}.getByRole('heading', { ${options.join(", ")} })`,
            countRole("heading", name && name.length <= 80 ? name : "", false, root, { level }), 3);
        }
      }
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
        const hasText = `${U.tagOf(el)}:has-text("${cssString(text)}")`;
        add("locator", `${base}.locator(${quote(hasText)})`, countHasText(U.tagOf(el), text, root), 22);
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
    isAriaHidden, roleEligible, roleLevel, roleOptions, roleStateMatches, shadowLocator, parseLocatorCall, callArg,
    generate, best, framePrefix, toPython, toJava, toCSharp
  };
})();
