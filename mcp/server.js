#!/usr/bin/env node
'use strict';

/* DOM Inspector MCP server.
 *
 * Stdio Transport + official @modelcontextprotocol/sdk. Every tool opens an
 * isolated Playwright Chromium page, injects the extension's own locator
 * modules, and returns structured JSON. Nothing is written to stdout except
 * MCP protocol frames; diagnostics go to stderr.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ToolInputError, inputSchemas, handlers } = require('./lib/tools');
const { closeBrowser } = require('./lib/browser');

const SERVER_NAME = 'dom-inspector';
const SERVER_VERSION = '1.0.0';

const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data
});

const failure = (error) => {
  const inputError = error instanceof ToolInputError;
  const missingBrowser = /Executable doesn't exist|browserType\.launch/.test(String(error && error.message));
  const message = missingBrowser
    ? `${error.message}\nChromium is not installed for Playwright. Run: npm run install:browsers`
    : error && error.message ? error.message : String(error);
  console.error(`[${SERVER_NAME}] ${inputError ? 'invalid input' : 'tool failure'}: ${message}`);
  const payload = {
    ok: false,
    error: message,
    errorType: inputError ? 'invalid-input' : 'tool-error'
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true
  };
};

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

const createServer = () => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, {
    instructions:
      'Use list_elements to discover targets, generate_locators to create a locator for a known element, ' +
      'verify_locator to check an existing locator, and heal_locator only when a locator is broken or ' +
      'matches several elements. Always check verify_locator.unique or heal_locator.verified.unique before trusting a locator.'
  });

  server.registerTool('generate_locators', {
    title: 'Generate verified locators',
    description:
      'Locate one element on a URL or raw HTML in Playwright Chromium and return ranked CSS, XPath, ' +
      'Playwright, Selenium, and Cypress locators with live match counts. Use this first when you need ' +
      'a locator and do not already have one. Every returned candidate was counted against the real page.',
    inputSchema: inputSchemas.generate_locators,
    annotations: READ_ONLY
  }, async (args) => {
    try {
      return ok(await handlers.generate_locators(args));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool('verify_locator', {
    title: 'Verify a locator',
    description:
      'Test a CSS, XPath, or Playwright locator against a URL or raw HTML in Playwright Chromium. ' +
      'Returns the detected type, match count, uniqueness, parser errors, and the first matching elements. ' +
      'Use this before trusting a pasted locator, or after editing one by hand.',
    inputSchema: inputSchemas.verify_locator,
    annotations: READ_ONLY
  }, async (args) => {
    try {
      return ok(await handlers.verify_locator(args));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool('heal_locator', {
    title: 'Heal a broken or non-unique locator',
    description:
      'Repair a broken CSS/XPath/Playwright locator or make a non-unique locator unique. ' +
      'Normalizes and re-validates broken input, then falls back to the extension repair engine; for ' +
      'non-unique input, pick a match with index and regenerate a unique locator. The replacement is ' +
      're-verified against the live page and returned with CSS, XPath, Playwright, Selenium, and Cypress forms.',
    inputSchema: inputSchemas.heal_locator,
    annotations: READ_ONLY
  }, async (args) => {
    try {
      return ok(await handlers.heal_locator(args));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool('list_elements', {
    title: 'List interactive elements',
    description:
      'List elements on a URL or raw HTML in Playwright Chromium, including open shadow roots and ' +
      'same-origin iframes. Defaults to visible interactive controls and returns a best unique locator ' +
      '(CSS, XPath, Playwright) plus role, accessible name, and text for each. Use this to discover ' +
      'what can be targeted before calling generate_locators.',
    inputSchema: inputSchemas.list_elements,
    annotations: READ_ONLY
  }, async (args) => {
    try {
      return ok(await handlers.list_elements(args));
    } catch (error) {
      return failure(error);
    }
  });

  return server;
};

const main = async () => {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] ready on stdio (v${SERVER_VERSION})`);

  let closing = false;
  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    try { await server.close(); } catch (_) { /* already closed */ }
    await closeBrowser();
    process.exit(code);
  };

  process.on('SIGINT', () => { shutdown(0); });
  process.on('SIGTERM', () => { shutdown(0); });
  process.stdin.on('end', () => { shutdown(0); });
  process.on('unhandledRejection', (error) => {
    console.error(`[${SERVER_NAME}] unhandled rejection: ${error && error.stack || error}`);
  });
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[${SERVER_NAME}] fatal: ${error && error.stack || error}`);
    process.exit(1);
  });
}

module.exports = { createServer, SERVER_NAME, SERVER_VERSION };
