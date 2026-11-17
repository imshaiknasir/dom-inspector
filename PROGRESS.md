# Progress

Clean-room MV3 build. Legend: **done**, **partial**, **todo**, **n/a** (deliberately
not shipped). Last updated 17 Nov 2026.

## Surfaces and layout

| Feature | Status | Notes |
|---|---|---|
| MV3 shell (worker, content scripts, DevTools page) | done | `manifest.json`, `src/background.js`, `src/devtools/` |
| DevTools Elements sidebar pane | done | `createSidebarPane` → `panel/panel.html` |
| Chrome side panel | done | same panel; toolbar icon opens it |
| Toolbar action popup (pick, panel, healing, recent, copy) | done | `src/popup/*`; `action.default_popup` in manifest |
| Recent pick history in popup | done | panel stores the latest distinct picks; popup lists and clears them |
| Popup keyboard shortcuts | done | `P` pick, `O` open, `H` healing, `R` refresh, `C` copy last |
| Shared panel for both surfaces | done | `src/panel/*`; detects `chrome.devtools` |
| Element information card | done | tag, id, classes, role, accessible name, text, visibility, URL, frame/shadow context |
| Light/dark theme | done | `prefers-color-scheme` and responsive CSS |
| Narrow side-panel layout | done | verified at 300–430 px; per-row actions wrap |

## Picking

| Feature | Status | Notes |
|---|---|---|
| Hover overlay and click to pick | done | `content/picker.js` |
| Cancel with Stop / `Esc` | done | panel button + key handling |
| Continuous picking mode | done | panel toggle sends `continuous: true` |
| Picks inside open shadow roots and same-origin iframes | done | all-frame content scripts; payload carries chain |
| Closed shadow root / cross-origin iframe message | partial | refused by browsers; badge/hint only |
| Restore last picked element | done | `DI_GET_LAST` + `chrome.storage.session` fallback |
| Context-menu pick and copy-best actions | done | worker context menus + content bridge |

## Locator generation

| SelectorsHub row / family | Status | Notes |
|---|---|---|
| CSS — id, tag+id, attributes, classes, path | done | ranked, escaped, dynamic values filtered |
| CSS — unique gate and counts | done | every candidate counted in its root |
| CSS — parent-id / ancestor / absolute nth path | done | `css.js` |
| Relative XPath — attributes | done | id, test ids, name, aria-label, placeholder, title, alt, role, type, value |
| Relative XPath — text/contains/starts-with/own text | done | `xpath.js` |
| Absolute XPath | done | `/html[1]/body[1]/…[n]` |
| Index XPath / `(expr)[n]` | done | position retained in panel |
| Axes XPath (parent/child/ancestor/descendant/following/preceding/sibling) | done | engine + panel Axes ref flow and reference chip |
| XPath in shadow DOM | n/a | explicitly unavailable, same as browsers |
| SVG XPath (`local-name()` / `name()`) | done | engine |
| Iframe/frame chain | done | context badge, frame list, `frameLocator`, Selenium switch |
| testRigor path | done | `formats.js`; displayed in the panel format rows |
| Playwright test-id / role / label / placeholder | done | exact + regex role names |
| Playwright text / alt / title / CSS / ID | done | plus `:visible`, `:has-text`, `:text-is`, `:text` |
| Playwright nth/first/last fallback | done | `.nth()` fallback when nothing is unique |
| Playwright `frameLocator` chains | done | generated inside same-origin frames |
| Playwright language conversion (JS/Python/Java/C#) | partial | panel-side best-effort; Java/C# option objects not compiler-verified |
| Selenium id/name/className/tagName/linkText/partialLinkText | done | rendered as `By.*` with counts |
| Selenium cssSelector/xpath values | done | `By.cssSelector` / `By.xpath` |
| Cypress `cy.get` / `cy.xpath` | done | `formats.js` |
| JS path and jQuery | done | `document.querySelector`, `$()` |
| Selenium frame-switch / shadow-root snippets | done | `formats.js` |
| Driver command templates + presets | done | panel template with `{selector}` and legacy placeholders |

## Panel / UX

| Feature | Status | Notes |
|---|---|---|
| Locator rows with strategy + count + unique/no-match state | done | colour-coded badges |
| Per-row copy | done | Clipboard API + `execCommand` fallback |
| Per-row Test / highlight | done | shared validator engine |
| Per-row Edit into tester | done | loads the raw test value |
| Per-row Save (star) | done | deduped by type+raw value |
| Copy one section / copy all visible | done | respects filter and unique-only |
| Filter locators; unique-only mode | done | instant row re-render |
| Collapse/expand sections; persisted | done | settings in `chrome.storage.local` |
| Export all locators to JSON | done | includes element, counts, raw values, saved list |
| Saved locator names editable | done | lightweight POM/list |
| Saved locator import / export | done | JSON import (deduped) + JSON/CSV export |
| Saved locators → Playwright POM snippet | done | `POM` downloads a `PageLocators` class with testable saved entries |
| Saved locator delete / clear | done | confirm before clearing all |
| Editable locator tester with live count | done | debounced, no highlight while typing |
| Test & highlight + clear | done | scrolls first match into view |
| Click / Hover / Type action tester | partial | best-effort via `chrome.scripting`; one frame, open roots only |
| Playwright `await` toggle | done | JavaScript output only |
| Scroll DOM / show matching node | partial | test highlights and scrolls to first match |
| Attribute filter / row visibility checkboxes | partial | text + strategy filters (ID/attribute/class/text/path/semantic); no per-attribute generation filter |
| Batch/POM multi-column table, XLS import/export | partial | saved list + JSON/CSV export; no grid/spreadsheet import |
| Batch selector healing | done | paste lines, check counts, flag broken/non-unique, fix via repair engine with unique-candidate verification, JSON/CSV report |
| Fix-selector repair loop | done | `content/repair.js`; panel batch fix verifies every suggestion and tries unique CSS/XPath/Playwright candidates |
| Single-locator Fix in tester | done | **Fix** calls `DI_FIX`, replaces the input and re-validates/highlights |
| Recorder / TestCase Studio | todo | out of scope |
| Ads / login / profile / premium gates | n/a | intentionally removed; everything is local |

## Validation and messaging

| Feature | Status | Notes |
|---|---|---|
| Auto-detect CSS / XPath / Playwright | done | `validate.js` + panel live badge |
| Match counts for typed locators | done | content engine, per frame |
| Parser error reporting | done | native CSS/XPath/engine errors |
| Highlight all matches, scroll first | done | `validate.highlight` |
| Multi-frame aggregate counts | partial | count comes from a responding frame |
| Versioned message contract | partial | explicit `DI_*` messages; worker also caches last pick |
| Local-only storage | done | `di:panel:*`; no sync/remote |

## Tests, docs and quality

| Item | Status | Notes |
|---|---|---|
| Unit suites (CSS/XPath/Playwright/formats/validate/util/manifest) | done | 150/150 checks pass |
| Panel contract tests | done | ids, duplicate ids and local scripts checked |
| Extension e2e suites | done | 25/25 checks, including popup, axes, tester Fix, POM export/import, settings recovery and batch healing |
| Panel smoke test | done | headless Chrome with stubbed extension API |
| README with install, features, architecture, limits | done | this folder |
| No build step (plain JS/HTML/CSS) | done | no WASM, Rust, TypeScript or bundler |
| No copied SelectorsHub code/names/branding | done | clean-room implementation |

## Commit log (this repo)

- `208e50c` MV3 shell, picker, CSS/XPath/Playwright generators
- `a9bf045` panel UI, service worker routing, 16 tests
- `3e7c6ad` CSS attribute escaping + Playwright nth fallback
- `f64f6f8` Playwright `:has-text`/`:text-is` evaluation
- `e7c1da5` Selenium frame/shadow snippets
- `b8cad3d` regex role locator variant
- `5a18693` continuous picking option
- `c3eba97` docs
- `70968af` docs commit references
- `c4b36b2` panel expansion: polished UI, language output, saved/export, action tester
- `8e797c0` panel axes reference flow + batch selector healing
- `ab39b4f` toolbar popup with pick/open/recent/copy
- `c16566b` testRigor and Cypress-shadow format labels
- `4d718d9` tester result wording matches the validation contract
- `d270c92` single-locator Fix action in the tester
- `11ab1e4` recent pick history in the popup
- `1382440` saved locators → Playwright page-object snippet
- `ad3b49f` sanitize persisted settings and reserved POM method names
- `683f880` strategy filter for locator rows
- `5521d32` batch-fix non-unique selectors with verified unique candidates
- `855a2cd` richer copied element summary
- `15d29a1` saved-locator JSON import
- `3328d0a` narrow-healing-header layout fix
- `e154f6a` non-unique counts in healing summaries
- `e47ee2b` popup keyboard shortcuts

## Next candidates

1. Multi-column POM grid with reorder and spreadsheet import.
2. Attribute filter and per-row visibility controls.
3. Aggregate match counts across frames and a choose-frame flow for actions.
4. Popup history paging beyond the latest four distinct picks.
5. Optional locator diffing between consecutive picks.
