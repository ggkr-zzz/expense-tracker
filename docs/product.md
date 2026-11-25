# Expense Tracker v1 — product spec

## Purpose

A person opens the site, records an expense in one short form, sees how much they have spent and where it went, and can correct or remove an entry later.

## Decisions

| Topic | Decision |
|---|---|
| Form factor | A web app that looks like a terminal: monospace type, one flat background, bordered panels, bracketed controls, a status line. It uses ordinary labelled controls and works by keyboard, mouse and touch from 320 px wide. It is not a command-line program. |
| Storage | `localStorage` in the visitor's browser. One browser profile on one origin holds one ledger. No account, no server, no sync. |
| Currency | One currency, AUD, shown as `$1,234.50` (`en-AU`). |
| Week | Monday to Sunday. |
| Categories | Food, Transport, Bills, Shopping, Entertainment, Health, Other. Fixed list. |
| Theme | Light and dark. The first visit follows the operating system; the toggle stores an explicit choice. |
| PIN | The site asks for a four-digit PIN before it shows anything. The PIN is a constant in the code. It is a privacy screen, not security: see "PIN page". |
| Runtime | Static files only. No framework, no build step, no dependencies, no third-party requests. |

Currency, locale, week start, categories and limits are constants in `public/js/config.js`.

## Data

An expense is `{ id, amountCents, date, description, category }`.

| Field | Rule |
|---|---|
| `id` | Positive integer, assigned in creation order and never reused. It is both the identity and the creation order, and it survives edits. |
| `amountCents` | Integer from 1 to 100,000,000 ($0.01 to $1,000,000.00). |
| `date` | Local calendar date as `YYYY-MM-DD`, from 2000-01-01 to 2099-12-31. Future dates are allowed. |
| `description` | 1 to 100 characters after trimming and collapsing whitespace. |
| `category` | One of the seven category names. |

The ledger is `{ version: 1, nextId, expenses }`, stored as JSON under `expense-tracker.ledger.v1`. The theme choice is stored separately under `expense-tracker.theme`.

## Rules

**Money.** The amount field is a text input with a decimal keypad, not a number input, so a rejected value stays visible. Accepted: digits with up to two decimals (`12`, `12.5`, `12.50`, `.5`), an optional leading `$`, and commas only as well-formed thousands separators (`1,234.50`, but not `0,123` or `1,23`). The typed digits are converted straight to integer cents; no floating-point arithmetic touches money. Rejected with a specific message: empty, zero, negative, more than two decimals, a decimal comma (`12,50`), anything over the limit, anything else. An ambiguous amount is refused, never guessed.

**Dates.** A date is a string and is compared as a string. "Today" is the browser's local date and is passed into every calculation. Nothing parses `YYYY-MM-DD` with `new Date()` or reads the date with `toISOString()`, because both use UTC and move an Australian morning to the previous day. Totals and the form's default date refresh when the tab regains focus and when an open tab crosses midnight.

**Order.** Newest first: expense date descending, then `id` descending. The dashboard's recent list and the full list use the same order.

**Totals.** Today is expenses dated today. This week is Monday to Sunday containing today. This month is the calendar month containing today. All time is everything. A future-dated expense counts in a period it falls inside. Totals and the chart always use the whole ledger; filters never change them.

**Filters.** Description search is a case-insensitive substring match. Category, start date and end date narrow the list; all active filters apply together, either date bound works alone, and both ends are inclusive. A start date after the end date shows an explanation and no rows. One action clears every filter. Filters stay in place while moving between views and reset on reload. The list reports how many expenses match and their sum.

**Persistence.** Every change is read-modify-write: the ledger is re-read from storage, changed, and written back in one step, so a second tab can never overwrite the first tab's change. Other open tabs update when storage changes, except that an open form is left alone so nothing being typed is lost. A change is reported as saved only after the write succeeds, and submitting a form twice saves once.

**Failures.** Nothing is ever repaired by guessing.

| Situation | Behaviour |
|---|---|
| Invalid form input | Message beside the field, focus moves to the first problem, every typed value stays. |
| Write fails (storage full or refused) | The form stays open with its values and says the change was not saved. Stored data is untouched. |
| Storage blocked by the browser | A standing notice says expenses cannot be saved. Saving fails as above. |
| Saved data unreadable (bad JSON, unknown version, invalid record) | Normal views are replaced by a notice. The saved text is shown and left untouched, and no write can happen. The owner can start a new ledger, which first copies the old text to `expense-tracker.ledger.v1.backup-<timestamp>`. |
| Edit link for an expense that no longer exists | A message and a link back, no form. |

## PIN page

Every new tab opens on a page that asks for the PIN, whatever address was requested. Until the PIN is entered, the navigation is hidden, the page title says only "Locked", and nothing from the ledger is on the page.

- The PIN is `ACCESS_PIN` in `public/js/config.js`. Setting it to an empty string turns the PIN page off.
- The right PIN opens the view the address asked for. Spaces around it are ignored. A wrong or empty PIN shows a message, clears the field and keeps focus there. There is no limit on attempts.
- The tab stays unlocked across reloads and is forgotten when the tab closes (session storage). Each tab asks separately. If the browser blocks session storage, the PIN works but is asked for again after every reload.
- A Lock control in the header returns to the PIN page at once and clears the list filters.

**What it does not do.** The site is static, so the PIN ships to every visitor inside the page's JavaScript, and the expenses sit unencrypted in the browser's storage. Anyone who views the page source can read the PIN, and anyone with the device can read the storage directly. The PIN keeps a casual visitor or someone glancing at an open laptop out; it does not protect against anyone who looks. It must not be a PIN used anywhere else. Real protection would need a server or a hosting-level password.

## Views

Navigation uses the URL hash, so Back, Forward, reload and direct links work on any static host: `#/`, `#/expenses`, `#/add`, `#/edit/<id>`.

**Dashboard (`#/`).** Four totals (Today, This week, This month, All time), each with the dates it covers. The category chart. The five most recent expenses with a link to the full list. An empty ledger shows zero totals, no chart, and an invitation to add the first expense.

**Expenses (`#/expenses`).** Search, category, start date and end date controls, a clear action, the match count and sum, then every matching expense with its date, description, category and amount, plus Edit and Delete. Separate empty states for "no expenses yet" and "nothing matches".

**Form (`#/add`, `#/edit/<id>`).** One form for both. Fields: amount, date, description, category. A new expense defaults to today and has no category selected. An edit opens with all four values filled in. Save writes and returns to the view the form was opened from; Cancel returns there without writing. Opened from a direct link, both return to the dashboard.

**Delete.** A dialog names the expense (description, amount, date, category). Cancel has focus by default. Only Confirm deletes.

**Status line.** Announces the result of each save, edit and delete to screen readers and sighted users.

## Category chart

A pie chart of all-time spending is an explicit requirement. Colour alone cannot identify seven slices for colour-blind readers, so identity never depends on it.

- Slices run clockwise from 12 o'clock, largest first, and the table beside the chart lists categories in the same order with a colour swatch, a key letter, the exact amount and the share. The table lists all seven categories, including those at $0.00, and a total row. It is the text equivalent of the chart.
- Each slice of 4% or more carries its key letter (F, T, B, S, E, H, O) outside the pie. Slices are separated by a 2 px gap in the background colour. Pointing at a slice or a table row highlights both.
- Shares are whole percentages that always add up to 100. A category with spending whose share rounds to nothing shows `<1%`.
- A colour belongs to its category, never to its rank. Six categories use slots 1 to 6 of the palette below; Other is a neutral grey.

| Category | Light | Dark |
|---|---|---|
| Food | `#257de0` | `#338ced` |
| Transport | `#f47230` | `#e76624` |
| Bills | `#00b894` | `#00a888` |
| Shopping | `#f2a600` | `#d28e05` |
| Entertainment | `#ee7fac` | `#e24d8b` |
| Health | `#008a17` | `#0aac23` |
| Other | `#666666` | `#9c9c9c` |

These values were checked against the chart backgrounds (`#ffffff` light, `#191919` dark) for lightness, chroma, colour-blind separation of neighbours and contrast. Do not change one without re-running that check; see `docs/delivery.md`.

## Look and accessibility

- System monospace font, one background colour, 1 px borders, panel titles sitting on the border, bracketed navigation, inverse video for the current page, a status line at the bottom.
- Text contrast is at least 4.5:1 in both themes. Focus is always visible. Errors are marked by text, not only colour.
- Every control has a visible label. Edit and Delete controls name their expense for screen readers. Changing view moves focus to the new view's heading, or to the first field of the form.
- The saved theme is applied before first paint, and native controls follow it.
- User text is always inserted as text. The page has a Content-Security-Policy that allows only its own scripts and styles.

## URL parameters

| Parameter | Effect |
|---|---|
| `?profile=<name>` | Uses a separate ledger named by lowercase letters, digits and hyphens. The acceptance run uses `e2e` so it never touches real data. |
| `?today=YYYY-MM-DD` | Treats that date as today. Used by the acceptance run to get known totals. |

## Out of scope for v1

Accounts and sync, multiple currencies, custom categories, budgets, recurring expenses, import and export, keyboard shortcuts, offline install.

## Requirement traceability

| Requested function | Where it is specified |
|---|---|
| Add expense: amount, date, description, category | Form; Data; Rules → Money, Dates |
| View expenses, newest first | Expenses view; Rules → Order |
| Edit expense | Form (`#/edit/<id>`) |
| Delete expense | Delete |
| Filter by date range and category; searchable list | Rules → Filters; Expenses view |
| Persist locally across refresh and reopen | Decisions → Storage; Rules → Persistence, Failures |
| Totals: today, this week, this month, all time | Rules → Totals; Dashboard |
| Assign category; total by category; pie chart | Data; Category chart |
| Views: dashboard, expense list, expense form | Views |
| Terminal look, optional dark mode | Decisions → Form factor, Theme; Look and accessibility |
| A PIN page before entering the site, PIN hardcoded | Decisions → PIN; PIN page |
| Deploy on Vercel | `docs/delivery.md` → Deployment |
