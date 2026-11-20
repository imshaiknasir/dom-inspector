---
name: list-elements
description: Use when you need to discover which elements are on a URL or raw HTML before choosing a locator target. Returns visible interactive controls, open-shadow-root descendants, and same-origin iframe contents with role, accessible name, text, and best CSS/XPath/Playwright locators. Use generate-locators once you know the target.
---

# list_elements

Inventories interactive elements on a real page. This is the discovery step
before `generate_locators`. It returns each element's role, accessible name,
text, visibility, bounds, and best CSS/XPath/Playwright locator.

## When to use

- You do not know the DOM yet or need to pick between several similar
  controls.
- You need the intended match's index before healing a non-unique locator.
- You want a quick map of buttons, links, inputs, selects, textareas, and ARIA
  widgets.

Do not use this when you already know the exact element or locator; go
straight to `generate_locators` or `verify_locator`.

## Arguments

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `selector` | string | no | interactive controls | CSS selector to list. Overrides the default set. |
| `limit` | integer 1–200 | no | `25` | Maximum elements returned overall (across frames). |
| `includeHidden` | boolean | no | `false` | Include elements without a visible box. |
| `url` | string | one of `url`/`html` | — | Page to load. |
| `html` | string | one of `url`/`html` | — | Raw HTML via `page.setContent`. |
| `waitUntil` | `"load" \| "domcontentloaded" \| "networkidle" \| "commit"` | no | `domcontentloaded` | Navigation readiness. |
| `timeoutMs` | integer 1000–120000 | no | `15000` | Navigation/evaluation timeout. |
| `viewport` | `{ "width"?: int, "height"?: int }` | no | `1280×800` | Viewport. |

The default selector covers `a[href]`, `area[href]`, `button`,
`input:not([type="hidden"])`, `select`, `textarea`, `summary`, `details`,
contenteditable hosts, and the common interactive ARIA roles.

## Example call

```json
{
  "name": "list_elements",
  "arguments": {
    "url": "https://shop.example.test/cart",
    "selector": "button, input",
    "limit": 10
  }
}
```

## Example response

Trimmed to two elements.

```json
{
  "ok": true,
  "source": { "kind": "url", "url": "https://shop.example.test/cart" },
  "page": { "url": "https://shop.example.test/cart", "title": "Cart" },
  "selector": "button, input",
  "totalMatched": 7,
  "returned": 2,
  "framesScanned": 1,
  "elements": [
    {
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
      "attributes": { "data-testid": "checkout-btn", "id": "checkout" },
      "locators": {
        "css": { "value": "#checkout", "matchCount": 1, "unique": true },
        "xpath": { "value": "//*[@id='checkout']", "matchCount": 1, "unique": true },
        "playwright": { "value": "page.getByTestId('checkout-btn')", "matchCount": 1, "unique": true }
      },
      "frameLocators": [],
      "index": 1,
      "frame": null
    },
    {
      "tag": "input",
      "id": "coupon",
      "name": "coupon",
      "classes": [],
      "role": "textbox",
      "accessibleName": "Coupon code",
      "text": "",
      "visible": true,
      "disabled": false,
      "rect": { "x": 8, "y": 640, "width": 220, "height": 30 },
      "attributes": { "id": "coupon", "name": "coupon", "placeholder": "Coupon code" },
      "locators": {
        "css": { "value": "#coupon", "matchCount": 1, "unique": true },
        "xpath": { "value": "//*[@id='coupon']", "matchCount": 1, "unique": true },
        "playwright": { "value": "page.getByRole('textbox', { name: 'Coupon code', exact: true })", "matchCount": 1, "unique": true }
      },
      "frameLocators": [],
      "index": 2,
      "frame": null
    }
  ]
}
```

## Reading the result

- `totalMatched` is the full visible match count before `limit`; `returned` is
  how many are in `elements`.
- `index` is 1-based output ordering, not a DOM index. Use it to orient, then
  use `generate_locators` for a specific element.
- `locators.css/xpath/playwright` are the best candidates only. They can be
  non-unique (`unique: false`) when the page repeats controls.
- `frameLocators` is non-empty for elements inside same-origin iframes. The
  `frame` field carries the frame URL.
- Open shadow roots are traversed; closed roots are not.
- With `includeHidden: true`, `visible` tells you which elements lack a
  rendered box.

## Decision rules

| You need | Action |
| --- | --- |
| A locator for a listed element | Call `generate_locators` with its `id`, text, or the returned CSS. |
| To disambiguate a repeated control | Note the list order, then heal with `index` or generate with `target.index`. |
| To check a listed locator | Call `verify_locator` with it. |
| More than `limit` elements | Increase `limit` (max 200) or narrow `selector`. |

## Failure modes

- `selector` is invalid CSS — the tool returns an input error.
- Both or neither of `url`/`html` — `"errorType": "invalid-input"`.
- Cross-origin iframes contribute no elements; only same-origin frames are
  scanned.
- An element with zero rendered box is omitted unless `includeHidden` is true.
- Chromium missing — run `npm run install:browsers` in the repository.
