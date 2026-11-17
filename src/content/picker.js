/* DOM Inspector — element picker and message bridge. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  let active = false;
  let continuous = false;
  let pickMode = "element";
  let reference = null;
  let lastPicked = null;
  let contextTarget = null;
  let overlay = null;
  let lastTarget = null;

  const ensureOverlay = () => {
    if (overlay) {
      const parent = document.documentElement || document.body;
      if (overlay.isConnected) return overlay;
      if (parent) {
        parent.appendChild(overlay);
        return overlay;
      }
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.id = "di-picker-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const parent = document.documentElement || document.body;
    if (parent) parent.appendChild(overlay);
    return overlay;
  };

  const targetFromEvent = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const node = path.find((item) => item && item.nodeType === 1);
    return node || event.target;
  };

  const paint = (el) => {
    if (!el || el === overlay) return;
    const rect = el.getBoundingClientRect();
    const node = ensureOverlay();
    node.style.width = `${Math.max(rect.width, 1)}px`;
    node.style.height = `${Math.max(rect.height, 1)}px`;
    node.style.transform = `translate(${rect.left + window.scrollX}px, ${rect.top + window.scrollY}px)`;
    node.dataset.tag = U.tagOf(el);
    lastTarget = el;
  };

  const onMove = (event) => {
    if (!active) return;
    const el = targetFromEvent(event);
    if (!el || el === overlay) return;
    if (overlay) overlay.classList.remove("di-picked");
    paint(el);
  };

  const onClick = (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const el = targetFromEvent(event);
    if (!el || el === overlay) return;
    pick(el);
  };

  const onContext = (event) => {
    const el = targetFromEvent(event);
    if (el && el.nodeType === 1) contextTarget = el;
  };

  document.addEventListener("contextmenu", onContext, true);

  const onKey = (event) => {
    if (event.key === "Escape" && active) stop();
  };

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch (error) {
      return fallback === undefined ? { error: error.message } : fallback;
    }
  };

  const describe = (el) => {
    const css = safe(() => DI.css.candidates(el), []);
    const xp = safe(() => DI.xpath.candidates(el), []);
    const playwright = safe(() => DI.playwright.generate(el), []);
    const formats = safe(() => DI.formats.formats(el), []);
    const selenium = safe(() => DI.formats.generate(el), []);
    const indexed = safe(() => DI.xpath.indexed(el), null);

    return {
      url: location.href,
      frame: {
        depth: U.iframeChain().length,
        chain: U.iframeChain().map((frame) => ({ tag: U.tagOf(frame), id: U.attr(frame, "id"), name: U.attr(frame, "name"), src: U.attr(frame, "src").slice(0, 200) })),
        crossOrigin: window.top !== window.self && U.iframeChain().length === 0,
        xpath: safe(() => DI.xpath.frameXPath(), null)
      },
      shadow: {
        inShadow: U.isInShadow(el),
        hosts: U.shadowHosts(el).map((host) => ({ tag: U.tagOf(host), id: U.attr(host, "id") })),
        hostCss: safe(() => DI.css.shadowChain(el), [])
      },
      element: {
        tag: U.tagOf(el),
        id: U.attr(el, "id"),
        classes: U.attr(el, "class"),
        name: U.attr(el, "name"),
        role: safe(() => DI.playwright.implicitRole(el), null),
        accessibleName: safe(() => DI.playwright.accessibleName(el), ""),
        text: U.normalizeText(el.textContent).slice(0, 200),
        visible: U.isVisible(el)
      },
      css: { best: css.find((c) => c.count === 1) || css[0] || null, candidates: css.slice(0, 12) },
      xpath: {
        best: xp.find((c) => c.count === 1) || xp[0] || null,
        candidates: xp.slice(0, 12),
        absolute: safe(() => DI.xpath.absoluteXPath(el), null),
        indexed
      },
      playwright: playwright.slice(0, 16),
      selenium,
      formats,
      axes: reference && reference.isConnected
        ? safe(() => DI.xpath.axes(reference, el), [])
        : [],
      reference: reference && reference.isConnected
        ? { tag: U.tagOf(reference), id: U.attr(reference, "id"), text: U.normalizeText(reference.textContent).slice(0, 80) }
        : null
    };
  };

  const pick = (el) => {
    if (pickMode === "reference") {
      reference = el;
      paint(el);
      try {
        chrome.runtime.sendMessage({
          type: "DI_REFERENCE",
          payload: { tag: U.tagOf(el), id: U.attr(el, "id"), text: U.normalizeText(el.textContent).slice(0, 120) }
        });
      } catch (_) {}
      pickMode = "element";
      if (!continuous) stop();
      return;
    }
    if (!reference && lastPicked && lastPicked.isConnected) reference = lastPicked;
    const payload = describe(el);
    lastPicked = el;
    try {
      chrome.runtime.sendMessage({ type: "DI_ELEMENT", payload });
    } catch (_) {}
    paint(el);
    setTimeout(() => {
      if (overlay) overlay.classList.add("di-picked");
    }, 0);
    if (!continuous) {
      // Keep the overlay (and Escape handling) visible on the last pick; the
      // next DI_START resets it.
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mousemove", onMove, true);
      active = false;
    }
  };

  const detach = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  };

  const start = () => {
    // Always detach first so a restarted picker never stacks listeners (for
    // example after a non-continuous pick leaves the Escape handler active).
    detach();
    active = true;
    ensureOverlay().classList.remove("di-picked");
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  };

  const stop = () => {
    active = false;
    detach();
    if (overlay) overlay.remove();
    overlay = null;
    lastTarget = null;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return undefined;
    // Validation/repair is answered by the top frame, which also searches
    // same-origin child frames. This prevents a child frame from winning the
    // response race when the panel did not address a specific frame.
    if ((message.type === "DI_TEST" || message.type === "DI_FIX") &&
        window.top !== window.self && !message.allowFrames) {
      return undefined;
    }
    if (message.type === "DI_START") {
      continuous = !!message.continuous;
      pickMode = message.mode === "reference" ? "reference" : "element";
      start();
      sendResponse({ ok: true, frame: location.href });
      return true;
    }
    if (message.type === "DI_STOP") {
      stop();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "DI_TEST") {
      const result = DI.validate.test(message.locatorType || "auto", message.value || "");
      if (message.highlight) DI.validate.highlight(result.elements);
      sendResponse({ ok: result.ok, type: result.type, count: result.count, error: result.error });
      return true;
    }
    if (message.type === "DI_CLEAR") {
      DI.validate.clearHighlight();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "DI_CLEAR_REFERENCE") {
      reference = null;
      lastPicked = null;
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === "DI_COPY_BEST") {
      const el = contextTarget && contextTarget.isConnected ? contextTarget : null;
      if (!el) {
        sendResponse({ ok: false, error: "No context element recorded" });
        return true;
      }
      const css = safe(() => DI.css.best(el), null);
      const xp = safe(() => DI.xpath.best(el), null);
      const needsContext = U.isInShadow(el) || U.iframeChain().length > 0;
      const pw = needsContext
        ? (safe(() => DI.playwright.generate(el), []) || []).find((item) => item.count === 1)
        : null;
      // A frame/shadow element's scoped CSS is not usable from the page, so
      // fall back to a Playwright chain instead of handing back a dead value.
      const contextual = () => {
        if (!needsContext) return "";
        const prefix = safe(() => DI.playwright.framePrefix(), []) || [];
        const base = prefix.length ? `page.${prefix.join(".")}` : "page";
        if (U.isInShadow(el)) {
          const chain = safe(() => DI.playwright.shadowLocator(el, base), null);
          if (chain) return chain;
        }
        const jsString = (value) => JSON.stringify(String(value));
        if (css && css.selector) {
          const nodes = safe(() => U.deepQueryAll(css.selector, U.rootOf(el)), []) || [];
          const index = nodes.indexOf(el);
          if (index >= 0) {
            return `${base}.locator(${jsString(css.selector)})` + (nodes.length > 1 ? `.nth(${index})` : "");
          }
        }
        if (xp && xp.xpath) return `${base}.locator(\`${xp.xpath}\`)`;
        return "";
      };
      const value = pw ? pw.selector
        : contextual()
          || (css && css.count === 1 ? css.selector : "")
          || (xp && xp.count === 1 ? xp.xpath : "")
          || (css && css.selector) || (xp && xp.xpath) || "";
      if (!value) {
        sendResponse({ ok: false, error: "No locator generated" });
        return true;
      }
      const done = () => sendResponse({ ok: true, value });
      try {
        navigator.clipboard.writeText(value).then(done, () => {
          const area = document.createElement("textarea");
          area.value = value;
          document.body.appendChild(area);
          area.select();
          const copied = document.execCommand("copy");
          area.remove();
          sendResponse(copied ? { ok: true, value } : { ok: false, error: "Clipboard unavailable" });
        });
      } catch (_) {
        sendResponse({ ok: false, error: "Clipboard unavailable" });
      }
      return true;
    }
    if (message.type === "DI_FIX") {
      if (!DI.repair) {
        sendResponse({ ok: false, error: "repair unavailable" });
        return true;
      }
      if (Array.isArray(message.values)) {
        sendResponse({ ok: true, results: DI.repair.fixMany(message.values) });
      } else {
        sendResponse(DI.repair.fix(message.value));
      }
      return true;
    }
    if (message.type === "DI_PING") {
      sendResponse({ ok: true, url: location.href, picking: active });
      return true;
    }
    return undefined;
  });

  DI.picker = { start, stop, describe, isActive: () => active };
})();
