# Progress

Milestone log for the clean-room build. All items committed in this folder.

## Done

- [x] M1 — MV3 shell: manifest, service worker, DevTools page, side panel.
- [x] M2 — Picker: overlay, hover/click, Escape/Stop, shadow/iframe context,
      single and continuous modes.
- [x] M3 — CSS engine: ID/test-id/name/aria/placeholder/class/attribute/path
      strategies, dynamic-value filtering, uniqueness counts, escaping.
- [x] M4 — XPath engine: relative (text/attrs/positional), absolute, indexed,
      axes (incl. siblings/ancestor/descendant/following/preceding), SVG,
      iframe chain, shadow refusal.
- [x] M5 — Playwright engine: getByTestId/Role(+regex)/Label/Placeholder/Text/
      AltText/Title, CSS/ID, engine pseudo-classes, filter/nth/first/last,
      frameLocator, and/or, nth fallback; local counting engine.
- [x] M6 — Formats: Selenium values, Cypress, JS path, jQuery, frame-switch and
      shadow-root snippets.
- [x] M7 — Validation + highlighting, shared engine for CSS/XPath/Playwright.
- [x] M8 — Panel: rows, counts, copy, test, language switch, validator, restore.
- [x] M9 — Tests: 16 browser-backed tests (`node --test`), all passing.
- [x] M10 — Chrome smoke load (`--load-extension`, no manifest errors).
- [x] M11 — Stability scores for CSS/XPath/Playwright candidates.
- [x] M12 — Cypress shadow chain + Selenium frame/shadow snippets.
- [x] M13 — Batch/locators page with copy/export JSON/CSV.
- [x] M14 — Saved locators (10) with use/copy/delete.
- [x] M15 — Heuristic XPath/CSS/Playwright healing over a pasted script.
- [x] M16 — Tests: 88 unit/browser generator tests + 7 extension e2e tests, all passing.
- [x] M17 — Axes reference-picking mode (two-click relative XPath).
- [x] M18 — Context-menu “Pick element with DOM Inspector”.
- [x] M19 — Playwright language converters (Python/Java/C#) and :visible counts.
- [x] M20 — E2E: extension loads, picker bridge works, CSS/XPath/Playwright/
      Selenium payload verified, shadow and iframe cases pass, continuous pick works,
      no page errors.

## Commits

- `208e50c` MV3 shell, picker, CSS/XPath/Playwright generators
- `a9bf045` panel UI, service worker routing, 16 tests
- `3e7c6ad` CSS attribute escaping + Playwright nth fallback
- `f64f6f8` Playwright `:has-text`/`:text-is` evaluation
- `e7c1da5` Selenium frame/shadow snippets
- `b8cad3d` regex role locator variant
- `5a18693` continuous picking option
- `c3eba97` docs
- `6854193` stability scores + Cypress shadow chain
- `d4a2c10` panel batch/saved/healing UI + 3 extra tests (this commit)

## Remaining / next

- [ ] Full POM class generation (current export is locator data, not page objects).
- [ ] Expose axes reference mode in the panel UI (content support is ready).
- [ ] Excel export/import for the batch table.
- [ ] DevTools-side continuous inspector shortcut (picker supports the flag).
- [ ] ARIA accname parity and Playwright actionability-aware counts.
- [ ] Optional Firefox port (MV3 sidebar differences).
