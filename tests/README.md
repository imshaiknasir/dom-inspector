# Tests

Plain Node test + Playwright. No TypeScript or build step.

## Commands

```bash
npm install
npm run install:browsers   # once: downloads Playwright's Chromium
npm test                   # unit suites, then the extension e2e suite
npm run test:unit          # tests/*.test.js + tests/unit/*.test.js
npm run test:e2e           # tests/e2e/*.spec.js (Playwright test runner)
```

`DI_CHROME_PATH=/path/to/chrome` overrides the Chromium binary used by the
unit harness; without it the harness uses Playwright's bundled Chromium and
falls back to a system Chrome/Chromium if that download is missing. The e2e spec launches its own persistent context with
`channel: "chromium"` because unpacked MV3 extensions need `--load-extension`
and a user-data directory.

## Layout

- `fixture.html` — main page: ids, classes, table rows, open shadow root, iframe.
- `fixtures/escaping.html` — quotes, backslashes, colon and apostrophe ids.
- `fixtures/duplicates.html` — repeated text/classes and hidden siblings.
- `fixtures/aria.html` — labels, roles, table headers, media and form controls.
- `helpers/harness.js` — launches Chromium once per unit file, loads a fixture,
  and injects the generators in manifest order.
- `extras.test.js` — stability scores, Cypress shadow chains, regex roles,
  frameLocator/frame fallbacks and Playwright modifiers.
- `unit/` — CSS, XPath, Playwright, testRigor, Selenium/Cypress/JS, validation,
  utilities, manifest/popup/devtools contracts, service-worker routing, the
  repair loop (single, batch, same-origin frames), a stubbed picker-message
  bridge suite and a language/privacy guard
  (plain JS, no WASM/TypeScript, no remote requests). Every generated count is
  resolved against the live DOM. `playwright-semantics.test.js` cross-checks
  role/text counts against real Playwright locators; cases that still diverge
  are marked todo and tracked in the workspace-root `BLOCKERS.md`.
- `e2e/extension.spec.js` — loads the unpacked extension over HTTP, checks the
  panel is error-free, drives the real picker (`DI_START` → mouse click), and
  verifies the cached payload for CSS, XPath, Playwright, Selenium, testRigor,
  shadow DOM, iframes and axes references. It also exercises right-click copy,
  the popup (last pick, saved list, history, shortcuts), panel filters/exports,
  the driver template, single-locator Fix, batch healing and JSON/POM exports,
  plus the background `DI_GET_LAST` cache.

All 215 unit cases (212 pass, 3 tracked todo) and 36 e2e cases pass. The workspace-root
`../../BLOCKERS.md` tracks any defect that would require editing files owned
by another agent.
