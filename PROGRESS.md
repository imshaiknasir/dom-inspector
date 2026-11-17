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

## Commits

- `208e50c` MV3 shell, picker, CSS/XPath/Playwright generators
- `a9bf045` panel UI, service worker routing, 16 tests
- `3e7c6ad` CSS attribute escaping + Playwright nth fallback
- `f64f6f8` Playwright `:has-text`/`:text-is` evaluation
- `e7c1da5` Selenium frame/shadow snippets
- `2b2f1a0` regex role locator variant (see `git log`)

## Remaining / next

- [ ] Batch/POM table and export/import.
- [ ] XPath-healing batch mode.
- [ ] DevTools-side continuous inspector shortcut (picker supports the flag).
- [ ] ARIA accname parity and Playwright actionability-aware counts.
- [ ] Optional Firefox port (MV3 sidebar differences).
