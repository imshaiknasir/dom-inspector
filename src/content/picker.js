/* DOM Inspector — element picker and message bridge. */
(() => {
  const DI = (globalThis.DI = globalThis.DI || {});
  const U = DI.util;

  let active = false;
  let continuous = false;
  let pickMode = "element";
  let reference = null;
  let lastPicked = null;
  let overlay = null;
  let lastTarget = null;

  const ensureOverlay = () => {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement("div");
    overlay.id = "di-picker-overlay";
    overlay.setAttribute("aria-hidden", "true");
    (document.documentElement || document.body).appendChild(overlay);
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
      // Keep the overlay visible on the last pick; the next DI_START resets it.
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mousemove", onMove, true);
      active = false;
    }
  };

  const start = () => {
    if (active) return;
    active = true;
    ensureOverlay().classList.remove("di-picked");
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  };

  const stop = () => {
    active = false;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (overlay) overlay.remove();
    overlay = null;
    lastTarget = null;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return undefined;
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
    if (message.type === "DI_PING") {
      sendResponse({ ok: true, url: location.href, picking: active });
      return true;
    }
    return undefined;
  });

  DI.picker = { start, stop, describe, isActive: () => active };
})();
