# DOM Inspector

Pick an element on any page and copy verified locators for Playwright, Selenium, Cypress, CSS, and XPath.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3)
[![Chrome 116+](https://img.shields.io/badge/Chrome-116%2B-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions)
[![Tests](https://img.shields.io/badge/tests-245%20unit%20%2B%2054%20e2e-brightgreen)](#development-and-tests)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

A clean-room Manifest V3 Chrome extension for QA engineers and SDETs. Click an element, and the panel lists ranked locators that have already been resolved against the live page, each with a match count and a unique / no-match badge.

It is an independent open-source alternative to tools like SelectorsHub. It is not affiliated with SelectorsHub, and it does not use that project's code, assets, names, or branding.

## Why

Chrome DevTools can copy a CSS path or an XPath, but it will not tell you whether that selector is unique, and it will not give you a Playwright `getByRole` or a Selenium `By.*` snippet. DOM Inspector is built for the locators you actually paste into Playwright, Selenium, and Cypress tests.

Everything runs on your machine. There are no accounts, ads, analytics, remote scripts, or license checks.

## Features

- **Pick from the page** — hover to highlight, click to inspect. Works in open shadow roots and same-origin iframes. Cancel with **Stop** or `Esc`. Continuous picking stays on until you stop it.
- **Verified locators** — CSS, XPath, Playwright, Selenium, Cypress, JavaScript, jQuery, and testRigor. Each row shows the value, the strategy, a live match count, and whether it is unique.
- **Automation-ready snippets** — Playwright `getBy*` locators in JavaScript, Python, Java, and C# (Java and C# are best-effort translations of the JavaScript locator). Selenium `By.*`. Cypress `cy.get` / `cy.xpath`, plus shadow-root and frame-switch snippets.
- **Same panel in two places** — a DevTools Elements sidebar pane and a Chrome side panel, plus a compact toolbar popup for pick, recent history, and saved locators.
- **Test, highlight, and repair** — paste a CSS, XPath, or Playwright locator to get a live count and highlight matches. **Fix** runs a local repair engine and keeps a replacement only after it re-validates as unique. Click, Hover, and Type actions are available as a best-effort check.
- **Axes reference** — pick a reference element, then a target, and get axes XPath (descendant, ancestor, siblings, following/preceding, common ancestor) with counts.
- **Batch selector healing** — paste one selector per line, flag broken or non-unique rows, and replace flagged ones with a verified unique suggestion. Export the report as JSON or CSV.
- **Saved locators** — a local list you can rename, filter, reorder, re-check, repair, and import or export as JSON or CSV. Download a Playwright page-object snippet from the saved entries.
- **Right-click copy** — the page context menu can pick an element or copy its best selector.
- **Local and private** — settings, history, and saved locators stay in Chrome storage. Light and dark themes follow the browser colour scheme.

## Install (load unpacked)

The extension is not on the Chrome Web Store yet. There is no build step: the repository root is the unpacked extension (it contains `manifest.json`).

```bash
git clone https://github.com/imshaiknasir/dom-inspector.git
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the cloned `dom-inspector` folder.
4. Open a normal `http(s)` page. Content scripts cannot run on a new-tab page, `chrome://` URLs, or the Chrome Web Store.
5. Click the toolbar icon for the popup, or open DevTools → Elements → **DOM Inspector**. The popup can also open the side panel.
6. Reload any tab that was already open before you installed or updated the extension.

Chrome 116 or newer is required. Other Chromium browsers such as Edge or Brave may load the unpacked folder, but the extension is developed and tested for Chrome.

Keyboard shortcuts (Chrome may ask you to confirm them at `chrome://extensions/shortcuts`):

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+D` | Open DOM Inspector |
| `Alt+Shift+P` | Start picking an element |

## Usage

1. Press **Pick element** (or `P` in the popup, or `Alt+Shift+P`).
2. Hover the page and click the node you want. Use **Stop** or `Esc` to cancel.
3. Review the ranked locators in the panel. The best candidate is marked with an accent border.
4. Copy a row, or use **Test & highlight** / **Fix** on a locator you already have.

### Panel

- **Selected element** — tag, id, classes, implicit role, accessible name, text, visibility, URL, iframe depth, and shadow/frame context. Picking the same page twice shows a collapsible diff of locators that were added, removed, or whose counts changed.
- **Locator sections** — CSS, XPath, Playwright, Selenium, and Cypress/JS/jQuery. Filter by text or strategy (ID, attribute, class, text, path, semantic), switch on unique-only mode, collapse sections, copy all visible rows, or export JSON.
- **Playwright language switch** — JavaScript, Python, Java, and C#. JavaScript can be prefixed with `await`.
- **Tester** — paste CSS, XPath, or Playwright; the type is auto-detected. Counts update as you type. **Fix** repairs a broken locator through the page repair engine. Click / Hover / Type search open shadow roots and same-origin frames, and accept CSS, XPath, Playwright `getBy*` (string or regex arguments), `locator()` chains, `.first()`, `.last()`, `.nth()`, `.filter({hasText})`, and the `css=`, `xpath=`, and `text=` engines. `:visible` filters hidden matches. Action testing is best-effort and reports honestly when a field is not typable or nothing matches.
- **Driver command template** — build a runnable command from the best CSS or XPath using `{selector}`, with Selenium Java/Python, Cypress, Playwright, and TestNG presets. Values are escaped for the surrounding quotes.
- **Saved locators** — Check, Test, and Fix stay scoped to each entry's saved source page, so a locator is never rewritten against the wrong DOM. Code snippets that are not locators are kept and exported but skipped by Check. CSV exports prefix formula-like cells (`=`, `+`, `-`, `@`, tab, or newline) with an apostrophe; import removes that prefix again.

### Popup and keyboard

In the popup: `P` pick, `O` open the panel, `H` batch healing, `R` refresh, `T` test the best locator, `C` copy the locators for the last pick.

In the panel:

- `Esc` clears the focused filter, stops an active picker, or clears tester highlights.
- `Enter` in the tester runs Test & highlight; in a saved name field it commits the name; in “Text to type” it runs Type.

## MCP server

The repository includes a local [Model Context Protocol](https://modelcontextprotocol.io) server in `mcp/` so coding agents can generate, verify, and heal locators against real pages. It speaks MCP over stdio, uses the official `@modelcontextprotocol/sdk`, and injects the extension's own `src/content` modules into Playwright Chromium. Nothing is sent to a remote service.

```bash
npm install
npm run install:browsers   # Playwright Chromium
npm run mcp:start          # stdio server; diagnostics on stderr
```

| Tool | What it does |
| --- | --- |
| `generate_locators` | Find an element by CSS, XPath, text, Playwright expression, or viewport coordinates and return ranked CSS, XPath, Playwright, Selenium, and Cypress locators with live counts. |
| `verify_locator` | Test an existing locator and report its type, match count, uniqueness, parser error, and matching elements. |
| `heal_locator` | Normalize/repair a broken locator, or pick one of several matches by index and regenerate a unique, re-verified locator. |
| `list_elements` | List visible interactive elements, including open shadow roots and same-origin iframes, with role, accessible name, text, and best locators. |

Point your MCP client at the absolute path of `mcp/server.js`. Claude Code and Cursor, for example:

```json
{
  "mcpServers": {
    "dom-inspector": {
      "command": "node",
      "args": ["/absolute/path/to/dom-inspector/mcp/server.js"]
    }
  }
}
```

Codex and OpenCode snippets, exact argument schemas, and example calls/responses are in the [skill map](skills/README.md).

## Skill map

`skills/` contains agent-facing skills that make the generate / verify / heal decision explicit:

- [skills/list-elements](skills/list-elements/SKILL.md) — discover controls before targeting one.
- [skills/generate-locators](skills/generate-locators/SKILL.md) — produce framework-ready locators for a known element.
- [skills/verify-locator](skills/verify-locator/SKILL.md) — check count, uniqueness, and parser errors.
- [skills/heal-locator](skills/heal-locator/SKILL.md) — repair broken input or disambiguate repeated matches.
- [skills/locator-workflow](skills/locator-workflow/SKILL.md) — the full decision tree and safe retry loop.

The [top-level skill map](skills/README.md) includes install/config snippets for Claude Code, Codex, OpenCode, and Cursor, plus the rule for when to generate, verify, or heal instead of guessing.

## Locator coverage

- **CSS** — id, tag+id, `data-testid` / `data-test-id` / `data-test` / `data-cy`, name, aria-label, placeholder, alt, title, role, type, filtered classes, parent-id path, ancestor path, and absolute `nth-of-type` path. Generated-looking ids and classes (long hashes, CSS-in-JS tokens, UUID-like values) are skipped, and every candidate is counted on the live page.
- **XPath** — id, `data-*` and common attributes, exact / contains / starts-with text, own text, a positional path anchored on an id, absolute path, indexed `(expr)[n]`, and axes. SVG nodes use `local-name()` / `name()`. Same-origin iframe chains are described. XPath inside a shadow root is unavailable, which matches browser behaviour.
- **Playwright** — `getByTestId`, `getByRole` (exact and case-insensitive regex name), `getByLabel`, `getByPlaceholder`, `getByText`, `getByAltText`, `getByTitle`, CSS/ID `locator`, engine pseudo-classes (`:visible`, `:has-text`, `:text-is`, `:text`), `frameLocator` chains, and a `.nth()` fallback when nothing is unique. Counts come from a local DOM engine, not from a Playwright test run.
- **Other formats** — Selenium `By.id`, `By.name`, `By.className`, `By.tagName`, `By.linkText`, `By.partialLinkText`, `By.cssSelector`, `By.xpath`; Cypress `cy.get` / `cy.xpath` / shadow chain; testRigor label path; `document.querySelector` and `document.evaluate`; jQuery; Selenium frame-switch and open-shadow-root snippets.

## How it compares

Facts you can check in this repository or in Chrome itself. This is not a feature-parity chart against commercial tools.

| | DOM Inspector | Chrome DevTools “Copy selector” / “Copy XPath” |
| --- | --- | --- |
| Live match count and unique / no-match badge | Yes | No |
| Playwright `getBy*` locators | Yes (JS, plus best-effort Python, Java, and C#) | No |
| Selenium `By.*` and Cypress snippets | Yes | No |
| Selector repair and batch healing | Yes, local, re-validated before display | No |
| Saved locators and a Playwright POM snippet | Yes, stored locally | No |
| Runs without a network account | Yes | Yes (built into Chrome) |
| Chrome Web Store listing | Not published yet; load unpacked | Built into Chrome |

## Development and tests

Plain JavaScript, HTML, and CSS. There is no bundler, TypeScript, or compile step. Node.js 20 or newer is required for the test suite.

```bash
npm install
npm run install:browsers   # once, for the end-to-end suite
npm test                   # unit suites, then extension e2e
npm run test:unit          # tests/*.test.js and tests/unit/*.test.js
npm run test:e2e           # tests/e2e/*.spec.js
npm run test:mcp           # MCP server through the SDK stdio client
```

The unit suites cover CSS ranking and generated-class filtering, XPath (relative, absolute, indexed, text, axes, SVG, shadow), Playwright locators and counts, Selenium/Cypress formats, validation, iframe `frameLocator` generation, utilities, manifest integrity, and panel/popup/devtools contracts (every id used by the scripts exists in the markup). The e2e spec launches Chromium with `--load-extension`, drives the real picker, and covers the popup, axes reference, right-click copy, repair, batch healing, and saved-locator flows. The MCP suite starts the stdio server with the official SDK client and exercises every tool against fixture pages loaded over HTTP.

Current suite: **250 unit cases** (245 pass, 5 tracked as `todo` probes for remaining Playwright action-runner parity) and **54 e2e cases** (one is an expected failure: whitespace-only saved locator values are still accepted). Those gaps are listed below.

```
manifest.json
  background service worker     side-panel behaviour and last-pick cache
  content scripts (all frames)
    util.js         escaping, deep query, shadow/iframe helpers
    css.js          ranked CSS candidates
    xpath.js        XPath variants and axes
    playwright.js   Playwright generation and local counting engine
    formats.js      Selenium, Cypress, JS, jQuery, frame, and shadow snippets
    validate.js     detection, validation, highlighting
    repair.js       selector repair loop
    picker.js       overlay, picking, axes reference, message bridge
  devtools page  →  Elements sidebar pane
  popup/            toolbar popup
  panel/            shared DevTools and side-panel UI
```

## Limitations

- Closed shadow roots and cross-origin iframes are inaccessible, as in browsers generally. XPath cannot target nodes inside a shadow root.
- Playwright role, name, and text matching is a local DOM approximation, not the full ARIA algorithm or Playwright's actionability model. Counts can differ from a real Playwright run.
- Java and C# Playwright option objects are best-effort translations, not compiler-checked output. Regex role output assumes the right `Pattern` / `Regex` import.
- Action testing runs in one matching frame and cannot reach cross-origin frames or closed shadow roots. It is best-effort when a control is hidden, disabled, or not typable.
- Batch healing accepts pasted lines and exports JSON/CSV, but does not import spreadsheets. Repair suggestions are heuristic when a selector cannot be normalized. A fix is shown only after it re-validates as unique.
- Saved locators are a lightweight list, not an editable multi-column POM grid, and there is no XLS import or export.
- Five unit tests in the panel action runner remain `todo` (hidden-role filtering, some accessible names, extended roles, role state options, and `locator(selector, { hasText })`). One e2e case is marked as an expected failure for whitespace-only saved values.

## Roadmap

Grounded in the current gaps, not a wish list:

- Closer Playwright action and ARIA parity (the remaining `todo` cases above).
- Multi-column POM grid and XLS import/export (JSON/CSV and reorder already work).
- Per-attribute generation filters and per-row visibility controls.
- Aggregate Playwright counts and actions across frames, with a clearer choose-frame flow.

A recorder or Test Case Studio is out of scope for now.

## Contributing

Bug reports and pull requests are welcome, especially around locator accuracy, Playwright parity, and tests.

1. Fork the repository and create a branch.
2. Load the unpacked folder in Chrome and keep the relevant unit or e2e coverage up to date.
3. Run `npm test` before you open a pull request.

Please do not add a build step, TypeScript, or remote network calls to the extension itself.

## Privacy and permissions

The extension requests `activeTab`, `scripting`, `storage`, `sidePanel`, `clipboardWrite`, `contextMenus`, and host access to `<all_urls>` so it can inspect the active page, run locator actions, open the side panel, offer right-click actions, and copy results. All of that stays on your computer.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Sekh Nasir.
