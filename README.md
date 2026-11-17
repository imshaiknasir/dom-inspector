# DOM Inspector

A clean-room Manifest V3 Chrome extension that picks an element and produces
verified locators for CSS, XPath, Playwright, Selenium, Cypress, JavaScript and
jQuery. Every locator is resolved against the live page with a match count, and
the same polished panel works as a DevTools sidebar pane and as a Chrome side
panel.

No code, assets, names or branding from SelectorsHub were used. The build is
based on the behavioural analysis in `../selectorshub/analysis/`.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`dom-inspector-extension`).
4. Open a normal `http(s)` page (not a blank tab, `chrome://` page or the Web
   Store, where content scripts cannot run).
5. Click the toolbar icon to open the side panel, or open DevTools → Elements →
   **DOM Inspector** sidebar pane.
6. Press **Pick element**, hover the page and click a node. Use **Stop** or
   `Esc` to cancel. Reload an already-open tab after installing or updating the
   extension so the content script is present.

## Panel tour

- **Selected element** — tag, id, classes, implicit role, accessible name, text,
  visibility, URL, iframe depth, shadow-host chain and shadow CSS chain.
- **Locator sections** — CSS, XPath, Playwright, Selenium and
  Cypress/JS/jQuery. Each row shows the generated value, its strategy, a live
  match count and `unique` / `no match` state. The best candidate is marked with
  an accent border.
- **Per-row actions** — Test & highlight, edit in tester, save, copy.
- **Section actions** — copy every visible locator in that section.
- **Toolbar** — text filter, unique-only mode, collapse/expand all, copy all,
  JSON export and settings reset.
- **Playwright language switch** — JavaScript, Python, Java and C#. JavaScript
  can be prefixed with `await`. Python/Java/C# output is a best-effort
  translation of the generated JavaScript locator.
- **Test a locator** — paste CSS, XPath or Playwright, get an auto-detected type,
  a debounced live count, and Test & highlight. Click / Hover / Type actions run
  against the page, searching open shadow roots and same-origin frames. Action
  testing is best-effort and reported honestly when a field is not typable or
  nothing matches.
- **Driver command template** — build a runnable command from the best CSS or
  XPath using `{selector}` (legacy `xpathvalue` / `cssvalue` also work), with
  Selenium Java/Python, Cypress, Playwright and TestNG presets.
- **Saved locators** — a small locator/POM list stored locally. Rename entries,
  re-test, edit, copy, delete, export JSON or CSV, or clear the list.
- **Persistence** — language, await, unique-only, continuous picking, collapsed
  sections, driver template and saved locators survive panel reloads. The last
  pick is restored from the service worker/session storage.
- **Themes** — light and dark follow the browser colour scheme.

### Keyboard

- `Esc` stops an active picker, or clears highlights while the tester is focused.
- `Enter` in the tester runs Test & highlight; in the saved-name field it
  commits the name.
- `Enter` in the “Text to type” field runs the Type action.

## Locator coverage

- **CSS:** id, tag+id, `data-testid` / `data-test` / `data-cy`, name,
  aria-label, placeholder, alt, title, role, type, filtered classes, parent-id
  path, ancestor path and absolute `nth-of-type` path. Dynamic ids/classes are
  filtered and every candidate is verified for uniqueness.
- **XPath:** id, `data-*` and common attributes, exact/contains/starts-with
  text, own text, positional path anchored on an id, absolute path, indexed
  `(expr)[n]`, and axes (descendant, ancestor, following/preceding sibling,
  following, preceding, common ancestor). SVG uses `local-name()` / `name()`.
  Same-origin iframe chains are described. XPath inside a shadow root is
  explicitly unavailable, matching browser behaviour.
- **Playwright:** `getByTestId`, `getByRole` (exact and case-insensitive regex
  name), `getByLabel`, `getByPlaceholder`, `getByText`, `getByAltText`,
  `getByTitle`, CSS/ID `locator`, engine pseudo-classes (`:visible`,
  `:has-text`, `:text-is`, `:text`), `frameLocator` chains and `.nth()` fallback
  when nothing is unique. Counts come from a local DOM engine.
- **Other formats:** Selenium `By.id`, `By.name`, `By.className`, `By.tagName`,
  `By.linkText`, `By.partialLinkText`, `By.cssSelector`, `By.xpath`; Cypress
  `cy.get` / `cy.xpath`; JS `document.querySelector` and `document.evaluate`;
  jQuery; Selenium frame-switch and open-shadow-root snippets.

## Architecture

```
manifest.json
  background service worker   side-panel behaviour + last-pick cache
  content scripts (all frames)
    util.js         escaping, deep query, shadow/iframe helpers
    css.js          ranked CSS candidates
    xpath.js        XPath variants + axes
    playwright.js   Playwright generation + local counting engine
    formats.js      Selenium/Cypress/JS/jQuery/frame/shadow snippets
    validate.js     detection, validation, highlighting
    picker.js       overlay, picking, continuous mode, message bridge
  devtools page → Elements sidebar pane
  panel/
    panel.html         shared DevTools + side-panel markup
    panel.css          responsive light/dark design
    panel.js           panel controller and locator rendering
    panel-converters.js Playwright language converters
    panel-actions.js   self-contained page action runner
```

Messages used by the panel: `DI_START`, `DI_STOP`, `DI_TEST`, `DI_CLEAR`,
`DI_PING` to the content script; `DI_ELEMENT` from content to the panel/worker;
`DI_GET_LAST` to the worker. Panel state is stored under `di:panel:*` keys in
`chrome.storage.local`; the last pick uses `chrome.storage.session`.

## Permissions and privacy

`activeTab`, `scripting`, `storage`, `sidePanel`, `clipboardWrite` and host
access to `<all_urls>` are needed to inspect the active page, run locator
actions, open the side panel and copy results. Everything runs locally. There
are no ads, accounts, analytics, remote code, licence checks or network calls.

## Tests

Tests use Node's test runner and Playwright. No TypeScript or build step is
involved; the e2e spec launches its own Chromium with `--load-extension`.

```bash
npm install
npm run install:browsers   # once, for the e2e suite
npm test                   # unit suites, then extension e2e
npm run test:unit          # tests/unit/*.test.js
npm run test:e2e           # tests/e2e/*.spec.js
```

Unit coverage includes CSS ranking/dynamic-class filtering, XPath
relative/absolute/indexed/text/axes/SVG/shadow behaviour, Playwright
test-id/role/label/regex locators and counts, Selenium/Cypress formats,
validation errors, iframe `frameLocator` generation, utilities, manifest
integrity and the panel contract (every id used by `panel.js` exists in
`panel.html`, no duplicate ids, local scripts exist). The e2e spec loads the
unpacked extension, drives the real picker and checks the cached payload.

The panel was additionally smoke-tested in headless Chrome with a stubbed
extension API: rendering, counts, language switching, filtering,
saved-locator actions, tester validation and page actions. Current status:
80/80 unit checks and 7/7 extension e2e checks pass.

## Known gaps

- No batch XPath-healing import/export, recorder/TestCase Studio, login, ads or
  cloud features (intentionally absent).
- Saved locators are a lightweight POM list; there is no editable
  multi-column POM grid or spreadsheet import.
- Java/C# Playwright option objects are best-effort translations, not compiler
  verification. Regex role output assumes the right `Pattern` / `Regex` import.
- Playwright role/name matching is a local DOM approximation, not the full ARIA
  algorithm or Playwright actionability model; counts can differ from a real
  Playwright run.
- Action testing runs in one matching frame and cannot reach cross-origin
  frames or closed shadow roots.
- Closed shadow roots and cross-origin iframes remain inaccessible, as in
  browsers generally.
