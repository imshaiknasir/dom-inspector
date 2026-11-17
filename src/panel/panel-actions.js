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
        ? (/^page\.|^getBy|^locator\(/.test(value) ? "playwright"
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
      const ignoredText = ["script", "style", "noscript", "template"];
      const visibleText = (node) => {
        let out = "";
        for (const child of node.childNodes) {
          if (child.nodeType === 3) { out += child.nodeValue; continue; }
          if (child.nodeType !== 1 || ignoredText.includes(tagOf(child))) continue;
          out += visibleText(child);
        }
        return out;
      };
      const textEquals = (actual, wanted, exact) => {
        const value = norm(actual);
        const needle = norm(wanted);
        return exact ? value === needle : value.toLowerCase().includes(needle.toLowerCase());
      };
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

      // Playwright only treats header/footer as landmarks when they are not
      // nested inside sectioning content.
      const bodyScoped = (node) => {
        let parent = node.parentElement;
        while (parent) {
          if (["article", "aside", "main", "nav", "section"].includes(tagOf(parent))) return false;
          parent = parent.parentElement;
        }
        return true;
      };
      const named = (node) => !!(attr(node, "aria-label") || attr(node, "aria-labelledby"));
      const implicitRole = (node) => {
        const explicit = (attr(node, "role") || "").split(/\s+/)[0];
        if (explicit) return explicit;
        const tag = tagOf(node);
        if (tag === "a" || tag === "area") return node.hasAttribute("href") ? "link" : null;
        if (tag === "button") return "button";
        if (tag === "input") {
          const inputType = (attr(node, "type") || "text").toLowerCase();
          if (inputType === "hidden") return null;
          if (inputType === "file") return "button";
          if (["button", "submit", "reset", "image"].includes(inputType)) return "button";
          if (inputType === "checkbox") return "checkbox";
          if (inputType === "radio") return "radio";
          if (inputType === "range") return "slider";
          if (inputType === "number") return "spinbutton";
          if (inputType === "search") return "searchbox";
          return "textbox";
        }
        if (tag === "select") return node.multiple || Number(attr(node, "size") || 0) > 1 ? "listbox" : "combobox";
        if (tag === "img") return node.hasAttribute("alt") && attr(node, "alt") === "" ? null : "img";
        if (tag === "section") return named(node) ? "region" : null;
        if (tag === "form") return named(node) ? "form" : null;
        if (tag === "header") return bodyScoped(node) ? "banner" : null;
        if (tag === "footer") return bodyScoped(node) ? "contentinfo" : null;
        if (tag === "th") return (attr(node, "scope") || "").toLowerCase() === "row" ? "rowheader" : "columnheader";
        const map = {
          aside: "complementary",
          caption: "caption",
          dialog: "dialog",
          fieldset: "group",
          figure: "figure",
          hr: "separator",
          progress: "progressbar",
          option: "option",
          tbody: "rowgroup",
          tfoot: "rowgroup",
          thead: "rowgroup",
          textarea: "textbox",
          h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
          ul: "list", ol: "list", li: "listitem", table: "table", tr: "row", td: "cell",
          nav: "navigation", main: "main", article: "article"
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

      const NAME_FROM_CONTENT = [
        "button", "cell", "checkbox", "columnheader", "gridcell", "heading",
        "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
        "radio", "row", "rowheader", "switch", "tab", "tooltip", "treeitem"
      ];
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
        const tag = tagOf(node);
        if (tag === "input") {
          const inputType = (attr(node, "type") || "text").toLowerCase();
          if (["submit", "button", "reset"].includes(inputType)) {
            return attr(node, "value") || (inputType === "submit" ? "Submit" : "");
          }
        }
        const role = implicitRole(node);
        if (NAME_FROM_CONTENT.includes(role) ||
            ["button", "a", "option", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
          const contents = norm(visibleText(node));
          if (contents) return contents;
        }
        return attr(node, "title") || attr(node, "placeholder") || "";
      };

      const textMatches = (node, needle, exact, pattern) => {
        if (ignoredText.includes(tagOf(node))) return false;
        const matches = (text) => (pattern ? pattern.test(text) : textEquals(text, needle, exact));
        const own = norm(visibleText(node));
        if (!own) return false;
        if (!matches(own)) return false;
        for (const child of node.children) {
          if (ignoredText.includes(tagOf(child))) continue;
          const childText = norm(visibleText(child));
          if (childText && matches(childText)) return false;
        }
        return true;
      };

      const readFirstString = (args) => {
        const start = args.search(/['"`/]/);
        if (start < 0) return null;
        if (args[start] === "/") {
          let pattern = "";
          let inClass = false;
          let i = start + 1;
          while (i < args.length) {
            const ch = args[i];
            if (ch === "\\") {
              pattern += ch + (args[i + 1] || "");
              i += 2;
              continue;
            }
            if (ch === "[") inClass = true;
            else if (ch === "]") inClass = false;
            if (ch === "/" && !inClass) {
              let flags = "";
              i += 1;
              while (i < args.length && /[a-z]/i.test(args[i])) {
                flags += args[i];
                i += 1;
              }
              let regex = null;
              try { regex = new RegExp(pattern, flags); } catch (_) { regex = null; }
              return { value: pattern, end: i, regex };
            }
            pattern += ch;
            i += 1;
          }
          return null;
        }
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
          if (ch === quote) return { value: out, end: i + 1, regex: null };
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
        let first = false;
        let last = false;
        let filterText = null;
        let stripping = true;
        while (stripping) {
          stripping = false;
          let modifier;
          if ((modifier = expression.match(/\.first\(\)\s*$/))) {
            first = true;
            expression = expression.slice(0, modifier.index);
            stripping = true;
            continue;
          }
          if ((modifier = expression.match(/\.last\(\)\s*$/))) {
            last = true;
            expression = expression.slice(0, modifier.index);
            stripping = true;
            continue;
          }
          if ((modifier = expression.match(/\.nth\((\d+)\)\s*$/))) {
            nth = Number(modifier[1]);
            expression = expression.slice(0, modifier.index);
            stripping = true;
            continue;
          }
          if ((modifier = expression.match(/\.filter\(\{\s*hasText:\s*(['"])((?:\\.|(?!\1).)*)\1\s*\}\s*\)\s*$/))) {
            filterText = modifier[2].replace(/\\(['"\\])/g, "$1");
            expression = expression.slice(0, modifier.index);
            stripping = true;
          }
        }

        const call = expression.match(/getBy(Role|Text|Label|Placeholder|AltText|Title|TestId)\((.*)\)\s*$/);
        const locator = !call && /^locator\(/.test(expression);

        if (call) {
          const method = call[1];
          const args = call[2];
          const firstValue = readFirstString(args);
          const firstText = firstValue ? firstValue.value : "";
          const firstPattern = firstValue ? firstValue.regex : null;
          const rest = firstValue ? args.slice(firstValue.end) : "";
          const exact = /exact:\s*true/.test(rest);
          const firstMatch = (actual) => (firstPattern ? firstPattern.test(String(actual)) : textEquals(actual, firstText, exact));
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
              if (implicitRole(node) !== firstText) continue;
              if (namePattern) {
                if (!namePattern.test(norm(accessibleName(node)))) continue;
              } else if (nameValue) {
                if (!textEquals(accessibleName(node), nameValue, exact)) continue;
              }
              matches.push(node);
            }
          } else if (method === "Text") {
            matches = all.filter((node) => textMatches(node, firstText, exact, firstPattern));
          } else if (method === "Label") {
            const seen = new Set();
            for (const node of all) {
              if (tagOf(node) === "label") {
                if (firstMatch(visibleText(node))) {
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
              if (aria && firstMatch(aria) && !seen.has(node)) {
                seen.add(node);
                matches.push(node);
              }
              const labelledBy = attr(node, "aria-labelledby");
              if (labelledBy) {
                const root = node.getRootNode ? node.getRootNode() : document;
                const text = labelledBy.split(/\s+/).map((ref) => {
                  const target = root.getElementById ? root.getElementById(ref) : null;
                  return target ? norm(target.textContent) : "";
                }).join(" ").trim();
                if (text && firstMatch(text) && !seen.has(node)) {
                  seen.add(node);
                  matches.push(node);
                }
              }
            }
          } else if (method === "Placeholder") {
            matches = all.filter((node) => firstMatch(attr(node, "placeholder")));
          } else if (method === "AltText") {
            matches = all.filter((node) => firstMatch(attr(node, "alt")));
          } else if (method === "Title") {
            matches = all.filter((node) => firstMatch(attr(node, "title")));
          } else if (method === "TestId") {
            matches = all.filter((node) => firstMatch(attr(node, "data-testid")));
          }
        } else if (locator) {
          const selectors = [];
          let rest = expression;
          let match;
          const pattern = /^locator\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/;
          while ((match = rest.match(pattern))) {
            selectors.push(match[2].replace(/\\(['"`\\])/g, "$1"));
            rest = rest.slice(match[0].length).replace(/^\./, "");
          }
          if (selectors.length) {
            let nodes = [];
            const selector = selectors[0];
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
                      nodes.push(node);
                    }
                  }
                } catch (_) { /* ignore */ }
              }
            } else {
              const css = selector.replace(/:visible\b/g, "");
              for (const root of roots) {
                try { nodes.push(...root.querySelectorAll(css)); } catch (_) { /* ignore */ }
              }
            }
            for (let i = 1; i < selectors.length; i += 1) {
              const next = [];
              const css = selectors[i].replace(/:visible\b/g, "");
              for (const node of nodes) {
                const scope = node.shadowRoot || node;
                try { next.push(...scope.querySelectorAll(css)); } catch (_) { /* ignore */ }
              }
              nodes = next;
              if (!nodes.length) break;
            }
            matches = nodes;
          }
        }

        if (filterText !== null) {
          matches = matches.filter((node) => textEquals(node.textContent, filterText, false));
        }
        if (first) matches = matches.slice(0, 1);
        if (last) matches = matches.slice(-1);
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
