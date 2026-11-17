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
5. Click the toolbar icon to open the compact popup, or open DevTools → Elements
   → **DOM Inspector** sidebar pane. The popup can open the side panel.
6. Press **Pick element**, hover the page and click a node. Use **Stop** or
   `Esc` to cancel. Reload an already-open tab after installing or updating the
   extension so the content script is present.

## Panel tour

- **Toolbar popup** — start picking, open the panel, jump to batch healing,
  review the last picked element, an expandable list of latest distinct picks
  and recent saved locators, and copy any value. **Test** sends the best locator to the panel
  tester. Shortcuts: `P` pick, `O` open panel, `H` batch healing, `R` refresh,
  `T` test best, `C` copy all last locators.
- **Selected element** — tag, id, classes, implicit role, accessible name, text,
  visibility, URL, iframe depth, shadow-host chain, shadow CSS chain and frame
  XPath. When the same page is picked twice, a collapsible diff shows locators
  added, removed or whose counts changed.
- **Locator sections** — CSS, XPath, Playwright, Selenium and
  Cypress/JS/jQuery. Each row shows the generated value, its strategy, a live
  match count and `unique` / `no match` state. The best candidate is marked with
  an accent border.
- **Per-row actions** — Test & highlight, edit in tester, save, copy.
- **Section actions** — copy every visible locator in that section.
- **Toolbar** — text filter, strategy filter (ID, attribute, class, text, path,
  semantic), unique-only mode, collapse/expand all, copy all, JSON export and
  settings reset.
- **Playwright language switch** — JavaScript, Python, Java and C#. JavaScript
  can be prefixed with `await`. Python/Java/C# output is a best-effort
  translation of the generated JavaScript locator.
- **Test a locator** — paste CSS, XPath or Playwright, get an auto-detected type,
  a debounced live count, and Test & highlight. **Fix** repairs a broken locator
  through the page repair engine, replaces the tester value and re-validates it.
  Click / Hover / Type actions run against the page, searching open shadow roots
  and same-origin frames. They accept CSS, XPath, Playwright `getBy*`,
  `locator()` chains, `.first()`, `.last()`, `.nth()` and
  `.filter({hasText})`. Role/label/test-id matching follows the generator's
  accessible-name semantics. Action testing is best-effort and reported
  honestly when a field is not typable or nothing matches.
- **Axes reference** — press **Axes ref**, pick a reference element, then pick
  the target. The panel lists axes XPath from the reference (descendant,
  ancestor, siblings, following/preceding, common ancestor), with counts and a
  clear-reference action.
- **Batch selector healing** — paste one selector per line, check all against
  the page, flag broken or non-unique rows, and run **Fix flagged** to get a
  verified unique replacement from the repair engine. Copy or export the report
  as JSON/CSV.
- **Driver command template** — build a runnable command from the best CSS or
  XPath using `{selector}` (legacy `xpathvalue` / `cssvalue` also work), with
  Selenium Java/Python, Cypress, Playwright and TestNG presets.
- **Saved locators** — a small locator/POM list stored locally. Rename entries,
  filter, reorder, re-check every saved locator's live count, re-test, edit,
  copy, delete, import JSON/CSV, export JSON/CSV, clear the list, or download a
  Playwright page-object snippet (`POM`) generated from the saved locators.
- **Right-click copy** — the page context menu can pick an element or copy its
  best selector through the worker.
- **Persistence** — language, await, unique-only, continuous picking, collapsed
  sections, driver template and saved locators survive panel reloads. The last
  pick is restored from the service worker/session storage, the panel keeps a
  small history of recent picks for the popup, and open panel/popup surfaces
  stay in sync through storage events.
- **Themes** — light and dark follow the browser colour scheme.

### Keyboard

- `Esc` stops an active picker, or clears highlights while the tester is focused.
- `Enter` in the tester runs Test & highlight; in the saved-name field it
  commits the name.
- `Enter` in the “Text to type” field runs the Type action.
- Popup: `P` pick, `O` open panel, `H` batch healing, `R` refresh, `T` test the
  best locator in the panel, `C` copy the locators shown for the last pick.

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
  `cy.get` / `cy.xpath` / shadow chain; testRigor label path; JS
  `document.querySelector` and `document.evaluate`; jQuery; Selenium
  frame-switch and open-shadow-root snippets.

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
    repair.js       normalize + best-match selector repair loop
    picker.js       overlay, picking, axes reference, message bridge
  devtools page → Elements sidebar pane
  popup/
    popup.html         toolbar popup markup
    popup.css          compact popup styling
    popup.js           pick/open panel/recent locators/copy
  panel/
    panel.html         shared DevTools + side-panel markup
    panel.css          responsive light/dark design
    panel.js           panel controller, locator rendering, batch healing
    panel-converters.js Playwright language converters
    panel-actions.js   self-contained page action runner
```

Messages used by the panel/popup: `DI_START`, `DI_STOP`, `DI_TEST`, `DI_CLEAR`,
`DI_CLEAR_REFERENCE`, `DI_PING` to the content script; `DI_ELEMENT` and
`DI_REFERENCE` from content to the panel/worker; `DI_GET_LAST` to the worker;
`DI_COPY_BEST` from the worker's context menu. Panel and popup state is stored
under `di:panel:*` keys in `chrome.storage.local`; the last pick uses
`chrome.storage.session`. Batch repair calls the content repair engine through
`chrome.scripting` and verifies every suggested fix before showing it.

## Permissions and privacy

`activeTab`, `scripting`, `storage`, `sidePanel`, `clipboardWrite`,
`contextMenus` and host access to `<all_urls>` are needed to inspect the active
page, run locator actions, open the side panel, provide right-click actions and
copy results. Everything runs locally. There are no ads, accounts, analytics,
remote code, licence checks or network calls.

## Tests

Tests use Node's test runner and Playwright. No TypeScript or build step is
involved; the e2e spec launches its own Chromium with `--load-extension`.

```bash
npm install
npm run install:browsers   # once, for the e2e suite
npm test                   # unit suites, then extension e2e
npm run test:unit          # tests/*.test.js + tests/unit/*.test.js
npm run test:e2e           # tests/e2e/*.spec.js
```

Unit coverage includes CSS ranking/dynamic-class filtering, XPath
relative/absolute/indexed/text/axes/SVG/shadow behaviour, Playwright
test-id/role/label/regex locators and counts, Selenium/Cypress formats,
validation errors, iframe `frameLocator` generation, utilities, manifest
integrity and the panel contract (every id used by `panel.js` exists in
`panel.html`, no duplicate ids, local scripts exist). The e2e spec loads the
unpacked extension, drives the real picker and checks the cached payload.

The panel and popup were additionally smoke-tested in headless Chrome with a
stubbed extension API: rendering, counts, language switching, filtering,
saved-locator actions, tester validation, page actions, batch healing and
popup copy. Current status: 184/184 unit checks and 30/30 extension e2e checks
pass, including real-extension coverage for the popup, axes reference,
right-click bridge, repair and batch healing.

## Known gaps

- Batch healing accepts pasted lines and exports JSON/CSV, but does not import
  spreadsheets; its repair suggestions are heuristic when a selector cannot be
  normalized. Recorder/TestCase Studio, login, ads and cloud features are
  intentionally absent.
- Saved locators are a lightweight POM list; there is no editable
  multi-column POM grid or spreadsheet import.
- Java/C# Playwright option objects are best-effort translations, not compiler
  verification. Regex role output assumes the right `Pattern` / `Regex` import.
- Playwright role/name matching is a local DOM approximation, not the full ARIA
  algorithm or Playwright actionability model; counts can differ from a real
  Playwright run.
- Action testing runs in one matching frame and cannot reach cross-origin
  frames or closed shadow roots. Batch repair uses heuristic token matching when
  a selector cannot be normalized into a valid one.
- Closed shadow roots and cross-origin iframes remain inaccessible, as in
  browsers generally.
