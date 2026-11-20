---
name: verify-locator
description: Use when you already have a CSS, XPath, or Playwright locator and need its live match count, uniqueness, parser error, and matching elements from Playwright Chromium. Use generate-locators when you need a new locator, and heal-locator when verification reports zero or multiple matches and you need a replacement.
---

# verify_locator

Tests one locator against a URL or raw HTML in Chromium. Auto-detects CSS,
XPath, and Playwright by default. Never mutates the page.

## When to use

- You have a locator from a test, a bug report, another tool, or a previous
  session and need to know whether it is safe.
- You changed a locator by hand and need parser feedback.
- You want to confirm a page is still compatible after a UI change.

Resolve an already-verified unique locator without wasting a call. Do not use
this to search for a locator: use `generate_locators` or `list_elements`.

## Arguments

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `locator` | string | yes | — | CSS, XPath, or Playwright expression. |
| `type` | `"auto" \| "css" \| "xpath" \| "playwright"` | no | `auto` | Force the language when auto-detection is ambiguous. |
| `maxMatches` | integer 1–50 | no | `10` | Maximum matches described in `matches`. |
| `url` | string | one of `url`/`html` | — | Page to load. |
| `html` | string | one of `url`/`html` | — | Raw HTML via `page.setContent`. |
| `waitUntil` | `"load" \| "domcontentloaded" \| "networkidle" \| "commit"` | no | `domcontentloaded` | Navigation readiness. |
| `timeoutMs` | integer 1000–120000 | no | `15000` | Navigation/evaluation timeout. |
| `viewport` | `{ "width"?: int, "height"?: int }` | no | `1280×800` | Viewport. |

Playwright expressions may include `getByTestId`, `getByRole` (string or regex
name), `getByLabel`, `getByPlaceholder`, `getByText`, `getByAltText`,
`getByTitle`, `locator('css'|'xpath='|'text=')`, `frameLocator`, `:visible`,
`:has-text`, `:text`, `:text-is`, `.first()`, `.last()`, `.nth()`, and
`.filter({ hasText })`.

## Machine-readable input schema

This is the exact schema advertised by `tools/list` (descriptions omitted).

```json
{
  "type": "object",
  "required": ["locator"],
  "additionalProperties": false,
  "properties": {
    "locator": { "type": "string", "minLength": 1 },
    "type": { "type": "string", "enum": ["auto", "css", "xpath", "playwright"] },
    "maxMatches": { "type": "integer", "minimum": 1, "maximum": 50 },
    "url": { "type": "string", "minLength": 1 },
    "html": { "type": "string", "minLength": 1 },
    "waitUntil": { "type": "string", "enum": ["load", "domcontentloaded", "networkidle", "commit"] },
    "timeoutMs": { "type": "integer", "minimum": 1000, "maximum": 120000 },
    "viewport": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "width": { "type": "integer", "minimum": 200, "maximum": 4000 },
        "height": { "type": "integer", "minimum": 200, "maximum": 4000 }
      }
    }
  }
}
```

## Example call

```json
{
  "name": "verify_locator",
  "arguments": {
    "url": "https://shop.example.test/cart",
    "locator": "page.getByRole('button', { name: 'Checkout' })",
    "maxMatches": 5
  }
}
```

## Example response: unique

```json
{
  "ok": true,
  "source": { "kind": "url", "url": "https://shop.example.test/cart" },
  "page": { "url": "https://shop.example.test/cart", "title": "Cart" },
  "locator": "page.getByRole('button', { name: 'Checkout' })",
  "type": "playwright",
  "matchCount": 1,
  "unique": true,
  "error": null,
  "frame": null,
  "matches": [
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
      "attributes": { "data-testid": "checkout-btn", "id": "checkout" }
    }
  ],
  "advice": "Unique: this locator is safe to use."
}
```

## Example response: non-unique

```json
{
  "ok": true,
  "source": { "kind": "url", "url": "https://shop.example.test/cart" },
  "page": { "url": "https://shop.example.test/cart", "title": "Cart" },
  "locator": "#cart .row button",
  "type": "css",
  "matchCount": 3,
  "unique": false,
  "error": null,
  "frame": null,
  "matches": [
    { "tag": "button", "id": "", "text": "Remove", "visible": true },
    { "tag": "button", "id": "", "text": "Remove", "visible": true }
  ],
  "advice": "Non-unique: call heal_locator with an index to produce a unique locator."
}
```

Example `matches` entries are trimmed; every match uses the same shape as the
unique example.

## Example response: no match or parser error

```json
{
  "ok": false,
  "source": { "kind": "html", "bytes": 88 },
  "page": { "url": "about:blank", "title": "" },
  "locator": "div[",
  "type": "css",
  "matchCount": 0,
  "unique": false,
  "error": "Failed to execute 'querySelectorAll' on 'Document': 'div[' is not a valid selector.",
  "frame": null,
  "matches": [],
  "advice": "No match: call generate_locators on the intended element or heal_locator on this value."
}
```

## Reading the result

- `ok` is true when at least one element matched; it does not mean unique.
- Always check `unique` before using a locator. `unique === true` means exactly
  one element matched.
- `type` is the detected or forced language. Keep it for the next call when you
  use `heal_locator`.
- `matches` is capped by `maxMatches`; `matchCount` is the true count in the
  frame that resolved the locator. CSS/XPath resolution falls back to a
  same-origin iframe when the main frame has no match, so counts are not
  aggregated across several frames.
- `frame` names the child frame URL when resolution fell back into a
  same-origin iframe. A `frameLocator(...)` Playwright expression is resolved
  from the main frame and may report `frame: null` while still matching inside
  the frame.
- `error` is a parser/runtime message; it is not thrown as a tool error.

## Decision rules

| Result | Next action |
| --- | --- |
| `unique: true` | Use the locator. Stop. |
| `matchCount > 1` | `heal_locator` with `index` selecting the intended element. |
| `ok: false`, parser error | `heal_locator` first; it normalizes before falling back. |
| `matchCount: 0`, valid syntax | `heal_locator`; if that returns `status: "not-found"`, use `generate_locators` with `text` or `coordinates`. |

## Failure modes

- Empty `locator` is rejected by the input schema (`minLength: 1`).
- Providing both `url` and `html`, or neither, returns
  `"errorType": "invalid-input"`.
- Cross-origin frames are not inspected; the locator may report zero matches
  there even if it would work inside the test runner's frame.
- Chromium missing — run `npm run install:browsers` in the repository.
