import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addExpense,
  categoryTotals,
  emptyLedger,
  filterExpenses,
  filterProblem,
  findExpense,
  hasActiveFilters,
  parseLedger,
  periodTotals,
  removeExpense,
  serializeLedger,
  sortExpenses,
  sumCents,
  updateExpense,
  validateDraft,
} from "../public/js/ledger.js";

const TODAY = "2026-04-08"; // a Wednesday

/** The acceptance fixture from docs/delivery.md, entered oldest first. */
function fixtureLedger() {
  const entries = [
    { date: "2026-03-31", description: "Pharmacy", category: "Health", amountCents: 400 },
    { date: "2026-04-05", description: "Bus", category: "Transport", amountCents: 100 },
    { date: "2026-04-06", description: "Lunch", category: "Food", amountCents: 200 },
    { date: "2026-04-07", description: "Apple", category: "Food", amountCents: 10 },
    { date: "2026-04-08", description: "Tea", category: "Food", amountCents: 20 },
  ];
  return entries.reduce((ledger, fields) => addExpense(ledger, fields).ledger, emptyLedger());
}

const descriptions = (expenses) => expenses.map((expense) => expense.description);

// ---- validation ---------------------------------------------------------------------------

test("a complete draft becomes clean fields", () => {
  const result = validateDraft({ amount: " $12.5 ", date: "2026-04-08", description: "  Flat   white \n", category: "Food" });
  assert.deepEqual(result, {
    ok: true,
    fields: { amountCents: 1250, date: "2026-04-08", description: "Flat white", category: "Food" },
  });
});

test("every bad field is reported at once", () => {
  const result = validateDraft({ amount: "", date: "", description: "   ", category: "" });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["amount", "category", "date", "description"]);
});

test("individual field rules", () => {
  const good = { amount: "1", date: "2026-04-08", description: "x", category: "Other" };
  assert.equal(validateDraft(good).ok, true);
  assert.equal(validateDraft({ ...good, amount: "0" }).errors.amount, "Amount must be more than zero.");
  assert.equal(validateDraft({ ...good, date: "2026-02-30" }).errors.date, "Enter a real date from 2000-01-01 to 2099-12-31, like 2026-04-08.");
  assert.equal(validateDraft({ ...good, date: "" }).errors.date, "Choose a date.");
  assert.equal(validateDraft({ ...good, description: "x".repeat(100) }).ok, true);
  assert.equal(validateDraft({ ...good, description: "x".repeat(101) }).errors.description, "Keep the description to 100 characters.");
  assert.equal(validateDraft({ ...good, category: "Groceries" }).errors.category, "Choose a category.");
  assert.equal(validateDraft({ ...good, category: "food" }).errors.category, "Choose a category.");
});

test("markup in a description is kept as plain text", () => {
  const result = validateDraft({ amount: "1", date: TODAY, description: "<b>bold</b> & <img src=x onerror=alert(1)>", category: "Other" });
  assert.equal(result.fields.description, "<b>bold</b> & <img src=x onerror=alert(1)>");
});

// ---- changes ------------------------------------------------------------------------------

test("ids are handed out in creation order and never reused", () => {
  let ledger = emptyLedger();
  const first = addExpense(ledger, { amountCents: 100, date: TODAY, description: "a", category: "Food" });
  ledger = first.ledger;
  const second = addExpense(ledger, { amountCents: 200, date: TODAY, description: "b", category: "Food" });
  ledger = second.ledger;
  assert.equal(first.expense.id, 1);
  assert.equal(second.expense.id, 2);
  ledger = removeExpense(ledger, 2).ledger;
  const third = addExpense(ledger, { amountCents: 300, date: TODAY, description: "c", category: "Food" });
  assert.equal(third.expense.id, 3, "a deleted id is not reused");
});

test("changes return a new ledger and leave the old one alone", () => {
  const before = fixtureLedger();
  const snapshot = structuredClone(before);
  addExpense(before, { amountCents: 1, date: TODAY, description: "x", category: "Other" });
  updateExpense(before, 5, { amountCents: 30, date: TODAY, description: "Tea", category: "Other" });
  removeExpense(before, 5);
  assert.deepEqual(before, snapshot);
});

test("editing keeps the id and changes every field", () => {
  const { ledger, expense } = updateExpense(fixtureLedger(), 5, {
    amountCents: 30,
    date: "2026-04-07",
    description: "Green tea",
    category: "Other",
  });
  assert.deepEqual(expense, { id: 5, amountCents: 30, date: "2026-04-07", description: "Green tea", category: "Other" });
  assert.deepEqual(findExpense(ledger, 5), expense);
  assert.equal(ledger.expenses.length, 5);
  assert.equal(ledger.nextId, 6);
});

test("editing or deleting a missing expense reports it instead of guessing", () => {
  const ledger = fixtureLedger();
  assert.equal(updateExpense(ledger, 99, { amountCents: 1, date: TODAY, description: "x", category: "Other" }), null);
  assert.equal(removeExpense(ledger, 99), null);
  assert.equal(findExpense(ledger, 99), null);
});

test("deleting removes exactly one expense", () => {
  const { ledger, expense } = removeExpense(fixtureLedger(), 5);
  assert.equal(expense.description, "Tea");
  assert.deepEqual(descriptions(ledger.expenses), ["Pharmacy", "Bus", "Lunch", "Apple"]);
});

// ---- order --------------------------------------------------------------------------------

test("newest expense date first", () => {
  assert.deepEqual(descriptions(sortExpenses(fixtureLedger().expenses)), ["Tea", "Apple", "Lunch", "Bus", "Pharmacy"]);
});

test("same date: the entry created last comes first, and an edit does not move it", () => {
  let ledger = emptyLedger();
  for (const description of ["first", "second", "third"]) {
    ledger = addExpense(ledger, { amountCents: 100, date: TODAY, description, category: "Food" }).ledger;
  }
  assert.deepEqual(descriptions(sortExpenses(ledger.expenses)), ["third", "second", "first"]);
  ledger = updateExpense(ledger, 1, { amountCents: 999, date: TODAY, description: "first (edited)", category: "Bills" }).ledger;
  assert.deepEqual(descriptions(sortExpenses(ledger.expenses)), ["third", "second", "first (edited)"]);
});

test("sorting does not reorder the ledger itself", () => {
  const ledger = fixtureLedger();
  sortExpenses(ledger.expenses);
  assert.deepEqual(descriptions(ledger.expenses), ["Pharmacy", "Bus", "Lunch", "Apple", "Tea"]);
});

// ---- totals -------------------------------------------------------------------------------

test("fixture totals for Wednesday 8 April 2026", () => {
  const totals = periodTotals(fixtureLedger().expenses, TODAY);
  assert.equal(totals.today, 20);
  assert.equal(totals.week, 230, "Monday 6 April to Sunday 12 April; Sunday 5 April is last week");
  assert.equal(totals.month, 330, "31 March is last month");
  assert.equal(totals.all, 730);
  assert.deepEqual(totals.weekRange, { start: "2026-04-06", end: "2026-04-12" });
  assert.deepEqual(totals.monthRange, { start: "2026-04-01", end: "2026-04-30" });
});

test("the same ledger on other days", () => {
  const expenses = fixtureLedger().expenses;
  // Sunday 12 April is still in the week that started on Monday 6 April.
  assert.deepEqual(pick(periodTotals(expenses, "2026-04-12")), { today: 0, week: 230, month: 330, all: 730 });
  // Monday 13 April starts a new week.
  assert.deepEqual(pick(periodTotals(expenses, "2026-04-13")), { today: 0, week: 0, month: 330, all: 730 });
  // Sunday 5 April belongs to the week of Monday 30 March, which also holds 31 March.
  assert.deepEqual(pick(periodTotals(expenses, "2026-04-05")), { today: 100, week: 500, month: 330, all: 730 });
  // 31 March: its month is March.
  assert.deepEqual(pick(periodTotals(expenses, "2026-03-31")), { today: 400, week: 500, month: 400, all: 730 });
  // 1 May: nothing this month.
  assert.deepEqual(pick(periodTotals(expenses, "2026-05-01")), { today: 0, week: 0, month: 0, all: 730 });
});

test("a week that spans New Year counts both years", () => {
  let ledger = emptyLedger();
  for (const [date, amountCents] of [["2025-12-28", 1], ["2025-12-29", 10], ["2025-12-31", 100], ["2026-01-01", 1000], ["2026-01-04", 10000], ["2026-01-05", 100000]]) {
    ledger = addExpense(ledger, { amountCents, date, description: date, category: "Other" }).ledger;
  }
  const totals = periodTotals(ledger.expenses, "2026-01-01");
  assert.equal(totals.week, 11110, "29 December to 4 January");
  assert.equal(totals.month, 111000, "January only");
  assert.equal(totals.today, 1000);
});

test("a future-dated expense counts in the periods it falls inside", () => {
  const ledger = addExpense(emptyLedger(), { amountCents: 500, date: "2026-04-10", description: "Rent due", category: "Bills" }).ledger;
  assert.deepEqual(pick(periodTotals(ledger.expenses, TODAY)), { today: 0, week: 500, month: 500, all: 500 });
});

test("an empty ledger totals zero", () => {
  assert.deepEqual(pick(periodTotals([], TODAY)), { today: 0, week: 0, month: 0, all: 0 });
  assert.equal(sumCents([]), 0);
});

test("category totals list every category and add up to the all-time total", () => {
  const totals = categoryTotals(fixtureLedger().expenses);
  assert.deepEqual(totals, [
    { category: "Food", cents: 230 },
    { category: "Transport", cents: 100 },
    { category: "Bills", cents: 0 },
    { category: "Shopping", cents: 0 },
    { category: "Entertainment", cents: 0 },
    { category: "Health", cents: 400 },
    { category: "Other", cents: 0 },
  ]);
  assert.equal(totals.reduce((sum, entry) => sum + entry.cents, 0), 730);
});

// ---- filters ------------------------------------------------------------------------------

test("filters combine, and date bounds include both ends", () => {
  const sorted = sortExpenses(fixtureLedger().expenses);
  const filter = (filters) => descriptions(filterExpenses(sorted, filters));

  assert.deepEqual(filter({}), ["Tea", "Apple", "Lunch", "Bus", "Pharmacy"]);
  assert.deepEqual(filter({ category: "Food" }), ["Tea", "Apple", "Lunch"]);
  assert.deepEqual(filter({ category: "Food", from: "2026-04-06", to: "2026-04-07" }), ["Apple", "Lunch"]);
  assert.deepEqual(filter({ category: "Food", from: "2026-04-06", to: "2026-04-07", search: "APP" }), ["Apple"]);
  assert.deepEqual(filter({ from: "2026-04-06" }), ["Tea", "Apple", "Lunch"], "start date alone");
  assert.deepEqual(filter({ to: "2026-04-05" }), ["Bus", "Pharmacy"], "end date alone");
  assert.deepEqual(filter({ from: "2026-04-05", to: "2026-04-05" }), ["Bus"], "a one-day range");
  assert.deepEqual(filter({ search: "  u  " }), ["Lunch", "Bus"], "search is trimmed and matches inside words");
  assert.deepEqual(filter({ search: "zzz" }), []);
  assert.deepEqual(filter({ category: "Bills" }), []);
});

test("a reversed date range matches nothing and says why", () => {
  const reversed = { from: "2026-04-07", to: "2026-04-06" };
  assert.deepEqual(filterExpenses(fixtureLedger().expenses, reversed), []);
  assert.equal(filterProblem(reversed), "The start date is after the end date, so nothing can match.");
  assert.equal(filterProblem({ from: "2026-04-06", to: "2026-04-06" }), null);
  assert.equal(filterProblem({ from: "2026-04-06" }), null);
  assert.equal(filterProblem({}), null);
});

test("knowing whether any filter is active", () => {
  assert.equal(hasActiveFilters({ search: "", category: "", from: "", to: "" }), false);
  assert.equal(hasActiveFilters({ search: "   " }), false);
  assert.equal(hasActiveFilters({ search: "a" }), true);
  assert.equal(hasActiveFilters({ category: "Food" }), true);
  assert.equal(hasActiveFilters({ from: "2026-04-06" }), true);
  assert.equal(hasActiveFilters({ to: "2026-04-06" }), true);
});

test("filtering leaves totals alone", () => {
  const expenses = fixtureLedger().expenses;
  const filtered = filterExpenses(expenses, { category: "Food" });
  assert.equal(sumCents(filtered), 230);
  assert.equal(periodTotals(expenses, TODAY).all, 730);
});

// ---- stored form --------------------------------------------------------------------------

test("a ledger survives being stored and read back", () => {
  const ledger = fixtureLedger();
  assert.deepEqual(parseLedger(serializeLedger(ledger)), { ok: true, ledger });
});

test("nothing stored means an empty ledger", () => {
  assert.deepEqual(parseLedger(null), { ok: true, ledger: emptyLedger() });
});

test("unreadable stored data is reported, never repaired", () => {
  const good = { id: 1, amountCents: 100, date: TODAY, description: "ok", category: "Food" };
  const ledgerWith = (expenses, nextId = 10) => JSON.stringify({ version: 1, nextId, expenses });
  const cases = {
    "empty text": "",
    "not JSON": "{oops",
    "a JSON string": '"hello"',
    "a JSON array": "[]",
    "JSON null": "null",
    "a newer version": JSON.stringify({ version: 2, nextId: 1, expenses: [] }),
    "no version": JSON.stringify({ nextId: 1, expenses: [] }),
    "no expense list": JSON.stringify({ version: 1, nextId: 1 }),
    "no id counter": JSON.stringify({ version: 1, expenses: [] }),
    "a fractional amount": ledgerWith([{ ...good, amountCents: 1.5 }]),
    "a zero amount": ledgerWith([{ ...good, amountCents: 0 }]),
    "an amount as text": ledgerWith([{ ...good, amountCents: "100" }]),
    "an amount over the limit": ledgerWith([{ ...good, amountCents: 100000001 }]),
    "an impossible date": ledgerWith([{ ...good, date: "2026-02-30" }]),
    "an unknown category": ledgerWith([{ ...good, category: "Groceries" }]),
    "a blank description": ledgerWith([{ ...good, description: "  " }]),
    "a description that is too long": ledgerWith([{ ...good, description: "x".repeat(101) }]),
    "a missing id": ledgerWith([{ ...good, id: undefined }]),
    "a duplicate id": ledgerWith([good, { ...good }]),
    "an id the counter has not reached": ledgerWith([good], 1),
    "an entry that is not an object": ledgerWith([null]),
  };
  for (const [name, text] of Object.entries(cases)) {
    const result = parseLedger(text);
    assert.equal(result.ok, false, name);
    assert.equal(typeof result.reason, "string", name);
    assert.notEqual(result.reason, "", name);
  }
});

test("unknown extra fields are not kept", () => {
  const text = JSON.stringify({ version: 1, nextId: 2, expenses: [{ id: 1, amountCents: 100, date: TODAY, description: "ok", category: "Food", extra: true }] });
  assert.deepEqual(parseLedger(text).ledger.expenses, [{ id: 1, amountCents: 100, date: TODAY, description: "ok", category: "Food" }]);
});

function pick({ today, week, month, all }) {
  return { today, week, month, all };
}
