/* DOM Inspector — CSS selector generation with ranked, verified candidates. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const { cssEscape, attr, countIn, rootOf, tagOf, isSvg, normalizeText } = DI.util;

  const ATTR_PRIORITY = [
    ["data-testid", 2],
    ["data-test-id", 3],
    ["data-test", 3],
    ["data-cy", 3],
    ["name", 12],
    ["aria-label", 14],
    ["placeholder", 18],
    ["alt", 22],
    ["title", 24],
    ["role", 28],
    ["type", 30]
  ];

  const looksGenerated = (value) => {
    const v = String(value).trim();
    if (!v || v.length > 48) return true;
    if (/^\d+$/.test(v)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v)) return true;
    if (/^[a-f0-9]{12,}$/i.test(v) && /\d/.test(v)) return true;
    if (/^(css|sc|jsx|emotion)-?[a-z0-9]{5,}$/i.test(v)) return true;
    if (/(^|[-_])[a-z0-9]{6,}$/i.test(v) && /\d/.test(v) && /[a-z]/i.test(v)) return true;
    return false;
  };

  const attrValue = (value) => DI.util.cssAttr(value);

  const classList = (el) => String(el.getAttribute("class") || "")
    .split(/\s+/)
    .map((c) => c.trim())
    .filter((c) => c && !looksGenerated(c));

  const nthSegment = (el) => {
    const tag = tagOf(el);
    const parent = el.parentElement;
    if (!parent) return tag;
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (sameTag.length <= 1) return tag;
    return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
  };

  const stabilityFor = (strategy) => {
    if (strategy === "id") return 95;
    if (strategy === "id+tag") return 90;
    if (strategy.startsWith("attr:data-test")) return 100;
    if (strategy.startsWith("attr:")) return 80;
    if (strategy === "parent-id") return 75;
    if (strategy === "class") return 62;
    if (strategy === "tag+class" || strategy === "classes") return 58;
    if (strategy === "path") return 38;
    if (strategy === "absolute") return 18;
    return 50;
  };

  const pushCandidate = (list, seen, selector, strategy, score, el) => {
    if (!selector || seen.has(selector)) return;
    seen.add(selector);
    const scope = rootOf(el);
    let count = countIn(el, selector);
    let selectsTarget = false;
    try { selectsTarget = scope.querySelector(selector) === el; } catch (_) { selectsTarget = false; }
    if (!selectsTarget) count = 0;
    list.push({ selector, count, selectsTarget, strategy, score, stability: stabilityFor(strategy) });
  };

  const ancestorPath = (el, maxDepth = 7) => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && depth < maxDepth; depth += 1) {
      parts.unshift(nthSegment(node));
      const id = attr(node, "id");
      if (id && !looksGenerated(id)) {
        parts[0] = `${tagOf(node)}#${cssEscape(id)}`;
        break;
      }
      if (tagOf(node) === "body") break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  const absolutePath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const tag = tagOf(node);
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
      node = parent;
    }
    return parts.join(" > ");
  };

  const candidates = (el) => {
    const list = [];
    const seen = new Set();
    const tag = tagOf(el);
    const id = attr(el, "id");

    if (id && !looksGenerated(id)) {
      pushCandidate(list, seen, `#${cssEscape(id)}`, "id", 1, el);
      pushCandidate(list, seen, `${tag}#${cssEscape(id)}`, "id+tag", 4, el);
    }

    for (const [name, score] of ATTR_PRIORITY) {
      const value = attr(el, name);
      if (!value || looksGenerated(value)) continue;
      pushCandidate(list, seen, `${tag}[${name}="${attrValue(value)}"]`, `attr:${name}`, score, el);
      if (name.startsWith("data-test") || name === "data-cy") {
        pushCandidate(list, seen, `[${name}="${attrValue(value)}"]`, `attr:${name}`, score + 1, el);
      }
    }

    const classes = classList(el);
    for (const cls of classes.slice(0, 4)) {
      pushCandidate(list, seen, `.${cssEscape(cls)}`, "class", 32, el);
      pushCandidate(list, seen, `${tag}.${cssEscape(cls)}`, "tag+class", 34, el);
    }
    if (classes.length > 1) {
      const combo = classes.map((c) => `.${cssEscape(c)}`).join("");
      pushCandidate(list, seen, `${tag}${combo}`, "classes", 36, el);
    }

    const parent = el.parentElement;
    if (parent) {
      const parentId = attr(parent, "id");
      if (parentId && !looksGenerated(parentId)) {
        pushCandidate(list, seen, `#${cssEscape(parentId)} > ${nthSegment(el)}`, "parent-id", 44, el);
      }
    }

    pushCandidate(list, seen, ancestorPath(el), "path", 60, el);
    pushCandidate(list, seen, absolutePath(el), "absolute", 80, el);

    return list.sort((a, b) => a.score - b.score || a.count - b.count || a.selector.length - b.selector.length);
  };

  const best = (el) => {
    const all = candidates(el);
    return all.find((c) => c.count === 1) || all[0] || null;
  };

  DI.css = {
    looksGenerated,
    candidates,
    best,
    absolutePath,
    ancestorPath,
    /** CSS chain for each open shadow host, outermost last. */
    shadowChain(el) {
      return DI.util.shadowHosts(el).map((host) => {
        const c = best(host);
        return c ? c.selector : null;
      }).filter(Boolean);
    }
  };
})();
