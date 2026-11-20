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

- Wrote `skills/README.md` plus `skills/{list-elements,generate-locators,verify-locator,heal-locator,locator-workflow}/SKILL.md`
  with exact tool names, argument tables, call/response examples, decision
  rules, and install/config snippets for Claude Code, Codex, OpenCode, Cursor.
- Updated `README.md` with MCP server and Skill map sections, and documented
  `npm run test:mcp`.

- Final verification: `npm test` passes end to end — 245 unit pass (5 known
  todo), 54 e2e pass, and 18 MCP cases pass.

## In progress

- None.

## Next

- No open work. To resume after a change, re-run `npm test` and check
  `gh run list --limit 3` for a green workflow.
