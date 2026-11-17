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
    add("name", name, name ? DI.util.countIn(el, `[name="${name.replace(/"/g, '\\"')}"]`) : 0);
    add("className", cls, cls ? DI.util.countIn(el, `.${cls.trim().split(/\s+/).map(U.cssEscape).join(".")}`) : 0);
    add("tagName", tag, DI.util.countIn(el, tag));
    add("linkText", linkText, linkText ? DI.util.countIn(el, "a") : 0);
    add("partialLinkText", linkText ? linkText.slice(0, 24) : "", linkText ? DI.util.countIn(el, "a") : 0);
    add("cssSelector", css, css ? DI.util.countIn(el, css) : 0);
    add("xpath", xp, xp ? DI.xpath.count(xp, el.getRootNode ? el.getRootNode() : document) : 0);

    return out;
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
    return out;
  };

  DI.formats = { generate, formats };
})();
