# DOM Inspector skill map

Agent skills for the DOM Inspector MCP server. The server runs locator
generation, verification, and healing from the extension's own modules inside
a real Playwright Chromium page, then returns structured JSON.

Use this map to choose the right tool without guessing. Each linked skill has
the exact argument schema, a request example, an example response, and its
failure modes.

## Skills

| Skill | Tool | Use it when |
| --- | --- | --- |
| [list-elements](list-elements/SKILL.md) | `list_elements` | You do not know what is on the page or which element to target. |
| [generate-locators](generate-locators/SKILL.md) | `generate_locators` | You know the element (CSS, XPath, text, Playwright locator, or coordinates) and need locators. |
| [verify-locator](verify-locator/SKILL.md) | `verify_locator` | You already have a locator and need its match count, uniqueness, or parser error. |
| [heal-locator](heal-locator/SKILL.md) | `heal_locator` | A locator is broken, matches nothing, or matches several elements and you need a unique replacement. |
| [locator-workflow](locator-workflow/SKILL.md) | all four | You need the end-to-end decision rules and a safe retry loop. |

## Decision rules

```text
No element or locator yet?
  -> list_elements, then generate_locators on the chosen element.

Have a locator and have not tested it on the current page?
  -> verify_locator first.

verify_locator: unique = true
  -> use it; no healing.

verify_locator: matchCount > 1
  -> heal_locator with index = the intended match (default 0).
     Prefer the locator format your test framework uses.

verify_locator: ok = false, matchCount = 0
  -> heal_locator (repair loop), then check result.fixed / result.recommended.
     If heal_locator returns status "not-found", go back to
     list_elements or generate_locators with text/coordinates.

DOM changed after a locator worked?
  -> verify_locator again; heal_locator only if it is no longer unique.
```

Never call `heal_locator` on a locator that already verifies as unique unless
you are intentionally switching the output format.

## Install and configure

Build prerequisites:

```bash
git clone https://github.com/imshaiknasir/dom-inspector.git
cd dom-inspector
npm install
npm run install:browsers   # Playwright Chromium
```

Start the server manually:

```bash
npm run mcp:start
```

It speaks MCP over stdio and writes diagnostics to stderr only. Use an
absolute path to `mcp/server.js` in client configuration.

### Claude Code

Project `.mcp.json` (or the same `mcpServers` block in user config):

```json
{
  "mcpServers": {
    "dom-inspector": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/dom-inspector/mcp/server.js"]
    }
  }
}
```

CLI equivalent:

```bash
claude mcp add --transport stdio dom-inspector -- node /absolute/path/to/dom-inspector/mcp/server.js
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.dom-inspector]
command = "node"
args = ["/absolute/path/to/dom-inspector/mcp/server.js"]
```

### OpenCode

`opencode.json` in the project root, or the global OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "dom-inspector": {
        "type": "local",
        "command": ["node", "/absolute/path/to/dom-inspector/mcp/server.js"]
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "dom-inspector": {
      "command": "node",
      "args": ["/absolute/path/to/dom-inspector/mcp/server.js"]
    }
  }
}
```

## Common arguments

Every tool accepts exactly one source:

| Field | Type | Notes |
| --- | --- | --- |
| `url` | string | Page URL loaded in Chromium (`http`, `https`, `file`, `data`). |
| `html` | string | Raw HTML loaded with `page.setContent`. |
| `waitUntil` | `"load" \| "domcontentloaded" \| "networkidle" \| "commit"` | Default `domcontentloaded`. |
| `timeoutMs` | integer 1000–120000 | Default `15000`. |
| `viewport` | `{ "width"?: integer, "height"?: integer }` | Default 1280×800. Matters for coordinates and responsive pages. |

`generate_locators` additionally requires `target` with exactly one of `css`,
`xpath`, `text`, `playwright`, or `coordinates`.

All results are JSON in `content[0].text` and in `structuredContent`. A tool
failure returns `isError: true` with `{ "ok": false, "error": "..." }`.

## End-to-end example

```json
{"name": "list_elements", "arguments": {
  "url": "https://shop.example.test/cart",
  "selector": "button",
  "limit": 10
}}
```

```json
{"name": "generate_locators", "arguments": {
  "url": "https://shop.example.test/cart",
  "target": { "text": "Checkout", "exact": true }
}}
```

```json
{"name": "verify_locator", "arguments": {
  "url": "https://shop.example.test/cart",
  "locator": "page.getByRole('button', { name: 'Checkout', exact: true })"
}}
```

```json
{"name": "heal_locator", "arguments": {
  "url": "https://shop.example.test/cart",
  "locator": "button.checkout",
  "index": 0,
  "prefer": "playwright"
}}
```

## Limits

- Closed shadow roots and cross-origin frames remain inaccessible, as in a
  browser. Open shadow roots and same-origin iframes are supported.
- Playwright role, name, and text counting is the extension's local DOM
  approximation; it is not a full accessibility-tree implementation.
- Generated JavaScript locators are Playwright expressions with `page.` already
  included. Selenium and Cypress snippets are derived from verified CSS/XPath.
- Healing is heuristic when a locator has no usable tokens. A result is only
  reported as verified when the replacement matches exactly one element.
