# Build or change Expense Tracker

Bring this repository to the behaviour described in `docs/product.md`. Follow `AGENTS.md`. `docs/delivery.md` is the acceptance checklist and the record of what has been verified.

1. **Look first.** Read the three documents above, the current code, and `git status`. Run `npm test` and `npm run test:e2e` to see where things stand. Keep existing work that already meets the spec.
2. **Work in the delivery order.** Pure logic with tests, then one complete add → save → reload flow, then the rest of the views, then failure handling and presentation. Finish a step's checks before starting the next.
3. **Prove it.** Run the unit tests and the browser acceptance run. Look at the app in a browser, or at the screenshots, in both themes and at phone width. Fix what fails and rerun the affected checks.
4. **Get an independent review.** Give a fresh reviewer `prompts/review.md`. Fix every finding that reproduces and rerun the checks it touches.
5. **Make it deployable.** Check `vercel.json` against the Vercel documentation current on the day. Deploy only if the owner has asked for it and access exists; then run the deployed checks in `docs/delivery.md`.
6. **Report.** Add an entry to the verification log in `docs/delivery.md`: what you ran, the result, and what you could not verify. Then tell the owner the same, briefly.

Use the documented defaults for routine choices. Stop and ask the owner for anything in the "Ask the owner first" list in `AGENTS.md`.
