---
name: generate-locators
description: Use when you know which element to target on a URL or raw HTML and need ranked CSS, XPath, Playwright, Selenium, and Cypress locators with live match counts from Playwright Chromium. Use verify-locator instead when you already have a locator, and list-elements when you do not yet know which element to target.
---

# generate_locators

Generates locators for one element on a real page. The element is located by
CSS, XPath, text, a Playwright expression, or viewport coordinates. Every
candidate is counted against the loaded page.

## When to use

- You know approximately what to target and need a locator to paste into a
  test.
- You need the same element expressed for several frameworks.
- You need ranked alternatives because the obvious selector is not unique.

Do not use this when you already have a locator string: call
`verify_locator` first. Do not use it when you do not know what is on the
page: call `list_elements` first.

## Arguments

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `url` | string | one of `url`/`html` | — | Page to load. |
| `html` | string | one of `url`/`html` | — | Raw HTML via `page.setContent`. |
| `target` | object | yes | — | Exactly one of the target methods below. |
| `target.css` | string | — | — | CSS selector. |
| `target.xpath` | string | — | — | XPath expression. |
| `target.text` | string | — | — | Visible text, Playwright `getByText` semantics (smallest match). |
| `target.exact` | boolean | no | `false` | Exact text match; only with `text`. |
| `target.playwright` | string | — | — | Playwright expression, with or without the leading `page.`. |
| `target.coordinates` | `{ "x": number, "y": number }` | — | — | Viewport pixels; pierces open shadow roots. |
| `target.index` | integer ≥ 0 | no | `0` | Zero-based match when the target matches several elements. |
| `maxCandidates` | integer 1–50 | no | `12` | Per-family cap. |
| `waitUntil` | `"load" \| "domcontentloaded" \| "networkidle" \| "commit"` | no | `domcontentloaded` | Navigation readiness. |
| `timeoutMs` | integer 1000–120000 | no | `15000` | Navigation/evaluation timeout. |
| `viewport` | `{ "width"?: int, "height"?: int }` | no | `1280×800` | Viewport. |

## Example call

```json
{
  "name": "generate_locators",
  "arguments": {
    "url": "https://shop.example.test/cart",
    "target": { "text": "Checkout", "exact": true },
    "maxCandidates": 5
  }
}
```

## Example response

Trimmed: one candidate per family, long attribute maps removed.

```json
{
  "ok": true,
  "source": { "kind": "url", "url": "https://shop.example.test/cart" },
  "page": { "url": "https://shop.example.test/cart", "title": "Cart" },
  "target": { "method": "text", "matchCount": 1, "selectedIndex": 0, "frameIndex": 0, "frameUrl": null },
  "element": {
    "tag": "button",
    "id": "checkout",
    "name": "",
    "classes": ["btn", "primary"],
    "role": "button",
    "accessibleName": "Checkout",
    "text": "Checkout",
    "visible": true,
    "disabled": false,
    "rect": { "x": 920, "y": 640, "width": 120, "height": 40 },
    "attributes": { "data-testid": "checkout-btn", "id": "checkout" }
  },
  "frameLocators": [],
  "css": {
    "best": { "value": "#checkout", "matchCount": 1, "unique": true, "selectsTarget": true, "strategy": "id", "score": 1, "stability": 95 },
    "candidates": [
      { "value": "#checkout", "matchCount": 1, "unique": true, "selectsTarget": true, "strategy": "id", "score": 1, "stability": 95 }
    ]
  },
  "xpath": {
    "best": { "value": "//*[@id='checkout']", "matchCount": 1, "unique": true, "selectsTarget": true, "strategy": "id", "score": 1, "stability": 95 },
    "candidates": [
      { "value": "//*[@id='checkout']", "matchCount": 1, "unique": true, "selectsTarget": true, "strategy": "id", "score": 1, "stability": 95 }
    ]
  },
  "playwright": {
    "best": { "value": "page.getByTestId('checkout-btn')", "matchCount": 1, "unique": true, "selectsTarget": true, "strategy": "getByTestId", "score": 1, "stability": 100 },
    "candidates": [
      { "value": "page.getByTestId('checkout-btn')", "matchCount": 1, "unique": true, "selectsTarget": true, "strategy": "getByTestId", "score": 1, "stability": 100 }
    ]
  },
  "selenium": {
    "strategies": {
      "id": { "value": "checkout", "matchCount": 1, "unique": true },
      "name": null,
      "className": { "value": "btn primary", "matchCount": 1, "unique": true },
      "tagName": { "value": "button", "matchCount": 2, "unique": false },
      "linkText": null,
      "partialLinkText": null,
      "cssSelector": { "value": "#checkout", "matchCount": 1, "unique": true },
      "xpath": { "value": "//*[@id='checkout']", "matchCount": 1, "unique": true }
    },
    "snippets": {
      "css": "driver.findElement(By.cssSelector('#checkout'))",
      "xpath": "driver.findElement(By.xpath('//*[@id=\\'checkout\\']'))",
      "id": "driver.findElement(By.id('checkout'))",
      "name": null,
      "className": "driver.findElement(By.className('btn primary'))",
      "tagName": "driver.findElement(By.tagName('button'))",
      "linkText": null,
      "partialLinkText": null
    },
    "frame": null,
    "shadow": null
  },
  "cypress": {
    "css": "cy.get('#checkout')",
    "xpath": "cy.xpath('//*[@id=\\'checkout\\']')",
    "shadow": null,
    "jquery": "$('#checkout')",
    "javascript": "document.querySelector('#checkout')",
    "xpathJavascript": "document.evaluate('//*[@id=\\'checkout\\']', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue",
    "testRigor": "\"Checkout\"",
    "snippets": [
      { "type": "cypress-css", "code": "cy.get('#checkout')" }
    ]
  },
  "locators": {
    "css": "#checkout",
    "xpath": "//*[@id='checkout']",
    "playwright": "page.getByTestId('checkout-btn')",
    "selenium": "driver.findElement(By.cssSelector('#checkout'))",
    "cypress": "cy.get('#checkout')"
  },
  "recommended": { "format": "playwright", "value": "page.getByTestId('checkout-btn')" }
}
```

## Reading the result

- `recommended` is the best unique locator using the extension ranking.
  `playwright.best`, `css.best`, and `xpath.best` are each the best unique
  (or highest-ranked) candidate in that family.
- `locators` is a convenience object with one primary value per framework:
  `css`, `xpath`, `playwright`, `selenium`, and `cypress`.
- `unique: false` means that candidate matched more than one element. Prefer a
  candidate with `unique: true`, or call `heal_locator` with the intended
  index if nothing is unique.
- `matchCount` comes from the live page. `selectsTarget: false` should not
  occur for a reported candidate; treat it as a failed candidate if it does.
- `frameLocators` is non-empty for elements inside same-origin iframes. The
  Playwright candidates already include `frameLocator(...)`. `selenium.frame`
  and `cypress` shadow snippets are provided when applicable.
- `target.method` reports how the element was located, which is useful when
  `text` or `coordinates` were used.

## Failure modes

- `isError: true` with `"errorType": "invalid-input"` — missing/duplicate
  source, or no single target method.
- Tool error containing `No element matched the target` — the CSS/XPath/text
  did not resolve, or coordinates landed outside the page.
- `Target index N is out of range` — `target.index` is too large.
- Chromium missing — run `npm run install:browsers` in the repository.

## Next step

If you only needed a locator, stop. If you need to confirm a locator on a
different page state, call `verify_locator`. If no candidate is unique, call
`heal_locator` with `index` pointing at the intended match.
