# DOM Inspector

A clean-room Manifest V3 Chrome extension that picks an element and produces
verified locators for CSS, XPath, Playwright, Selenium and Cypress, with live
match counts and on-page highlighting.

No code, assets, names or branding from SelectorsHub were used. Built from the
behavioural analysis in `../selectorshub/analysis/`.

## Install (Load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`dom-inspector-extension`).
4. Open a normal `http(s)` page (not a blank tab or the Web Store).
5. Click the toolbar icon to open the side panel, or open DevTools → Elements →
   **DOM Inspector** sidebar pane.
6. Press **Pick element**, hover, and click. Use **Stop** or `Esc` to cancel.

## Features

- Element picker with live overlay, shadow-DOM awareness and iframe context.
- Ranked CSS candidates with uniqueness verification; dynamic ids/classes filtered.
- XPath: relative (text/attribute/positional), absolute, indexed `(expr)[n]`,
  axes (parent/child/ancestor/descendant/following/preceding/siblings), SVG
  (`local-name()`/`name()`), iframe chain. XPath is explicitly unavailable inside
  shadow DOM (same limitation as browsers).
- Playwright: `getByTestId`, `getByRole` (+ exact/regex name), `getByLabel`,
  `getByPlaceholder`, `getByText`, `getByAltText`, `getByTitle`, CSS/ID,
  `:has-text`/`:text-is`/`:text`/`:visible`, `filter({hasText})`, `nth/first/last`,
  `frameLocator` chains, `and/or`, plus `.nth()` fallback when nothing is unique.
- Selenium values (`id`, `name`, `className`, `tagName`, `linkText`,
  `partialLinkText`, `cssSelector`, `xpath`), Cypress (`cy.get`, `cy.xpath`),
  JS path, jQuery, Selenium frame-switch and shadow-root snippets.
- Validator: auto-detects CSS/Selenium/Playwright/XPath, reports match count or
  parser error, highlights all matches and scrolls the first into view.
- Copy buttons for every locator; DevTools sidebar and Chrome side panel share
  one UI; last pick is restored from `chrome.storage.session`.
- Everything is free and local. No ads, accounts, analytics, remote code or
  licence checks.

## Architecture

```
manifest.json
  background service worker   side panel behavior + last-pick cache
  content scripts (all frames)
    util.js        escaping, deep query, shadow/iframe helpers
    css.js         ranked CSS candidates
    xpath.js       XPath variants + axes
    playwright.js  Playwright generation + local counting engine
    formats.js     Selenium/Cypress/JS/jQuery
    validate.js    detection, validation, highlighting
    picker.js      overlay, picking, message bridge
  devtools page → Elements sidebar pane
  panel/           shared DevTools + side-panel UI
```

Messages: `DI_START`, `DI_STOP`, `DI_TEST`, `DI_CLEAR`, `DI_PING` from the panel
to the content script; `DI_ELEMENT` from content to the panel/worker;
`DI_GET_LAST` from the panel to the worker.

## Tests

Tests use `playwright-core` and the locally installed Chrome. No browser
download is required.

```bash
npm install
npm test          # node --test tests/*.test.js
# optional: CHROME_PATH=/path/to/chrome npm test
```

The suite covers CSS ranking and dynamic-class filtering, XPath relative/
absolute/indexed/text/axes/shadow behaviour, Playwright test-id/role/label
locators and counts, Selenium/Cypress formats, validation errors, iframe
`frameLocator` generation, and manifest integrity.

## Known gaps vs SelectorsHub

- No batch/POM table, XPath-healing batch mode, recorder/TestCase Studio bridge,
  login/ads, or cloud features (all intentionally absent).
- Closed shadow roots and cross-origin iframes remain inaccessible, as in the
  original and in browsers generally.
- Playwright role/name matching is a DOM approximation, not the full ARIA
  algorithm; counts are computed locally and can differ from Playwright's
  actionability and visibility rules.
- XPath in shadow DOM is not generated; use the CSS/Playwright rows instead.
