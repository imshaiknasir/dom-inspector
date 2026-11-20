---
name: locator-workflow
description: Use when an agent must decide between generating, verifying, and healing locators, or must recover from a broken locator on a live page. Provides the complete decision tree, framework output selection, and safe retry loop for the DOM Inspector MCP tools.
---

# Locator workflow

Use this skill whenever more than one DOM Inspector tool could apply. The goal
is to stop guessing: discover, generate, verify, then heal only when
verification fails.

## Tool inventory

| Tool | Purpose | Mutates the page? |
| --- | --- | --- |
| `list_elements` | Discover elements and their best locators. | No |
| `generate_locators` | Produce ranked CSS/XPath/Playwright/Selenium/Cypress locators for a known element. | No |
| `verify_locator` | Count matches and check uniqueness for an existing locator. | No |
| `heal_locator` | Normalize/repair or disambiguate a locator and re-verify a replacement. | No |

All tools accept exactly one of `url` or `html`. All return JSON in
`content[0].text` and `structuredContent`; failures set `isError: true`.

## Decision tree

```text
START
│
├─ Do you have a locator string?
│  │
│  ├─ NO
│  │  ├─ Do you know which element you want?
│  │  │  ├─ NO  -> list_elements
│  │  │  │         pick an element from the response
│  │  │  │         -> generate_locators (css/xpath/text/index)
│  │  │  └─ YES -> generate_locators
│  │  └─ Stop when recommended/playwright.best/css.best is unique.
│  │
│  └─ YES
│     ├─ verify_locator
│     │
│     ├─ unique == true
│     │  -> use it. Do not heal.
│     │
│     ├─ matchCount > 1
│     │  -> list_elements or inspect verify_locator.matches
│     │  -> heal_locator with index = intended match
│     │  -> use fixed (verified.unique == true)
│     │
│     └─ ok == false (0 matches or parse error)
│        -> heal_locator (no index needed for 0 matches)
│           ├─ status "healed" / "valid" -> use fixed
│           ├─ status "not-found"        -> list_elements
│           │                             -> generate_locators with text
│           │                                or coordinates
│           └─ status "not-unique"       -> choose index from matches
│                                          -> heal_locator again
```

## Framework output selection

| Target framework | Read from | Use |
| --- | --- | --- |
| Playwright JS/TS | `playwright.best.value` or `recommended.value` | `page.getByTestId(...)`, `page.getByRole(...)`, `page.locator(...)`, `frameLocator(...)` |
| Selenium | `selenium.strategies.*` and `selenium.snippets.*` | `By.id`, `By.cssSelector`, `By.xpath`, `By.linkText`, etc. |
| Cypress | `cypress.css`, `cypress.xpath`, `cypress.shadow` | `cy.get(...)`, `cy.xpath(...)`, `.shadow()` chains |
| Plain CSS | `css.best.value` | `document.querySelector`, stylesheets, test runner CSS |
| XPath | `xpath.best.value` | XML/legacy tools; unavailable inside shadow roots |
| JavaScript | `cypress.javascript`, `cypress.xpathJavascript` | `document.querySelector` / `document.evaluate` |
| jQuery | `cypress.jquery` | `$(...)` |

Prefer stable semantic locators in this order:

```text
getByTestId / data-testid
  > getByRole + accessible name
  > getByLabel / getByPlaceholder / getByText (for stable copy)
  > id
  > unique CSS attribute/class
  > unique CSS path
  > XPath
  > .nth() / positional fallback
```

The server already ranks candidates this way within each family. Do not
replace a unique semantic locator with a positional one merely because it is
shorter.

## Safe retry loop

1. **Discover** (`list_elements`) when the target is unknown. Read `role`,
   `accessibleName`, `text`, `visible`, and `locators`.
2. **Generate** (`generate_locators`) for the chosen element.
3. **Verify** (`verify_locator`) if the locator came from anywhere other than
   a fresh `generate_locators` response. Generated candidates were already
   counted, but a page state change invalidates that count.
4. **Heal** (`heal_locator`) only when verification says zero or multiple
   matches.
5. **Re-verify** the replacement when using it in a different page state.
   `heal_locator` already re-verifies `fixed`; trust `verified.unique`.
6. **Fallback** when healing fails: go back to `list_elements` and generate
   from `text` or `coordinates` for the intended element. Never invent a new
   selector from memory.

Retry policy:

- Retry a transient navigation timeout once with a larger `timeoutMs` or
  `waitUntil: "load"`.
- Do not retry a parser error unchanged; heal it instead.
- Do not retry `status: "not-found"` with the same index; change the index or
  discover the element again.

## Example: new test, unknown page

```json
{"name": "list_elements", "arguments": {"url": "https://shop.example.test/cart", "selector": "button", "limit": 20}}
```

```json
{"name": "generate_locators", "arguments": {"url": "https://shop.example.test/cart", "target": {"text": "Checkout", "exact": true}}}
```

Use `recommended.value`.

## Example: existing test, non-unique locator

```json
{"name": "verify_locator", "arguments": {"url": "https://shop.example.test/cart", "locator": "#cart .row button"}}
```

Response says `matchCount: 3`, `unique: false`. Disambiguate:

```json
{"name": "heal_locator", "arguments": {"url": "https://shop.example.test/cart", "locator": "#cart .row button", "index": 1, "prefer": "playwright"}}
```

Use `fixed` when `verified.unique === true`.

## Example: existing test, broken locator

```json
{"name": "heal_locator", "arguments": {"url": "https://shop.example.test/cart", "locator": "#checkou", "prefer": "css"}}
```

Response `status: "healed"`, `fixed: "#checkout"`, `verified.unique: true`.
Replace the old locator in the test with `fixed`.

## Example: element in an iframe

```json
{"name": "generate_locators", "arguments": {"url": "https://shop.example.test/embed", "target": {"css": "#inner-submit"}}}
```

`frameLocators` is non-empty and Playwright candidates start with
`page.frameLocator(...)`. For Selenium, use `selenium.frame`;
for Cypress shadow DOM, use `cypress.shadow`.

## Guard rails

- Never call `heal_locator` with an `index` you have not justified from
  `verify_locator.matches` or `list_elements`.
- Never accept `ok: false` as success. For heal, additionally require
  `verified.unique === true` when `fixed` is present.
- Never treat `ok: true` from `verify_locator` as unique; check `unique`.
- Do not claim browser coverage that the tools do not have: closed shadow
  roots and cross-origin frames are out of reach.
- These tools do not run click/type actions; they only inspect locators.
