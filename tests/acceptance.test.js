// The known-answer walkthrough from docs/delivery.md, run against the same modules the page
// uses, with every "reload" opening a fresh store on the same storage. It needs no browser,
// so it runs anywhere `npm test` does; tests/e2e repeats it through the real page.

import assert from "node:assert/strict";
import { test } from "node:test";

import { addExpense, categoryTotals, filterExpenses, periodTotals, removeExpense, sortExpenses, sumCents, updateExpense, validateDraft } from "../public/js/ledger.js";
import { formatCents } from "../public/js/money.js";
import { createLedgerStore, storageKeys } from "../public/js/storage.js";
import { fakeStorage } from "./helpers/fake-storage.js";

const TODAY = "2026-04-08"; // a Wednesday

test("the delivery fixture, start to finish", () => {
  const storage = fakeStorage();
  /** What a freshly loaded page would show. */
  const reload = () => {
    const loaded = createLedgerStore(storage, storageKeys().ledger).load();
    assert.equal(loaded.status, "ok");
    const { expenses } = loaded.ledger;
    const totals = periodTotals(expenses, TODAY);
    return {
      expenses: sortExpenses(expenses),
      totals: Object.fromEntries(["today", "week", "month", "all"].map((period) => [period, formatCents(totals[period])])),
      categories: Object.fromEntries(categoryTotals(expenses).filter((entry) => entry.cents > 0).map((entry) => [entry.category, formatCents(entry.cents)])),
    };
  };
  const store = () => createLedgerStore(storage, storageKeys().ledger);
  /** Goes through the same validation as the form. */
  const submit = (draft, id = null) => {
    const checked = validateDraft(draft);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    const saved = store().update((ledger) => (id === null ? addExpense(ledger, checked.fields) : updateExpense(ledger, id, checked.fields)));
    assert.equal(saved.ok, true, saved.reason);
    return saved.expense;
  };
  const descriptions = (expenses) => expenses.map((expense) => expense.description);

  // A fresh ledger.
  assert.deepEqual(reload().totals, { today: "$0.00", week: "$0.00", month: "$0.00", all: "$0.00" });

  // Enter the five records as typed text, out of date order.
  submit({ amount: "2.00", date: "2026-04-06", description: "Lunch", category: "Food" });
  submit({ amount: "4", date: "2026-03-31", description: "Pharmacy", category: "Health" });
  const tea = submit({ amount: "0.20", date: "2026-04-08", description: "Tea", category: "Food" });
  submit({ amount: "$1.00", date: "2026-04-05", description: "Bus", category: "Transport" });
  submit({ amount: ".1", date: "2026-04-07", description: "Apple", category: "Food" });

  let page = reload();
  assert.deepEqual(descriptions(page.expenses), ["Tea", "Apple", "Lunch", "Bus", "Pharmacy"]);
  assert.deepEqual(page.totals, { today: "$0.20", week: "$2.30", month: "$3.30", all: "$7.30" });
  assert.deepEqual(page.categories, { Food: "$2.30", Transport: "$1.00", Health: "$4.00" });

  // Filter to Food from 6 to 7 April, then search.
  const food = filterExpenses(page.expenses, { category: "Food", from: "2026-04-06", to: "2026-04-07" });
  assert.deepEqual(descriptions(food), ["Apple", "Lunch"]);
  assert.equal(formatCents(sumCents(food)), "$2.10");
  assert.deepEqual(descriptions(filterExpenses(page.expenses, { category: "Food", from: "2026-04-06", to: "2026-04-07", search: "APP" })), ["Apple"]);
  assert.deepEqual(reload().totals, page.totals, "filtering changes no totals");

  // Change Tea to $0.30 and Other.
  submit({ amount: "0.30", date: "2026-04-08", description: "Tea", category: "Other" }, tea.id);
  page = reload();
  assert.deepEqual(page.totals, { today: "$0.30", week: "$2.40", month: "$3.40", all: "$7.40" });
  assert.deepEqual(page.categories, { Food: "$2.10", Transport: "$1.00", Health: "$4.00", Other: "$0.30" });
  assert.equal(page.expenses[0].id, tea.id, "the edited expense keeps its place");

  // Delete Tea.
  assert.equal(store().update((ledger) => removeExpense(ledger, tea.id)).ok, true);
  page = reload();
  assert.deepEqual(descriptions(page.expenses), ["Apple", "Lunch", "Bus", "Pharmacy"]);
  assert.deepEqual(page.totals, { today: "$0.00", week: "$2.10", month: "$3.10", all: "$7.10" });

  // Two entries on one date, ten cents and twenty cents.
  submit({ amount: "0.10", date: TODAY, description: "ten", category: "Other" });
  submit({ amount: "0.20", date: TODAY, description: "twenty", category: "Other" });
  page = reload();
  assert.deepEqual(descriptions(page.expenses).slice(0, 2), ["twenty", "ten"]);
  assert.equal(page.totals.today, "$0.30");
});
