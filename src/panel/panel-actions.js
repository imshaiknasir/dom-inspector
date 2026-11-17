/* DOM Inspector — locator action runner injected with chrome.scripting.
 *
 * pageAction must stay self-contained: Chrome serializes this function and
 * evaluates it in the inspected frame. It never references anything outside
 * its own body.
 */
(() => {
  "use strict";
  const DI = (globalThis.DIPanel = globalThis.DIPanel || {});

  const pageAction = (kind, type, rawValue, text, perform) => {
    const result = {
      matched: 0,
      tag: "",
      text: "",
      typable: false,
      performed: false,
      error: null,
      url: location.href
    };

    try {
      const value = String(rawValue || "").trim();
      const wanted = type === "auto"
        ? (/^page\.|^getBy/.test(value) ? "playwright"
          : /^\/\/|^\(\/|^\.\/|^\(/.test(value) ? "xpath" : "css")
        : type;

      const roots = [];
      const seenDocs = new Set();
      const walk = (root) => {
        if (!root || roots.indexOf(root) !== -1) return;
        roots.push(root);
        let nodes;
        try { nodes = root.querySelectorAll("*"); } catch (_) { return; }
        for (let i = 0; i < nodes.length; i += 1) {
          const node = nodes[i];
          if (node.shadowRoot) walk(node.shadowRoot);
          if (node.tagName === "IFRAME" || node.tagName === "FRAME") {
            let doc = null;
            try { doc = node.contentDocument; } catch (_) { /* cross-origin */ }
            if (doc && !seenDocs.has(doc)) {
              seenDocs.add(doc);
              walk(doc);
            }
          }
        }
      };
      seenDocs.add(document);
      walk(document);

      const norm = (input) => String(input == null ? "" : input).replace(/\s+/g, " ").trim();
      const attr = (node, name) => (node.getAttribute && node.getAttribute(name)) || "";
      const tagOf = (node) => (node.tagName || "").toLowerCase();
      const allElements = () => {
        const list = [];
        const seen = new Set();
        for (const root of roots) {
          let nodes;
          try { nodes = root.querySelectorAll("*"); } catch (_) { continue; }
          for (const node of nodes) {
            if (!seen.has(node)) {
              seen.add(node);
              list.push(node);
            }
          }
        }
        return list;
      };

      const implicitRole = (node) => {
        const explicit = (attr(node, "role") || "").split(/\s+/)[0];
        if (explicit) return explicit;
        const tag = tagOf(node);
        if (tag === "a" || tag === "area") return node.hasAttribute("href") ? "link" : null;
        if (tag === "button") return "button";
        if (tag === "input") {
          const inputType = (attr(node, "type") || "text").toLowerCase();
          if (["button", "submit", "reset", "image"].includes(inputType)) return "button";
          if (inputType === "checkbox") return "checkbox";
          if (inputType === "radio") return "radio";
          if (inputType === "range") return "slider";
          if (inputType === "number") return "spinbutton";
          if (inputType === "search") return "searchbox";
          return "textbox";
        }
        const map = {
          select: "combobox", textarea: "textbox", img: "img",
          h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
          ul: "list", ol: "list", li: "listitem", table: "table", tr: "row", td: "cell",
          th: "columnheader", nav: "navigation", main: "main", article: "article",
          form: "form", dialog: "dialog", section: "region"
        };
        return map[tag] || null;
      };

      const labelFor = (node) => {
        const id = attr(node, "id");
        if (id) {
          const root = node.getRootNode ? node.getRootNode() : document;
          let label = null;
          try {
            label = root.querySelector
              ? root.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]')
              : null;
          } catch (_) { label = null; }
          if (label) return norm(label.textContent);
        }
        const wrapping = node.closest ? node.closest("label") : null;
        return wrapping ? norm(wrapping.textContent) : "";
      };

      const accessibleName = (node) => {
        const aria = attr(node, "aria-label");
        if (aria) return aria;
        const labelledBy = attr(node, "aria-labelledby");
        if (labelledBy) {
          const root = node.getRootNode ? node.getRootNode() : document;
          const name = labelledBy.split(/\s+/).map((id) => {
            const target = root.getElementById ? root.getElementById(id) : null;
            return target ? norm(target.textContent) : "";
          }).join(" ").trim();
          if (name) return name;
        }
        const fromLabel = labelFor(node);
        if (fromLabel) return fromLabel;
        if (attr(node, "alt")) return attr(node, "alt");
        if (["button", "a", "option", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tagOf(node))) {
          return norm(node.textContent);
        }
        return attr(node, "placeholder") || attr(node, "title") || "";
      };

      const textMatches = (node, needle, exact) => {
        const own = norm(node.textContent);
        if (!own) return false;
        if (exact ? own !== needle : !own.includes(needle)) return false;
        for (const child of node.children) {
          const childText = norm(child.textContent);
          if (childText && (exact ? childText === needle : childText.includes(needle))) return false;
        }
        return true;
      };

      const readFirstString = (args) => {
        const start = args.search(/['"`]/);
        if (start < 0) return null;
        const quote = args[start];
        let out = "";
        let i = start + 1;
        while (i < args.length) {
          const ch = args[i];
          if (ch === "\\") {
            out += args[i + 1] || "";
            i += 2;
            continue;
          }
          if (ch === quote) return { value: out, end: i + 1 };
          out += ch;
          i += 1;
        }
        return null;
      };

      let matches = [];
      if (wanted === "css") {
        for (const root of roots) {
          try { matches.push(...root.querySelectorAll(value)); } catch (_) { /* invalid */ }
        }
      } else if (wanted === "xpath") {
        const seen = new Set();
        for (const root of roots) {
          const doc = root.ownerDocument || root;
          try {
            const snapshot = doc.evaluate(value, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < snapshot.snapshotLength; i += 1) {
              const node = snapshot.snapshotItem(i);
              if (node && !seen.has(node)) {
                seen.add(node);
                matches.push(node);
              }
            }
          } catch (_) { /* invalid xpath */ }
        }
      } else {
        let expression = value.replace(/^page\./, "");
        expression = expression.replace(
          /^(?:frameLocator\((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\)\.)+/,
          ""
        );

        let nth = null;
        const nthMatch = expression.match(/\.nth\((\d+)\)\s*$/);
        if (nthMatch) {
          nth = Number(nthMatch[1]);
          expression = expression.slice(0, nthMatch.index);
        }

        const call = expression.match(/getBy(Role|Text|Label|Placeholder|AltText|Title|TestId)\((.*)\)\s*$/);
        const locator = !call && expression.match(/locator\((.*)\)\s*$/);

        if (call) {
          const method = call[1];
          const args = call[2];
          const first = readFirstString(args);
          const firstValue = first ? first.value : "";
          const rest = first ? args.slice(first.end) : "";
          const exact = /exact:\s*true/.test(rest);
          let namePattern = null;
          let nameValue = "";

          const nameString = rest.match(/name:\s*'((?:\\.|[^'\\])*)'/);
          const nameRegex = rest.match(/name:\s*\/((?:\\.|[^/\\])*)\/([a-z]*)/);
          if (nameRegex) {
            try { namePattern = new RegExp(nameRegex[1], nameRegex[2] || ""); } catch (_) { namePattern = null; }
          } else if (nameString) {
            nameValue = nameString[1].replace(/\\(['\\])/g, "$1");
          }

          const all = allElements();
          if (method === "Role") {
            for (const node of all) {
              if (implicitRole(node) !== firstValue) continue;
              if (namePattern) {
                if (!namePattern.test(norm(accessibleName(node)))) continue;
              } else if (nameValue) {
                const actual = norm(accessibleName(node));
                if (exact ? actual !== nameValue : !actual.includes(nameValue)) continue;
              }
              matches.push(node);
            }
          } else if (method === "Text") {
            matches = all.filter((node) => textMatches(node, firstValue, exact));
          } else if (method === "Label") {
            const seen = new Set();
            for (const node of all) {
              if (tagOf(node) === "label") {
                const labelText = norm(node.textContent);
                if (exact ? labelText === firstValue : labelText.includes(firstValue)) {
                  const id = attr(node, "for");
                  let target = null;
                  if (id) {
                    const root = node.getRootNode ? node.getRootNode() : document;
                    target = root.getElementById ? root.getElementById(id) : null;
                  }
                  if (!target) target = node.querySelector("input, select, textarea");
                  if (target && !seen.has(target)) {
                    seen.add(target);
                    matches.push(target);
                  }
                }
              }
              const aria = attr(node, "aria-label");
              if (aria && (exact ? aria === firstValue : aria.includes(firstValue)) && !seen.has(node)) {
                seen.add(node);
                matches.push(node);
              }
            }
          } else if (method === "Placeholder") {
            matches = all.filter((node) => attr(node, "placeholder") === firstValue);
          } else if (method === "AltText") {
            matches = all.filter((node) => attr(node, "alt") === firstValue);
          } else if (method === "Title") {
            matches = all.filter((node) => attr(node, "title") === firstValue);
          } else if (method === "TestId") {
            matches = all.filter((node) =>
              attr(node, "data-testid") === firstValue ||
              attr(node, "data-test-id") === firstValue ||
              attr(node, "data-test") === firstValue ||
              attr(node, "data-cy") === firstValue
            );
          }
        } else if (locator) {
          const parsed = readFirstString(locator[1]);
          const selector = parsed ? parsed.value : "";
          if (selector.startsWith("//") || selector.startsWith("(/")) {
            const seen = new Set();
            for (const root of roots) {
              const doc = root.ownerDocument || root;
              try {
                const snapshot = doc.evaluate(selector, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (let i = 0; i < snapshot.snapshotLength; i += 1) {
                  const node = snapshot.snapshotItem(i);
                  if (node && !seen.has(node)) {
                    seen.add(node);
                    matches.push(node);
                  }
                }
              } catch (_) { /* ignore */ }
            }
          } else {
            const css = selector.replace(/:visible\b/g, "");
            for (const root of roots) {
              try { matches.push(...root.querySelectorAll(css)); } catch (_) { /* ignore */ }
            }
          }
        }

        if (nth != null && matches.length) {
          matches = matches[Number(nth)] ? [matches[Number(nth)]] : [];
        }

        const seen = new Set();
        matches = matches.filter((node) => {
          if (seen.has(node)) return false;
          seen.add(node);
          return true;
        });
      }

      if (!matches.length) {
        result.error = "No elements matched";
        return result;
      }

      const target = matches[0];
      result.matched = matches.length;
      result.tag = tagOf(target);
      result.text = norm(target.textContent).slice(0, 120);
      const inputType = (attr(target, "type") || "text").toLowerCase();
      result.typable = tagOf(target) === "textarea" || tagOf(target) === "select" ||
        (tagOf(target) === "input" && !["checkbox", "radio", "file", "submit", "button", "reset"].includes(inputType)) ||
        !!target.isContentEditable;

      if (!perform) return result;

      try { target.scrollIntoView({ block: "center", inline: "nearest" }); } catch (_) { /* ignore */ }

      if (kind === "click") {
        target.click();
        result.performed = true;
      } else if (kind === "hover") {
        for (const name of ["mouseover", "mouseenter", "mousemove"]) {
          target.dispatchEvent(new MouseEvent(name, {
            bubbles: name !== "mouseenter", cancelable: true, view: window
          }));
        }
        result.performed = true;
      } else if (kind === "type") {
        if (!result.typable) {
          result.error = "Element is not a text field";
        } else {
          target.focus();
          try {
            if (tagOf(target) === "input" || tagOf(target) === "textarea") {
              const proto = tagOf(target) === "input"
                ? window.HTMLInputElement.prototype
                : window.HTMLTextAreaElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, "value");
              if (setter && setter.set) setter.set.call(target, String(text || ""));
              else target.value = String(text || "");
            } else {
              target.textContent = String(text || "");
            }
            for (const name of ["input", "change", "keyup"]) {
              target.dispatchEvent(new Event(name, { bubbles: true }));
            }
            result.performed = true;
          } catch (error) {
            result.error = error && error.message ? error.message : String(error);
          }
        }
      }

      try {
        const previous = target.style.outline;
        target.style.outline = "2px solid #ff6a2b";
        target.style.outlineOffset = "1px";
        setTimeout(() => {
          target.style.outline = previous;
          target.style.outlineOffset = "";
        }, 1400);
      } catch (_) { /* ignore */ }

      return result;
    } catch (error) {
      result.error = error && error.message ? error.message : String(error);
      return result;
    }
  };

  DI.pageAction = pageAction;
})();
