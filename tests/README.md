# Tests

Plain Node test + Playwright. No TypeScript or build step.

## Commands

```bash
npm install
npm run install:browsers   # once: downloads Playwright's Chromium
npm test                   # unit suites, then the extension e2e suite
npm run test:unit          # tests/unit/*.test.js (Node test runner)
npm run test:e2e           # tests/e2e/*.spec.js (Playwright test runner)
```

`DI_CHROME_PATH=/path/to/chrome` overrides the Chromium binary used by the
unit harness. The e2e spec launches its own persistent context with
`channel: "chromium"` because unpacked MV3 extensions need `--load-extension`
and a user-data directory.

## Layout

- `fixture.html` — main page: ids, classes, table rows, open shadow root, iframe.
- `fixtures/escaping.html` — quotes, backslashes, colon and apostrophe ids.
- `fixtures/duplicates.html` — repeated text/classes and hidden siblings.
- `fixtures/aria.html` — labels, roles, table headers, media and form controls.
- `helpers/harness.js` — launches Chromium once per unit file, loads a fixture,
  and injects the generators in manifest order.
- `unit/` — CSS, XPath, Playwright, Selenium/Cypress/JS, validation, utilities,
  manifest and panel-contract checks. Every generated count is resolved against
  the live DOM.
- `e2e/extension.spec.js` — loads the unpacked extension over HTTP, checks the
  panel is error-free, drives the real picker (`DI_START` → mouse click), and
  verifies the cached payload for CSS, XPath, Playwright, Selenium, shadow DOM
  and iframes, plus the background `DI_GET_LAST` cache.

`node:test` `{ todo }` cases document known defects; they do not fail the suite.
See `../BLOCKERS.md` at the workspace root for the owning file:line.
