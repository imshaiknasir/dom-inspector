/* DOM Inspector — XPath variants: relative, absolute, indexed, text/attribute, axes, SVG. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const { attr, tagOf, isSvgChild, normalizeText, xpathLiteral } = DI.util;

  const snapshot = (xpath, root = document) => {
    try {
      const result = root.evaluate(xpath, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const nodes = [];
      for (let i = 0; i < result.snapshotLength; i += 1) nodes.push(result.snapshotItem(i));
      return nodes;
    } catch (_) {
      return [];
    }
  };

  const count = (xpath, root = document) => snapshot(xpath, root).length;

  const inShadow = (el) => !!el.getRootNode().host;

  const attrPriority = [
    "data-testid", "data-test", "data-cy", "name", "aria-label",
    "placeholder", "title", "alt", "role", "type", "value"
  ];

  const usableValue = (value) => {
    const v = normalizeText(value);
    if (!v || v.length > 60) return "";
    if (/^\d+$/.test(v)) return "";
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v)) return "";
    return v;
  };

  const segment = (el, includeText = true) => {
    const tag = isSvgChild(el) ? "*" : tagOf(el);
    const nameExpr = isSvgChild(el) ? `*[local-name()=${xpathLiteral(tagOf(el))}]` : tag;
    const id = usableValue(attr(el, "id"));
    if (id) return `${nameExpr}[@id=${xpathLiteral(id)}]`;
    for (const name of attrPriority) {
      const value = usableValue(attr(el, name));
      if (value) return `${nameExpr}[@${name}=${xpathLiteral(value)}]`;
    }
    if (includeText) {
      const text = normalizeText(el.textContent);
      if (text && text.length <= 40 && el.children.length === 0) {
        return `${nameExpr}[normalize-space()=${xpathLiteral(text)}]`;
      }
    }
    return nameExpr;
  };

  const absoluteXPath = (el) => {
    if (inShadow(el)) return null;
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
      parts.unshift(`${tag}[${same.indexOf(node) + 1}]`);
      node = parent;
    }
    return "/" + parts.join("/");
  };

  const positionalRelative = (el) => {
    const parts = [];
    let node = el;
    let anchor = "";
    for (let depth = 0; node && depth < 12; depth += 1) {
      const tag = isSvgChild(node) ? "*" : tagOf(node);
      const parent = node.parentElement;
      if (!parent) break;
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      parts.unshift(`${tag}[${same.indexOf(node) + 1}]`);
      const id = usableValue(attr(node, "id"));
      if (id) {
        anchor = `//*[@id=${xpathLiteral(id)}]`;
        break;
      }
      if (tagOf(node) === "body") break;
      node = parent;
    }
    return anchor ? anchor + "/" + parts.join("/") : `//${parts.join("/")}`;
  };

  const candidates = (el) => {
    const out = [];
    const stabilityFor = (strategy) => {
      if (strategy === "id") return 95;
      if (strategy === "id+tag") return 90;
      if (strategy.startsWith("attr:data-test")) return 100;
      if (strategy.startsWith("attr:")) return 80;
      if (strategy.startsWith("contains:")) return 60;
      if (strategy === "class") return 55;
      if (strategy === "text" || strategy === "own-text") return 58;
      if (strategy === "contains-text" || strategy === "starts-with-text") return 42;
      if (strategy === "positional") return 35;
      if (strategy === "absolute") return 15;
      return 50;
    };
    const push = (xpath, strategy, score) => {
      if (!xpath || out.some((c) => c.xpath === xpath)) return;
      out.push({ xpath, count: count(xpath, rootOf(el)), strategy, score, stability: stabilityFor(strategy) });
    };
    const rootOf = (node) => (node.getRootNode ? node.getRootNode() : document);
    if (inShadow(el)) return out;

    const tag = isSvgChild(el) ? "*" : tagOf(el);
    const id = usableValue(attr(el, "id"));
    if (id) {
      push(`//*[@id=${xpathLiteral(id)}]`, "id", 1);
      push(`//${tag}[@id=${xpathLiteral(id)}]`, "id+tag", 3);
    }

    for (const name of attrPriority) {
      const value = usableValue(attr(el, name));
      if (!value) continue;
      push(`//${tag}[@${name}=${xpathLiteral(value)}]`, `attr:${name}`, 10);
      push(`//${tag}[contains(@${name},${xpathLiteral(value)})]`, `contains:${name}`, 28);
    }

    const cls = usableValue(attr(el, "class"));
    if (cls) {
      const first = cls.split(/\s+/).filter(Boolean).slice(0, 2);
      for (const one of first) {
        push(`//${tag}[contains(@class,${xpathLiteral(one)})]`, "class", 30);
      }
    }

    const text = normalizeText(el.textContent);
    if (text && text.length <= 40) {
      push(`//${tag}[normalize-space()=${xpathLiteral(text)}]`, "text", 20);
      push(`//${tag}[contains(normalize-space(.),${xpathLiteral(text)})]`, "contains-text", 34);
      push(`//${tag}[starts-with(normalize-space(.),${xpathLiteral(text)})]`, "starts-with-text", 36);
      const own = normalizeText(Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent).join(""));
      if (own && own !== text) {
        push(`//${tag}[normalize-space(text())=${xpathLiteral(own)}]`, "own-text", 32);
      }
    }

    const positional = positionalRelative(el);
    push(positional, "positional", 50);
    const optimized = optimize(positional);
    if (optimized !== positional) push(optimized, "optimized", 45);
    const abs = absoluteXPath(el);
    if (abs) push(abs, "absolute", 80);
    return out.sort((a, b) => a.score - b.score || a.count - b.count || a.xpath.length - b.xpath.length);
  };

  const best = (el) => candidates(el).find((c) => c.count === 1) || candidates(el)[0] || null;

  const indexed = (el) => {
    if (inShadow(el)) return null;
    const base = best(el);
    if (!base) return null;
    const nodes = snapshot(base.xpath, el.getRootNode ? el.getRootNode() : document);
    const position = nodes.indexOf(el) + 1;
    if (position < 1) return null;
    const xpath = `(${base.xpath})[${position}]`;
    return { xpath, count: count(xpath), position };
  };

  const optimize = (xpath) => {
    if (!xpath || !xpath.startsWith("//")) return xpath;
    const body = xpath.slice(2);
    const parts = body.split("/");
    let out = xpath;
    for (let i = 1; i < parts.length - 1; i += 1) {
      const trial = "//" + parts.filter((_, idx) => idx !== i).join("/");
      if (trial !== xpath && count(trial) === 1) {
        out = trial;
        break;
      }
    }
    return out;
  };

  /** Axes XPath from a reference element to a target element. */
  const axes = (reference, target) => {
    if (inShadow(reference) || inShadow(target)) return [];
    const ref = best(reference);
    if (!ref) return [];
    const targetSeg = segment(target, true);
    const targetText = normalizeText(target.textContent);
    const targetPredicate = targetText && targetText.length <= 30
      ? `[contains(normalize-space(.),${xpathLiteral(targetText)})]`
      : "";

    const rel = reference.compareDocumentPosition(target);
    const isFollowing = !!(rel & Node.DOCUMENT_POSITION_FOLLOWING);
    const isPreceding = !!(rel & Node.DOCUMENT_POSITION_PRECEDING);
    const contains = !!(rel & Node.DOCUMENT_POSITION_CONTAINED_BY);
    const containedBy = !!(rel & Node.DOCUMENT_POSITION_CONTAINS);

    const sameParent = reference.parentElement && reference.parentElement === target.parentElement;
    const out = [];
    const add = (xpath, strategy) => {
      const c = count(xpath);
      if (c > 0) out.push({ xpath, count: c, strategy });
    };

    if (contains) add(`${ref.xpath}/descendant::${targetSeg}${targetPredicate}`, "descendant");
    if (containedBy) add(`${ref.xpath}/ancestor::${targetSeg}${targetPredicate}`, "ancestor");
    if (sameParent && isFollowing) add(`${ref.xpath}/following-sibling::${targetSeg}${targetPredicate}`, "following-sibling");
    if (sameParent && isPreceding) add(`${ref.xpath}/preceding-sibling::${targetSeg}${targetPredicate}`, "preceding-sibling");
    if (isFollowing) add(`${ref.xpath}/following::${targetSeg}${targetPredicate}`, "following");
    if (isPreceding) add(`${ref.xpath}/preceding::${targetSeg}${targetPredicate}`, "preceding");

    let ancestor = reference.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      if (ancestor.contains(target)) {
        add(`//${tagOf(ancestor)}[contains(.,${xpathLiteral(normalizeText(target.textContent).slice(0, 30))})]/descendant::${targetSeg}`, "common-ancestor");
        break;
      }
      ancestor = ancestor.parentElement;
    }

    return out.sort((a, b) => a.count - b.count);
  };

  const frameXPath = (win = window) => {
    const frames = DI.util.iframeChain(win);
    if (!frames.length) return null;
    const parts = frames.map((frame) => {
      const id = usableValue(attr(frame, "id"));
      if (id) return `//iframe[@id=${xpathLiteral(id)}]`;
      const name = usableValue(attr(frame, "name"));
      if (name) return `//iframe[@name=${xpathLiteral(name)}]`;
      const abs = absoluteXPath(frame);
      return abs || `//iframe`;
    });
    return { xpath: parts.join(" >> "), frames: parts.length };
  };

  DI.xpath = {
    snapshot,
    count,
    candidates,
    best,
    absoluteXPath,
    indexed,
    optimize,
    axes,
    frameXPath,
    segment,
    inShadow
  };
})();
