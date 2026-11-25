# Review Expense Tracker

You are reviewing work you did not write. Find what is wrong with it. Do not edit files: report, and the implementer fixes.

## What to read

`docs/product.md` is the specification. `docs/delivery.md` lists the acceptance checks. `AGENTS.md` lists the rules the code must keep. Then read the code under `public/` and the tests under `tests/`. If you were given a diff or a list of changed files, start there.

## What to run

- `npm test`
- `npm run test:e2e` when Chrome is available
- Anything else that would settle a doubt: a small script, a case the tests do not cover

A passing test suite is evidence about the cases it contains and nothing more. Look for the cases it does not contain.

## What matters most, in order

1. **Lost or corrupted data.** A write that can overwrite something it did not read. A failure reported as success. Saved data that an update, a second tab, or a bad value could make unreadable.
2. **Wrong numbers.** Cents that drift. Totals that disagree with the list. Shares that do not add up.
3. **Wrong days.** Anything that depends on UTC, on the weekday, on a month or year boundary, or on midnight passing while the page is open.
4. **Unsafe text.** Any path by which what a person typed could be treated as markup or code.
5. **Behaviour that differs from `docs/product.md`.** Including behaviour the spec requires and nothing tests.
6. **People who cannot use it.** Keyboard only, screen reader, 320 px wide, either theme, colour-blind.
7. **Deployment.** Anything that works locally and would break when only `public/` is served from the site root.

Style, naming and personal preference do not belong in the report unless they hide a defect.

## How to report

For each finding give:

- **Severity**: `breaks` (a user loses data or sees a wrong result), `wrong` (differs from the spec), or `risk` (plausible but not reproduced).
- **Where**: file and line.
- **How to see it**: the exact steps or input.
- **Expected and actual.**

Separate what you observed from what you suspect. End with the commands you ran and their results, and a list of anything you could not check. If you found nothing in an area, say that you looked and what you tried.
