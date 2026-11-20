---
name: heal-locator
description: Use when a CSS, XPath, or Playwright locator is broken, matches nothing, or matches several elements and you need a unique replacement verified against Playwright Chromium. Use verify-locator to test a locator first, and generate-locators when there is no usable locator to repair.
---

# heal_locator

Repairs a broken locator or turns a non-unique locator into a unique one.
Broken input is normalized and re-tested, then repaired with the extension's
token-matching repair engine. For non-unique input, choose the intended match
with `index` and a unique locator is generated for that element. Every claimed
replacement is re-verified against the live page.

## When to use

- `verify_locator` returned `matchCount: 0` or a parser error.
- `verify_locator` returned `matchCount > 1` and you can identify the intended
  match by index.
- A previously working locator broke after a DOM change.

Do not use this when the locator is already unique; nothing needs healing.
Do not guess an `index` on a page you have not inspected: call
`list_elements` or `verify_locator` first.

## Arguments

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `locator` | string | yes | — | Broken or non-unique CSS/XPath/Playwright locator. |
| `type` | `"auto" \| "css" \| "xpath" \| "playwright"` | no | `auto` | Force the language if detection is wrong. |
| `index` | integer ≥ 0 | no | `0` | Which match to heal when the input matches several elements. |
| `prefer` | `"playwright" \| "css" \| "xpath"` | no | `playwright` | Preferred output format. Falls back to other unique candidates. |
| `url` | string | one of `url`/`html` | — | Page to load. |
| `html` | string | one of `url`/`html` | — | Raw HTML via `page.setContent`. |
| `waitUntil` | `"load" \| "domcontentloaded" \| "networkidle" \| "commit"` | no | `domcontentloaded` | Navigation readiness. |
| `timeoutMs` | integer 1000–120000 | no | `15000` | Navigation/evaluation timeout. |
| `viewport` | `{ "width"?: int, "height"?: int }` | no | `1280×800` | Viewport. |

## Example call: broken locator

```json
{
  "name": "heal_locator",
  "arguments": {
    "url": "https://shop.example.test/cart",
    "locator": "#checkou",
    "prefer": "css"
  }
}
```

## Example response: healed

```json
{
  "ok": true,
  "status": "healed",
  "reason": "broken",
  "source": { "kind": "url", "url": "https://shop.example.test/cart" },
  "page": { "url": "https://shop.example.test/cart", "title": "Cart" },
  "input": { "locator": "#checkou", "type": "css" },
  "previous": { "locator": "#checkou", "type": "css", "matchCount": 0, "unique": false },
  "fixed": "#checkout",
  "selectedIndex": null,
  "choice": { "format": "css", "value": "#checkout" },
  "verified": { "locator": "#checkout", "type": "css", "matchCount": 1, "unique": true, "error": null },
  "error": null,
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
  "recommended": { "format": "css", "value": "#checkout" },
  "advice": "Use fixed (or recommended) as the replacement locator; it was re-verified as unique."
}
```

Trimmed example: candidate arrays contain one row here. Real responses include
up to `12` candidates per family.

## Example call: non-unique locator

```json
{
  "name": "heal_locator",
  "arguments": {
    "url": "https://shop.example.test/cart",
    "locator": "#cart .row button",
    "index": 1,
    "prefer": "playwright"
  }
}
```

Example result fields for this case:

```json
{
  "ok": true,
  "status": "healed",
  "reason": "non-unique",
  "input": { "locator": "#cart .row button", "type": "css" },
  "previous": { "locator": "#cart .row button", "type": "css", "matchCount": 3, "unique": false },
  "selectedIndex": 1,
  "fixed": "page.locator('#cart .row button').nth(1)",
  "choice": { "format": "playwright", "value": "page.locator('#cart .row button').nth(1)" },
  "verified": { "locator": "page.locator('#cart .row button').nth(1)", "type": "playwright", "matchCount": 1, "unique": true, "error": null }
}
```

`fixed` is an example. The actual format depends on the generated unique
candidates: a test id or role locator is preferred when available, otherwise a
unique CSS/XPath path or `.nth()` fallback.

## Status values

| `status` | Meaning | `fixed` / `ok` |
| --- | --- | --- |
| `valid` | Input already matched exactly one element. | `fixed` is the input; `ok: true`. |
| `healed` | A replacement was produced. | `fixed` is the unique replacement; `ok: true` when re-verified. |
| `not-found` | No matching element or no unique replacement. | `ok: false`, inspect `error`. |
| `not-unique` | Replacement candidates still matched several elements. | `ok: false`, inspect `previous` and `analysis`. |

`healed` is a claim about the replacement, not the original. Use `verified` and
`fixed` for assertions; `previous` records the input's failure.

## Decision rules

| Situation | Action |
| --- | --- |
| Input is unique | Do not heal; use it. |
| Input matches 2+ elements | Set `index` to the intended match, then heal. |
| Input fails to parse or matches nothing | Heal without `index`; repair normalizes first. |
| Heal returns `not-found` | Use `list_elements`, then `generate_locators` on a text/coordinates target. |
| Heal returns `not-unique` | Inspect `analysis`; choose a unique candidate or a different `index`. |

## Failure modes

- Index out of range returns `status: "not-found"` with an explanatory error.
- Cross-origin frames and closed shadow roots are not reachable.
- Heuristics can pick a plausible but wrong element for badly degraded input.
  Check `element`, `fixed`, and `verified` before replacing a locator in a test.
- Chromium missing — run `npm run install:browsers` in the repository.
