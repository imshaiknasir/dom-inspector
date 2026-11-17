/* DOM Inspector — Selenium / Cypress / JS / jQuery formats derived from verified CSS & XPath. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  const q = (value) => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

  const generate = (el) => {
    const css = (DI.css.best(el) || {}).selector || "";
    const xp = (DI.xpath.best(el) || {}).xpath || "";
    const id = U.attr(el, "id");
    const name = U.attr(el, "name");
    const cls = U.attr(el, "class");
    const tag = U.tagOf(el);
    const text = U.normalizeText(el.textContent);
    const linkText = tag === "a" ? text : "";
    const out = [];

    const add = (type, value, count) => {
      if (value) out.push({ type, value, count: Number(count) || 0 });
    };

    add("id", id, id ? DI.util.countIn(el, `#${U.cssEscape(id)}`) : 0);
    add("name", name, name ? DI.util.countIn(el, `[name="${U.cssAttr(name)}"]`) : 0);
    add("className", cls, cls ? DI.util.countIn(el, `.${cls.trim().split(/\s+/).map(U.cssEscape).join(".")}`) : 0);
    add("tagName", tag, DI.util.countIn(el, tag));
    const anchors = linkText ? U.deepQueryAll("a", el.getRootNode ? el.getRootNode() : document)
      .filter((a) => U.normalizeText(a.textContent) === linkText) : [];
    const partial = linkText ? linkText.slice(0, 24) : "";
    const partialAnchors = partial ? U.deepQueryAll("a", el.getRootNode ? el.getRootNode() : document)
      .filter((a) => U.normalizeText(a.textContent).includes(partial)) : [];
    add("linkText", linkText, anchors.length);
    add("partialLinkText", partial, partialAnchors.length);
    add("cssSelector", css, css ? DI.util.countIn(el, css) : 0);
    add("xpath", xp, xp ? DI.xpath.count(xp, el.getRootNode ? el.getRootNode() : document) : 0);

    return out;
  };

  const testRigorPath = (el) => {
    let label = U.attr(el, "aria-label") || U.attr(el, "alt");
    const tag = U.tagOf(el);
    if (!label && tag === "input") {
      const type = U.attr(el, "type").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) label = U.attr(el, "value");
    }
    if (!label && ["input", "select", "textarea"].includes(tag)) {
      const id = U.attr(el, "id");
      const root = el.getRootNode ? el.getRootNode() : document;
      const node = id ? root.querySelector(`label[for="${U.cssAttr(id)}"]`) : null;
      if (node) label = U.normalizeText(node.textContent);
      else {
        const wrapping = el.closest ? el.closest("label") : null;
        if (wrapping) label = U.normalizeText(wrapping.textContent);
      }
    }
    label = label || U.attr(el, "placeholder") || U.normalizeText(el.textContent) ||
      U.attr(el, "name") || U.attr(el, "id") || tag;
    const safe = label.slice(0, 80).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      .replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    return `"${safe}"`;
  };

  const formats = (el) => {
    const css = (DI.css.best(el) || {}).selector || "";
    const xp = (DI.xpath.best(el) || {}).xpath || "";
    const out = [];
    if (css) {
      out.push({ type: "cypress-css", code: `cy.get(${q(css)})` });
      out.push({ type: "jquery", code: `$(${q(css)})` });
      out.push({ type: "js", code: `document.querySelector(${q(css)})` });
    }
    if (xp) {
      out.push({ type: "cypress-xpath", code: `cy.xpath(${q(xp)})` });
      out.push({ type: "js-xpath", code: `document.evaluate(${q(xp)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue` });
    }

    out.push({ type: "testRigor", code: testRigorPath(el) });

    const frames = U.iframeChain();
    if (frames.length) {
      const frameCss = frames.map((frame) => {
        const id = U.attr(frame, "id");
        if (id) return `#${U.cssEscape(id)}`;
        const name = U.attr(frame, "name");
        if (name) return `[name="${U.cssAttr(name)}"]`;
        const best = DI.css.best(frame);
        return best && best.selector ? best.selector : "iframe";
      });
      out.push({ type: "selenium-frame", code: frameCss.map((sel) => `driver.switchTo().frame(driver.findElement(By.cssSelector(${q(sel)})))`).join("\n") });
    }

    // shadowChain is innermost-first; both snippet families have to enter the
    // roots from the document, so walk it outermost-first.
    const hosts = DI.css.shadowChain(el).slice().reverse();
    if (hosts.length && css) {
      let code = `cy.get(${q(hosts[0])}).shadow()`;
      for (let i = 1; i < hosts.length; i += 1) {
        code += `.find(${q(hosts[i])}).shadow()`;
      }
      code += `.find(${q(css)})`;
      out.push({ type: "cypress-shadow", code });
    }
    if (hosts.length && css) {
      const lines = hosts.map((hostCss, index) => {
        const source = index === 0 ? "driver" : `root${index}`;
        return `SearchContext root${index + 1} = ${source}.findElement(By.cssSelector(${q(hostCss)})).getShadowRoot();`;
      });
      lines.push(`root${hosts.length}.findElement(By.cssSelector(${q(css)}))`);
      out.push({ type: "selenium-shadow", code: lines.join("\n") });
    }
    return out;
  };

  DI.formats = { generate, formats, testRigorPath };
})();
