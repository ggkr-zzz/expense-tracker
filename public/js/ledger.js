// The ledger and everything derived from it. Pure functions: no DOM, no storage, no clock.
// Functions that change the ledger return a new one and leave the old one untouched.

import {
  CATEGORY_NAMES,
  MAX_AMOUNT_CENTS,
  MAX_DATE,
  MAX_DESCRIPTION_LENGTH,
  MIN_DATE,
  WEEK_STARTS_ON,
} from "./config.js";
import { inRange, isValidDate, monthRange, weekRange } from "./dates.js";
import { parseAmount } from "./money.js";

export const LEDGER_VERSION = 1;

export function emptyLedger() {
  return { version: LEDGER_VERSION, nextId: 1, expenses: [] };
}

/**
 * Form strings -> { ok: true, fields } or { ok: false, errors } with one message per bad field.
 */
export function validateDraft(draft) {
  const errors = {};

  const amount = parseAmount(draft.amount);
  if (!amount.ok) errors.amount = amount.error;

  const date = String(draft.date ?? "");
  if (date === "") errors.date = "Choose a date.";
  else if (!isValidDate(date)) {
    errors.date = `Enter a real date from ${MIN_DATE} to ${MAX_DATE}, like 2026-04-08.`;
  }

  const description = String(draft.description ?? "").trim().replace(/\s+/g, " ");
  if (description === "") errors.description = "Describe the expense.";
  else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Keep the description to ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  const category = String(draft.category ?? "");
  if (!CATEGORY_NAMES.includes(category)) errors.category = "Choose a category.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, fields: { amountCents: amount.cents, date, description, category } };
}

// ---- reading and writing the stored form ----------------------------------------------

function isStoredExpense(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isSafeInteger(value.id) &&
    value.id >= 1 &&
    Number.isSafeInteger(value.amountCents) &&
    value.amountCents >= 1 &&
    value.amountCents <= MAX_AMOUNT_CENTS &&
    isValidDate(value.date) &&
    typeof value.description === "string" &&
    value.description.trim() !== "" &&
    value.description.length <= MAX_DESCRIPTION_LENGTH &&
    CATEGORY_NAMES.includes(value.category)
  );
}

const unreadable = (reason) => ({ ok: false, reason });

/**
 * Stored text -> { ok: true, ledger } or { ok: false, reason }.
 * `null` means nothing has been saved yet. Anything unexpected is reported, never repaired.
 */
export function parseLedger(text) {
  if (text === null || text === undefined) return { ok: true, ledger: emptyLedger() };

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return unreadable("The saved data is not valid JSON.");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return unreadable("The saved data is not a ledger.");
  }
  if (data.version !== LEDGER_VERSION) {
    return unreadable(`The saved data is version ${JSON.stringify(data.version)}; this app reads version ${LEDGER_VERSION}.`);
  }
  if (!Array.isArray(data.expenses) || !Number.isSafeInteger(data.nextId) || data.nextId < 1) {
    return unreadable("The saved ledger is missing its expense list or id counter.");
  }

  const seen = new Set();
  const expenses = [];
  for (const [index, value] of data.expenses.entries()) {
    if (!isStoredExpense(value) || seen.has(value.id) || value.id >= data.nextId) {
      return unreadable(`Saved entry ${index + 1} is not a valid expense.`);
    }
    seen.add(value.id);
    const { id, amountCents, date, description, category } = value;
    expenses.push({ id, amountCents, date, description, category });
  }
  return { ok: true, ledger: { version: LEDGER_VERSION, nextId: data.nextId, expenses } };
}

export function serializeLedger(ledger) {
  return JSON.stringify(ledger);
}

// ---- changes ---------------------------------------------------------------------------

/** Ids are handed out in creation order and never reused. */
export function addExpense(ledger, fields) {
  const expense = { ...fields, id: ledger.nextId }; // the id is ours to assign, whatever `fields` holds
  return {
    ledger: { ...ledger, nextId: ledger.nextId + 1, expenses: [...ledger.expenses, expense] },
    expense,
  };
}

/** Returns null when there is no such expense. The id, and so the creation order, is kept. */
export function updateExpense(ledger, id, fields) {
  const index = ledger.expenses.findIndex((expense) => expense.id === id);
  if (index === -1) return null;
  const expense = { ...ledger.expenses[index], ...fields, id };
  const expenses = ledger.expenses.slice();
  expenses[index] = expense;
  return { ledger: { ...ledger, expenses }, expense };
}

/** Returns null when there is no such expense. */
export function removeExpense(ledger, id) {
  const expense = findExpense(ledger, id);
  if (!expense) return null;
  return {
    ledger: { ...ledger, expenses: ledger.expenses.filter((other) => other.id !== id) },
    expense,
  };
}

export function findExpense(ledger, id) {
  return ledger.expenses.find((expense) => expense.id === id) ?? null;
}

// ---- views of the data -----------------------------------------------------------------

/** Newest first: by expense date, then by the order entries were created. */
export function sortExpenses(expenses) {
  return [...expenses].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id - a.id;
  });
}

export const NO_FILTERS = Object.freeze({ search: "", category: "", from: "", to: "" });

/** All active filters apply together. Empty strings mean "no limit". Date bounds are inclusive. */
export function filterExpenses(expenses, filters = NO_FILTERS) {
  const { search = "", category = "", from = "", to = "" } = filters;
  const needle = search.trim().toLowerCase();
  return expenses.filter(
    (expense) =>
      (needle === "" || expense.description.toLowerCase().includes(needle)) &&
      (category === "" || expense.category === category) &&
      (from === "" || expense.date >= from) &&
      (to === "" || expense.date <= to),
  );
}

export function hasActiveFilters(filters = NO_FILTERS) {
  const { search = "", category = "", from = "", to = "" } = filters;
  return search.trim() !== "" || category !== "" || from !== "" || to !== "";
}

/** A message when the filters cannot match anything by construction, otherwise null. */
export function filterProblem(filters = NO_FILTERS) {
  const { from = "", to = "" } = filters;
  if (from !== "" && to !== "" && from > to) {
    return "The start date is after the end date, so nothing can match.";
  }
  return null;
}

export function sumCents(expenses) {
  return expenses.reduce((total, expense) => total + expense.amountCents, 0);
}

/** `today` is a "YYYY-MM-DD" string supplied by the caller, so results never depend on the clock. */
export function periodTotals(expenses, today, weekStartsOn = WEEK_STARTS_ON) {
  const week = weekRange(today, weekStartsOn);
  const month = monthRange(today);
  const totals = { today: 0, week: 0, month: 0, all: 0 };
  for (const expense of expenses) {
    totals.all += expense.amountCents;
    if (expense.date === today) totals.today += expense.amountCents;
    if (inRange(expense.date, week)) totals.week += expense.amountCents;
    if (inRange(expense.date, month)) totals.month += expense.amountCents;
  }
  return { ...totals, weekRange: week, monthRange: month };
}

/** One entry per category, in the configured order, including categories with nothing spent. */
export function categoryTotals(expenses, categoryNames = CATEGORY_NAMES) {
  const totals = new Map(categoryNames.map((name) => [name, 0]));
  for (const expense of expenses) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amountCents);
  }
  return categoryNames.map((category) => ({ category, cents: totals.get(category) }));
}
