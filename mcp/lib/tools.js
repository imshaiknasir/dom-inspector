'use strict';

/* Tool schemas and handlers for the DOM Inspector MCP server. */

const { z } = require('zod');
const {
  withPage,
  findTarget,
  verifyInPage,
  healInPage,
  listInPage
} = require('./browser');

class ToolInputError extends Error {}

const waitUntil = z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional()
  .describe('Navigation readiness to wait for. Defaults to domcontentloaded.');

const timeoutMs = z.number().int().min(1000).max(120000).optional()
  .describe('Navigation and evaluation timeout in milliseconds. Defaults to 15000.');

const viewport = z.object({
  width: z.number().int().min(200).max(4000).optional().describe('Viewport width in CSS pixels. Defaults to 1280.'),
  height: z.number().int().min(200).max(4000).optional().describe('Viewport height in CSS pixels. Defaults to 800.')
}).optional().describe('Viewport used for coordinate targets and responsive pages.');

const sourceShape = {
  url: z.string().min(1).optional()
    .describe('Page URL to load in Chromium (http, https, file, or data). Provide url or html, not both.'),
  html: z.string().min(1).optional()
    .describe('Raw HTML to load with page.setContent. Provide url or html, not both.'),
  waitUntil,
  timeoutMs,
  viewport
};

const targetShape = z.object({
  css: z.string().min(1).optional().describe('CSS selector used to find the target element.'),
  xpath: z.string().min(1).optional().describe('XPath expression used to find the target element.'),
  text: z.string().min(1).optional()
    .describe('Visible text matched with Playwright getByText semantics (smallest matching element).'),
  exact: z.boolean().optional().describe('With text targets, require an exact normalized match. Defaults to false.'),
  playwright: z.string().min(1).optional()
    .describe('A Playwright locator expression, with or without the leading page. (e.g. page.getByRole(...)).'),
  coordinates: z.object({
    x: z.number().describe('Viewport x coordinate in CSS pixels.'),
    y: z.number().describe('Viewport y coordinate in CSS pixels.')
  }).optional().describe('Viewport coordinates resolved with elementFromPoint, piercing open shadow roots.'),
  index: z.number().int().min(0).optional()
    .describe('Zero-based match index when the target selector matches several elements. Defaults to 0.')
}).describe('Exactly one target method: css, xpath, text, playwright, or coordinates.');

const inputSchemas = {
  generate_locators: {
    ...sourceShape,
    target: targetShape,
    maxCandidates: z.number().int().min(1).max(50).optional()
      .describe('Maximum candidates returned per locator family. Defaults to 12.')
  },

  verify_locator: {
    locator: z.string().min(1).describe('The CSS, XPath, or Playwright locator to test.'),
    type: z.enum(['auto', 'css', 'xpath', 'playwright']).optional()
      .describe('Locator language. Defaults to auto-detection.'),
    maxMatches: z.number().int().min(1).max(50).optional()
      .describe('Maximum matched elements described in the result. Defaults to 10.'),
    ...sourceShape
  },

  heal_locator: {
    locator: z.string().min(1).describe('The broken or non-unique CSS, XPath, or Playwright locator.'),
    type: z.enum(['auto', 'css', 'xpath', 'playwright']).optional()
      .describe('Locator language. Defaults to auto-detection.'),
    index: z.number().int().min(0).optional()
      .describe('Zero-based match index to repair toward when the input matches several elements. Defaults to 0.'),
    prefer: z.enum(['playwright', 'css', 'xpath']).optional()
      .describe('Preferred output format for a healed locator. Defaults to playwright, then unique fallbacks.'),
    ...sourceShape
  },

  list_elements: {
    selector: z.string().min(1).optional()
      .describe('CSS selector to list. Defaults to common interactive controls.'),
    limit: z.number().int().min(1).max(200).optional()
      .describe('Maximum elements returned. Defaults to 25.'),
    includeHidden: z.boolean().optional()
      .describe('Include elements without a visible rendered box. Defaults to false.'),
    ...sourceShape
  }
};

const describeSource = (input) => input.url
  ? { kind: 'url', url: input.url }
  : { kind: 'html', bytes: Buffer.byteLength(input.html, 'utf8') };

const assertSource = (input) => {
  const hasUrl = typeof input.url === 'string' && input.url.trim().length > 0;
  const hasHtml = typeof input.html === 'string' && input.html.length > 0;
  if (hasUrl === hasHtml) {
    throw new ToolInputError('Provide exactly one of url or html.');
  }
};

const assertTarget = (target) => {
  const keys = ['css', 'xpath', 'text', 'playwright', 'coordinates']
    .filter((key) => target && target[key] !== undefined && target[key] !== null && target[key] !== '');
  if (keys.length !== 1) {
    throw new ToolInputError('target must provide exactly one of css, xpath, text, playwright, or coordinates.');
  }
};

const primaryLocators = (analysis) => {
  if (!analysis) {
    return { css: null, xpath: null, playwright: null, selenium: null, cypress: null };
  }
  return {
    css: analysis.css && analysis.css.best ? analysis.css.best.value : null,
    xpath: analysis.xpath && analysis.xpath.best ? analysis.xpath.best.value : null,
    playwright: analysis.playwright && analysis.playwright.best ? analysis.playwright.best.value : null,
    selenium: analysis.selenium
      ? analysis.selenium.snippets.css || analysis.selenium.snippets.xpath || null
      : null,
    cypress: analysis.cypress ? analysis.cypress.css || analysis.cypress.xpath || null : null
  };
};

const formatAnalysis = (analysis) => {
  if (!analysis) {
    return {
      element: null,
      locators: primaryLocators(null),
      css: null,
      xpath: null,
      playwright: null,
      selenium: null,
      cypress: null,
      recommended: null
    };
  }
  return {
    element: analysis.element,
    frameLocators: analysis.frameLocators,
    locators: primaryLocators(analysis),
    css: analysis.css,
    xpath: analysis.xpath,
    playwright: analysis.playwright,
    selenium: analysis.selenium,
    cypress: analysis.cypress,
    recommended: analysis.recommended
  };
};

const pageInfo = async (page) => ({
  url: page.url(),
  title: await page.title().catch(() => '')
});

const generateLocators = async (input) => {
  assertSource(input);
  assertTarget(input.target);
  const target = {
    ...input.target,
    maxCandidates: input.maxCandidates || 12
  };
  const { page, found } = await withPage(input, async (page) => ({
    page: await pageInfo(page),
    found: await findTarget(page, target)
  }));
  const analysis = found.analysis;
  return {
    ok: true,
    source: describeSource(input),
    page,
    target: {
      method: found.type,
      matchCount: found.matchCount,
      selectedIndex: found.selectedIndex || 0,
      frameIndex: found.frameIndex,
      frameUrl: found.frameIndex > 0 && found.frame ? found.frame.url() : null
    },
    element: analysis.element,
    frameLocators: analysis.frameLocators,
    locators: primaryLocators(analysis),
    css: analysis.css,
    xpath: analysis.xpath,
    playwright: analysis.playwright,
    selenium: analysis.selenium,
    cypress: analysis.cypress,
    recommended: analysis.recommended
  };
};

const verifyLocator = async (input) => {
  assertSource(input);
  const type = input.type || 'auto';
  const { page, result } = await withPage(input, async (page) => ({
    page: await pageInfo(page),
    result: await verifyInPage(page, type, input.locator, input.maxMatches || 10)
  }));
  return {
    ok: result.ok,
    source: describeSource(input),
    page,
    locator: input.locator,
    type: result.type,
    matchCount: result.count,
    unique: result.unique,
    error: result.error,
    frame: result.frame || null,
    matches: result.matches,
    advice: result.unique
      ? 'Unique: this locator is safe to use.'
      : result.count === 0
        ? 'No match: call generate_locators on the intended element or heal_locator on this value.'
        : 'Non-unique: call heal_locator with an index to produce a unique locator.'
  };
};

const healLocator = async (input) => {
  assertSource(input);
  const type = input.type || 'auto';
  const index = Number.isInteger(input.index) ? input.index : 0;
  const prefer = input.prefer || 'playwright';
  const { page, healed, verification } = await withPage(input, async (page) => {
    const healed = await healInPage(page, input.locator, type, index, prefer);
    let verification = null;
    if (healed && healed.fixed) {
      verification = await verifyInPage(page, healed.choice ? healed.choice.format : 'auto', healed.fixed, 10);
    }
    return { page: await pageInfo(page), healed, verification };
  });
  return healedShape(input, page, healed, verification);
};

const healedShape = (input, page, healed, verification) => {
  const verified = verification
    ? {
      locator: healed.fixed,
      type: verification.type,
      matchCount: verification.count,
      unique: verification.unique,
      error: verification.error
    }
    : null;
  const ok = Boolean(healed && healed.ok && (!healed.fixed || (verified && verified.unique)));
  const status = healed ? healed.status : 'not-found';
  return {
    ok,
    status,
    reason: healed ? healed.reason || null : 'no-result',
    source: describeSource(input),
    page,
    input: {
      locator: input.locator,
      type: healed && healed.previous ? healed.previous.type : typeOrAuto(input.type)
    },
    previous: healed ? healed.previous || null : null,
    fixed: healed ? healed.fixed || null : null,
    selectedIndex: healed && Number.isInteger(healed.selectedIndex) ? healed.selectedIndex : null,
    choice: healed ? healed.choice || null : null,
    verified,
    error: healed ? healed.error || null : null,
    element: healed && healed.analysis ? healed.analysis.element : null,
    ...formatAnalysis(healed && healed.analysis),
    advice: status === 'valid'
      ? 'The locator was already unique; no change is required.'
      : ok
        ? 'Use fixed (or recommended) as the replacement locator; it was re-verified as unique.'
        : 'No unique replacement was found. Inspect the page and generate locators for the intended element.'
  };
};

const typeOrAuto = (type) => type || 'auto';

const listElements = async (input) => {
  assertSource(input);
  const selector = input.selector || null;
  const limit = input.limit || 25;
  const { page, listing } = await withPage(input, async (page) => ({
    page: await pageInfo(page),
    listing: await listInPage(page, selector, limit, Boolean(input.includeHidden))
  }));
  if (listing.errors && listing.errors.length && listing.total === 0 && !listing.elements.length) {
    throw new ToolInputError(listing.errors[0]);
  }
  return {
    ok: true,
    source: describeSource(input),
    page,
    selector: listing.selector || selector || 'interactive controls',
    totalMatched: listing.total,
    returned: listing.elements.length,
    framesScanned: listing.framesScanned,
    elements: listing.elements
  };
};

const handlers = {
  generate_locators: generateLocators,
  verify_locator: verifyLocator,
  heal_locator: healLocator,
  list_elements: listElements
};

module.exports = {
  ToolInputError,
  inputSchemas,
  handlers
};
