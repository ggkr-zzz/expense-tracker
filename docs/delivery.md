# Delivery plan and acceptance

`docs/product.md` says what to build. This file says in what order, how to tell it is right, and what has actually been checked.

## Build order

| Step | Work | Done when |
|---|---|---|
| 1 | Data model and calculations: money, dates, ledger, filters, chart arithmetic, stored format | `npm test` passes, including the known-answer walkthrough below |
| 2 | One complete flow through the page: add, save, reload, edit, reload, delete, reload | The same walkthrough passes in a real browser |
| 3 | Dashboard, category chart, expense list and filters | Category amounts add up to the all-time total; both lists share one order; filters combine and clear |
| 4 | Failure handling and presentation | Invalid input, a failed write, blocked storage and unreadable data each behave as specified; both themes; keyboard only; 320 px wide |
| 5 | Deployment | The deployed checks at the end of this file pass on a Vercel preview |

## Known-answer walkthrough

Today is fixed to **Wednesday 8 April 2026**. Enter these five expenses (the browser run enters them out of date order on purpose).

| Date | Description | Category | Typed amount | AUD |
|---|---|---|---|---:|
| 2026-03-31 | Pharmacy | Health | `4` | 4.00 |
| 2026-04-05 (Sunday) | Bus | Transport | `$1.00` | 1.00 |
| 2026-04-06 (Monday) | Lunch | Food | `2.00` | 2.00 |
| 2026-04-07 | Apple | Food | `.1` | 0.10 |
| 2026-04-08 | Tea | Food | `0.20` | 0.20 |

| Step | Expected |
|---|---|
| Totals | Today $0.20 · This week $2.30 · This month $3.30 · All time $7.30 |
| Order | Tea, Apple, Lunch, Bus, Pharmacy |
| Categories | Health $4.00 (55%), Food $2.30 (31%), Transport $1.00 (14%); the other four $0.00; shares add to 100 |
| Filter: Food, 6 to 7 April | Apple, Lunch · 2 of 5 · $2.10 |
| Add search `APP` | Apple only. Dashboard totals unchanged |
| Reload | Everything above still holds |
| Edit Tea to $0.30, Other; reload | Today $0.30 · Week $2.40 · Month $3.40 · All time $7.40. Food $2.10, Other $0.30. Tea keeps its place and its id |
| Delete Tea: cancel | Tea is still there |
| Delete Tea: confirm; reload | Today $0.00 · Week $2.10 · Month $3.10 · All time $7.10 |

Further cases with fixed answers:

| Case | Expected |
|---|---|
| Same ledger, today = Sunday 12 April | Week still $2.30 (Sunday is the last day of the week that began on Monday 6 April) |
| Same ledger, today = Monday 13 April | Week $0.00, month $3.30 |
| Same ledger, today = Sunday 5 April | Today $1.00, week $5.00 (30 March to 5 April), month $3.30 |
| Today = 1 January 2026 | The week is 29 December 2025 to 4 January 2026 |
| 14:30 UTC on 7 April, in Sydney | Today is 2026-04-08 |
| 05:30 UTC on 8 April, in Los Angeles | Today is 2026-04-07 |
| `0.29`, `1.15`, `4.35`, `19.99` | 29, 115, 435 and 1999 cents exactly |
| `0.10` plus `0.20` | $0.30 |
| Two expenses on one date | The one created last is listed first, and editing the other does not move it |
| Description `<img src=x onerror=...> <b>bold</b>` | Shown as those characters; no image or bold element is created |
| A second tab adds an expense, then this tab adds one | Both are kept |
| Saved text is `{broken` | The app explains, shows the text, writes nothing, and starting over keeps a backup |

## Where each check runs

| Check | `npm test` | `npm run test:e2e` |
|---|---|---|
| Money, dates, week and month boundaries, time zones | yes | |
| Ordering, filters, totals, category totals, shares | yes | acceptance pass |
| Stored format: what is refused, what is never overwritten | yes | acceptance pass |
| Known-answer walkthrough | yes (`tests/acceptance.test.js`) | acceptance pass, through the real controls |
| Form validation messages, focus, values kept | | acceptance pass |
| Failed write, unreadable data, newer version, second tab | yes (storage) | acceptance pass |
| Theme toggle and persistence, navigation, focus, labels | | acceptance pass |
| PIN page: what matches, what a tab remembers, locking | yes (`tests/lock.test.js`) | acceptance pass, starting locked |
| Enter the PIN, add, delete and lock using only Tab, Enter, Escape and typing | | keyboard pass |
| Bare address, real clock, midnight passing, all storage blocked | | edge-case pass |
| No script errors, failed requests or policy violations | | every pass |
| Layout in both themes at 1100, 390 and 320 px | | `--screenshots`, then look |

## Colour check for the category chart

The seven colours in `docs/product.md` were measured against the backgrounds they are drawn on (`#ffffff` and `#191919`): lightness band, chroma, separation of neighbouring colours for protanopia and deuteranopia (distance in OKLab ×100, target 8 or more), separation under normal vision (15 or more), and contrast with the background.

| Result | Light | Dark |
|---|---|---|
| Slots 1 to 6 in order, worst neighbouring pair, colour-blind | 11.8 | 10.1 |
| Slots 1 to 6 in order, worst neighbouring pair, normal vision | 20.5 | 21.1 |
| Grey for Other against every other colour, worst pair, colour-blind | 10.6 | 3.1 (against Bills) |
| Colours below 3:1 against the background | Transport, Bills, Shopping, Entertainment | none |

Neighbours pass, but a pie puts any two categories side by side once some have no spending, and several of those pairs do not separate (Transport and Shopping; Bills and Entertainment for colour-blind readers). No seven-colour set passes for every pair. That is why the chart never relies on colour: key letters, the ordered table with exact figures, 2 px gaps and linked highlighting carry identity. Keep those if the colours change, and re-measure any new colour the same way.

## Deployment on Vercel

`vercel.json` holds every setting, so the project needs no dashboard overrides.

| Setting | Value | Why |
|---|---|---|
| `framework` | `null` | The "Other" preset: no framework detection |
| `installCommand` | `""` | Skips install; there are no dependencies |
| Build command | none | `package.json` has no `build` script, so there is nothing to run |
| `outputDirectory` | `public` | Only the app is published. Tests, documents and prompts are not |
| `headers` | `nosniff`, no framing, no referrer | The page's own Content-Security-Policy is a `<meta>` tag in `index.html`, so it applies locally too |

Checked against the Vercel documentation on 2026-11-25: the Other preset serves `public` when it exists; `framework: null` selects it; an empty `installCommand` skips install. The documentation does not say how a missing build script is handled for the Other preset, so confirm in the first deployment's build log that no build ran.

To deploy, either import the Git repository at vercel.com/new and accept the defaults, or run `npx vercel` for a preview and `npx vercel --prod` for production.

Deployed checks, to run on the preview URL before calling it released:

1. The site opens on the PIN page. A wrong PIN is refused; the right one opens the dashboard, with no errors in the browser console.
2. Add an expense, reload, and it is still there without the PIN being asked for again. Edit it, switch theme, reload again.
3. Open `<url>/#/expenses` directly in a new tab.
4. `<url>/tests/e2e/`, `<url>/docs/product.md` and `<url>/package.json` all return 404.
5. `curl -sI <url>` shows `x-content-type-options: nosniff` and `x-frame-options: DENY`.

Each deployment URL is a separate origin with its own browser storage. Expenses entered on a preview URL do not appear on the production domain, so use disposable data on previews.

## Definition of done

- `npm test` and `npm run test:e2e` pass.
- Screenshots of every view have been looked at in both themes at desktop, phone and 320 px widths.
- An independent reviewer has followed `prompts/review.md` and every finding that reproduces is fixed.
- The verification log below says what was run, with results, and what was not verified.

## Verification log

### 2026-11-26 — first build

Run on macOS with Node 24.22.1 (the runtime bundled with VS Code; the machine has no system Node or npm, so the commands behind the npm scripts were run directly) and Chrome 158.

| What was run | Result |
|---|---|
| `node --test` | 72 of 72 tests pass |
| `node tests/e2e/run.js`, acceptance pass | 128 of 128 checks pass |
| `node tests/e2e/run.js`, keyboard pass (real Tab, Enter, Escape and typing) | 9 of 9 checks pass |
| `node tests/e2e/run.js`, edge cases (bare address, real clock, midnight, blocked storage, 320 px with worst-case content) | 11 of 11 checks pass |
| Script errors, failed requests and Content-Security-Policy violations during those passes | none reported |
| `node tests/e2e/run.js --screenshots`: 7 views × 2 themes × 4 widths (1100, 720, 390, 320 px) | 56 saved; about 20 looked at, covering every view, both themes and all four widths |
| One-off probe, not kept in the repository: 828,000 spellings of amounts and 300,000 garbage strings against a BigInt reader; every day from 2000 to 2099 against an independent calendar; local dates across daylight-saving changes in 8 time zones; 200,000 share sets; 50,000 pies; hostile stored JSON; totals against a brute-force recount | no failures |
| Category colours through a palette validator (lightness, chroma, colour-blind and normal-vision separation, contrast) | results in "Colour check" above |

Defects these checks found, all fixed and covered by a check now:

- A confirmation dialog's late `close` event could answer the next dialog, so cancelling and immediately confirming again deleted twice.
- Date filters overlapped on desktop; a long category name ran into Edit and Delete on phones; the category table overflowed at 320 px; date ranges broke in the middle of a date.
- `0,123` was read as $123.00. It is now refused as ambiguous.
- Submitting the form twice before the view changed could have saved twice.
- Percentage shares used floating-point division; they now use whole-number arithmetic throughout.

Review: the plan calls for an independent reviewer. At the owner's request this build was reviewed by its implementer instead, using `prompts/review.md` as the checklist. An independent pass is still worth doing.

Not verified:

- **Deployment.** Nothing has been deployed; this machine has no Vercel access. `vercel.json` was checked against the documentation only. Run the deployed checks above on the first preview.
- **Other browsers and real devices.** Only Chrome on macOS was used. Safari, Firefox, iOS and Android have not been tried.
- **Assistive technology.** Labels, roles, focus order and keyboard operation were checked by script. No screen reader was used, and forced-colours mode was not tried.
- **`npm test` and `npm run test:e2e` as typed.** npm is not installed here; the commands they run were executed directly with Node 24. Node 20 and 22 were not tried.

### 2026-11-26 — PIN page

Same machine and versions as above.

| What was run | Result |
|---|---|
| `node --test` | 81 of 81 tests pass |
| `node tests/e2e/run.js`, acceptance pass, now starting at the PIN page | 146 of 146 checks pass |
| `node tests/e2e/run.js`, keyboard pass, now entering the PIN and locking by keyboard | 13 of 13 checks pass |
| `node tests/e2e/run.js`, edge cases, now with session storage blocked as well | 13 of 13 checks pass |
| Script errors, failed requests and Content-Security-Policy violations | none reported |
| `--screenshots`: 9 views × 2 themes × 4 widths | 72 saved; the PIN page, its error state and the header with the Lock control looked at |

Not verified: the same items as the first build. The PIN page was reviewed by its implementer only.
