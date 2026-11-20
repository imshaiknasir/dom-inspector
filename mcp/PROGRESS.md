# MCP server progress

Last updated: 20 Nov 2026

## Done

- Read the job objective and audited the extension's shared locator modules
  (`src/content/util.js`, `css.js`, `xpath.js`, `playwright.js`, `formats.js`,
  `validate.js`, `repair.js`) and the existing Playwright harness/tests.
- Confirmed `@modelcontextprotocol/sdk` 1.32.x and zod 3.25 are installed.
- Created the folder skeleton for `mcp/`, `tests/mcp/` and `skills/`.

- Browser-backed MCP server (stdio) that injects the existing content modules
  into Playwright Chromium pages, with tools `generate_locators`,
  `verify_locator`, `heal_locator` and `list_elements`.
- Implemented `mcp/lib/browser.js` (lazy Chromium lifecycle, CSP-safe module
  injection, frame iteration), `mcp/lib/probe.js` (browser-side analysis,
  verify, heal and list), `mcp/lib/tools.js` (zod schemas + handlers) and
  `mcp/server.js` (official SDK stdio server, JSON results, shutdown).
- Added `tests/mcp/server.test.js` with the official SDK stdio client covering
  every tool, URL and raw-HTML sources, CSS/XPath/text/coordinates targets,
  frames, shadow roots, uniqueness and input validation.
- Added npm scripts `mcp:start` and `test:mcp`; added MCP tests to CI.
- Verified locally: `test:unit` (245 pass, 5 known todo), `test:e2e` (54 pass)
  and `test:mcp` (13 pass).

## In progress

- Skill map and install/config documentation.

## Next

- Write `skills/*/SKILL.md` plus `skills/README.md` (install/config snippets
  for Claude Code, Codex, OpenCode, Cursor).
- Update `README.md` with MCP server and Skill map sections.
- Commit and push, then verify GitHub Actions with `gh run list`.
