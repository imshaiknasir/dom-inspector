/* DOM Inspector — Playwright locator language converters (JS → Python/Java/C#). */
(() => {
  "use strict";
  const DI = (globalThis.DIPanel = globalThis.DIPanel || {});

  const readQuoted = (input, start) => {
    const quote = input[start];
    if (quote !== "'" && quote !== '"' && quote !== "`") return null;
    let out = "";
    let i = start + 1;
    while (i < input.length) {
      const ch = input[i];
      if (ch === "\\") {
        const next = input[i + 1];
        if (next === "u") {
          const code = parseInt(input.slice(i + 2, i + 6), 16);
          if (!Number.isNaN(code)) out += String.fromCharCode(code);
          i += 6;
          continue;
        }
        const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
        out += Object.prototype.hasOwnProperty.call(map, next) ? map[next] : next;
        i += 2;
        continue;
      }
      if (ch === quote) return { value: out, end: i + 1 };
      out += ch;
      i += 1;
    }
    return null;
  };

  const toDoubleQuoted = (code) => {
    let out = "";
    let i = 0;
    while (i < code.length) {
      const ch = code[i];
      if (ch === "'" || ch === '"' || ch === "`") {
        const parsed = readQuoted(code, i);
        if (parsed) {
          out += JSON.stringify(parsed.value);
          i = parsed.end;
          continue;
        }
      }
      out += ch;
      i += 1;
    }
    return out;
  };

  const roleJava = (role) => String(role).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const ROLE_CS = {
    rowheader: "RowHeader", columnheader: "ColumnHeader", spinbutton: "SpinButton",
    searchbox: "SearchBox", listitem: "ListItem", progressbar: "ProgressBar",
    contentinfo: "ContentInfo", listbox: "ListBox", combobox: "ComboBox",
    textbox: "TextBox", rowgroup: "RowGroup"
  };
  const roleCSharp = (role) => {
    const key = String(role).toLowerCase();
    if (ROLE_CS[key]) return ROLE_CS[key];
    return key.split(/[^a-z0-9]+/).filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  };

  const regexRole = (entry, lang) => {
    const pattern = entry.pattern.replace(/"/g, '\\"');
    if (lang === "python") {
      return `.get_by_role("${entry.role}", name=re.compile(r"${pattern}", re.I))`;
    }
    if (lang === "java") {
      return `.getByRole(AriaRole.${roleJava(entry.role)}, new Page.GetByRoleOptions().setName(Pattern.compile("${pattern}", Pattern.CASE_INSENSITIVE)))`;
    }
    if (lang === "csharp") {
      return `.GetByRole(AriaRole.${roleCSharp(entry.role)}, new() { Name = new Regex("${pattern}", RegexOptions.IgnoreCase) })`;
    }
    return `.getByRole("${entry.role}", { name: /${entry.pattern}/i })`;
  };

  const convertPlaywright = (code, lang, awaitPrefix) => {
    const raw = String(code || "");
    if (lang === "js") return awaitPrefix ? "await " + raw : raw;

    const regexRoles = [];
    const work = raw.replace(
      /\.getByRole\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*name:\s*\/((?:\\.|[^/\\])*)\/([a-z]*)\s*\}\s*\)/g,
      (_match, role, pattern, flags) => {
        regexRoles.push({ role, pattern, flags });
        return `.__DI_RR_${regexRoles.length - 1}__()`;
      }
    );

    let out = toDoubleQuoted(work);
    for (let i = 0; i < regexRoles.length; i += 1) {
      out = out.split(`.__DI_RR_${i}__()`).join(regexRole(regexRoles[i], lang));
    }

    if (lang === "python") {
      out = out
        .replace(/\.getByRole\(/g, ".get_by_role(")
        .replace(/\.getByText\(/g, ".get_by_text(")
        .replace(/\.getByLabel\(/g, ".get_by_label(")
        .replace(/\.getByPlaceholder\(/g, ".get_by_placeholder(")
        .replace(/\.getByAltText\(/g, ".get_by_alt_text(")
        .replace(/\.getByTitle\(/g, ".get_by_title(")
        .replace(/\.getByTestId\(/g, ".get_by_test_id(")
        .replace(/\.frameLocator\(/g, ".frame_locator(")
        .replace(/\{\s*name:\s*("(?:[^"\\]|\\.)*")(?:\s*,\s*exact:\s*(true|false))?\s*\}/g,
          (_m, name, exact) => `name=${name}` + (exact ? `, exact=${exact === "true"}` : ""))
        .replace(/\{\s*exact:\s*(true|false)\s*\}/g, (_m, exact) => `exact=${exact === "true"}`);
    } else if (lang === "java") {
      out = out
        .replace(/\.getByRole\(\s*"([^"]+)"\s*,\s*\{\s*name:\s*("(?:[^"\\]|\\.)*")(?:\s*,\s*exact:\s*(true|false))?\s*\}\s*\)/g,
          (_m, role, name, exact) =>
            `.getByRole(AriaRole.${roleJava(role)}, new Page.GetByRoleOptions().setName(${name})${exact ? `.setExact(${exact})` : ""})`)
        .replace(/\.getByRole\(\s*"([^"]+)"\s*\)/g,
          (_m, role) => `.getByRole(AriaRole.${roleJava(role)})`)
        .replace(/\.(getByText|getByLabel|getByPlaceholder|getByAltText|getByTitle)\(\s*("(?:[^"\\]|\\.)*")\s*,\s*\{\s*exact:\s*(true|false)\s*\}\s*\)/g,
          (_m, method, value, exact) => {
            const options = method.charAt(0).toUpperCase() + method.slice(1) + "Options";
            return `.${method}(${value}, new Page.${options}().setExact(${exact}))`;
          });
    } else if (lang === "csharp") {
      const cap = (method) => method.charAt(0).toUpperCase() + method.slice(1);
      out = out
        .replace(/\.getByRole\(\s*"([^"]+)"\s*,\s*\{\s*name:\s*("(?:[^"\\]|\\.)*")(?:\s*,\s*exact:\s*(true|false))?\s*\}\s*\)/g,
          (_m, role, name, exact) =>
            `.GetByRole(AriaRole.${roleCSharp(role)}, new() { Name = ${name}${exact ? `, Exact = ${exact}` : ""} })`)
        .replace(/\.getByRole\(\s*"([^"]+)"\s*\)/g,
          (_m, role) => `.GetByRole(AriaRole.${roleCSharp(role)})`)
        .replace(/\.(getByText|getByLabel|getByPlaceholder|getByAltText|getByTitle)\(\s*("(?:[^"\\]|\\.)*")\s*,\s*\{\s*exact:\s*(true|false)\s*\}\s*\)/g,
          (_m, method, value, exact) => `.${cap(method)}(${value}, new() { Exact = ${exact} })`)
        .replace(/\.(getByText|getByLabel|getByPlaceholder|getByAltText|getByTitle|getByTestId)\(/g,
          (_m, method) => `.${cap(method)}(`)
        .replace(/\.frameLocator\(/g, ".FrameLocator(")
        .replace(/\.locator\(/g, ".Locator(")
        .replace(/\.nth\(/g, ".Nth(")
        .replace(/^page\./, "Page.");
    }

    return out;
  };

  DI.convertPlaywright = convertPlaywright;
  DI.toDoubleQuoted = toDoubleQuoted;
})();
