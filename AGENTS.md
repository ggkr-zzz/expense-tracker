# Expense Tracker — agent guide

A static, single-page expense tracker with a terminal look. No backend, no build step, no dependencies. Expenses live in the visitor's browser.

`docs/product.md` says what the app does and why. `docs/delivery.md` holds the acceptance checks and the record of what has been verified. Read both before changing behaviour, and update them in the same change when a decision moves.

## Commands

| Task | Command |
|---|---|
| Unit tests | `npm test` (`node --test`, Node 20+) |
| Browser acceptance run, headless | `npm run test:e2e` (`node tests/e2e/run.js`, Node 22+ and Chrome) |
| Serve locally | `npm start` (`python3 -m http.server 4173`), then open `http://localhost:4173/public/` |
| Browser acceptance run, visible | with the server running, open `http://localhost:4173/tests/e2e/` |
| Screenshots of every view | `node tests/e2e/run.js --screenshots screenshots` |

If Node is not installed but VS Code is, its bundled runtime works as `node`:
`ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --test`

## Layout

| Path | Contents |
|---|---|
| `public/` | Everything that is deployed, and nothing else. |
| `public/js/config.js` | Currency, locale, week start, categories, limits. |
| `public/js/money.js`, `dates.js`, `ledger.js`, `chart.js`, `routes.js` | Pure logic. No DOM, no storage, no clock. |
| `public/js/storage.js` | The only code that reads or writes `localStorage`. |
| `public/js/app.js` | The only code that touches the page. |
| `tests/*.test.js` | Unit tests for the pure modules and storage. |
| `tests/e2e/` | The browser acceptance run and its headless runner. |
| `prompts/` | Task prompts: `build.md`, `review.md`. |

## Rules that keep it correct

- **Money is integer cents.** Parse what was typed as text. Never multiply a decimal by 100 and never store a fraction.
- **Dates are `YYYY-MM-DD` strings in the local calendar.** Never `new Date("YYYY-MM-DD")` and never `toISOString()` for a calendar date; both are UTC. Pass today's date into calculations.
- **User text is untrusted.** Put it on the page as text nodes. No `innerHTML`. The page's Content-Security-Policy allows no inline script or style, so add neither.
- **Never overwrite data that failed to load.** Every write goes through `store.update()`, which re-reads first. Report success only after the write succeeded.
- **Logic stays out of `app.js`.** A new calculation goes in a pure module with a test.
- **Colour never carries meaning alone.** Chart colours were validated as a set; changing one means re-validating (see `docs/delivery.md`).
- **`public/` stays self-contained.** Relative URLs only, no third-party requests.

## Working here

1. One implementer owns a change from start to finish.
2. For a logic change, write or update the failing test first.
3. Before saying a change is done, run `npm test` and `npm run test:e2e`, and look at the result in a browser or in the screenshots.
4. Have a fresh reviewer follow `prompts/review.md`. The reviewer reads and runs but does not edit; the implementer fixes and reruns the affected checks.
5. Record what was run and its result in the verification log in `docs/delivery.md`. Say plainly what could not be verified.

## Ask the owner first

- Adding a dependency, a build step, a framework or a network request.
- Changing where or how expenses are stored, or the shape of the saved ledger.
- Anything that needs an account or publishes something: deploying, pushing, changing project settings.
- Deleting or overwriting work you did not create.
