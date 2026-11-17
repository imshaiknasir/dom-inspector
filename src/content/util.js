/* DOM Inspector — shared DOM utilities (content script, isolated world). */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});

  const cssEscape = (value) => {
    const s = String(value);
    if (globalThis.CSS && typeof CSS.escape === "function") return CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, (ch) => "\\" + ch);
  };

  const xpathLiteral = (value) => {
    const s = String(value);
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    return "concat(" + s.split('"').map((part, i, arr) =>
      `"${part}"` + (i < arr.length - 1 ? `,'"',` : "")
    ).join("") + ")";
  };

  const unescapeString = (value) => String(value == null ? "" : value)
    .replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\\'"`bfnrtv0])/g, (match, code) => {
      if (code === "n") return "\n";
      if (code === "r") return "\r";
      if (code === "t") return "\t";
      if (code === "b") return "\b";
      if (code === "f") return "\f";
      if (code === "v") return "\v";
      if (code === "0") return "\0";
      if (code[0] === "x") return String.fromCharCode(parseInt(code.slice(1), 16));
      if (code[0] === "u") return String.fromCharCode(parseInt(code.slice(1), 16));
      return code;
    });

  const normalizeText = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();

  const directText = (el) => {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.textContent;
    }
    return normalizeText(out);
  };

  const attr = (el, name) => {
    const v = el.getAttribute && el.getAttribute(name);
    return v == null ? "" : String(v).trim();
  };

  const isSvg = (el) => el.namespaceURI === "http://www.w3.org/2000/svg";
  const isSvgChild = (el) => {
    let node = el;
    for (let i = 0; i < 8 && node; i += 1) {
      if (isSvg(node)) return true;
      node = node.parentElement;
    }
    return false;
  };

  const rootOf = (el) => {
    const root = el.getRootNode ? el.getRootNode() : document;
    return root && root.querySelectorAll ? root : document;
  };

  const countIn = (el, selector) => {
    try {
      return rootOf(el).querySelectorAll(selector).length;
    } catch (_) {
      return 0;
    }
  };

  const deepQueryAll = (selector, root = document) => {
    const out = [];
    try {
      out.push(...root.querySelectorAll(selector));
    } catch (_) {
      return out;
    }
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot) out.push(...deepQueryAll(selector, node.shadowRoot));
    }
    return out;
  };

  const deepEveryElement = (root = document, out = []) => {
    for (const node of root.querySelectorAll("*")) {
      out.push(node);
      if (node.shadowRoot) deepEveryElement(node.shadowRoot, out);
    }
    return out;
  };

  const isInShadow = (el) => {
    const root = el.getRootNode ? el.getRootNode() : null;
    return !!(root && root.host);
  };

  const shadowHosts = (el) => {
    const hosts = [];
    let node = el;
    while (node) {
      const root = node.getRootNode ? node.getRootNode() : null;
      if (root && root.host) {
        hosts.push(root.host);
        node = root.host;
      } else {
        node = null;
      }
    }
    return hosts;
  };

  const iframeChain = (win = window) => {
    const frames = [];
    let current = win;
    while (current && current !== current.top) {
      let frame = null;
      try {
        frame = current.frameElement;
      } catch (_) {
        break;
      }
      if (!frame) break;
      frames.push(frame);
      current = frame.ownerDocument.defaultView;
    }
    return frames.reverse();
  };

  const isVisible = (el) => {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return el.getClientRects().length > 0;
  };

  const tagOf = (el) => (el.tagName || "").toLowerCase();

  DI.util = {
    cssEscape,
    unescapeString,
    xpathLiteral,
    normalizeText,
    directText,
    attr,
    isSvg,
    isSvgChild,
    rootOf,
    countIn,
    deepQueryAll,
    deepEveryElement,
    isInShadow,
    shadowHosts,
    iframeChain,
    isVisible,
    tagOf
  };
})();
