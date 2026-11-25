import assert from "node:assert/strict";
import { test } from "node:test";

import { addExpense, emptyLedger, removeExpense, serializeLedger, updateExpense } from "../public/js/ledger.js";
import { createLedgerStore, storageKeys } from "../public/js/storage.js";
import { fakeStorage } from "./helpers/fake-storage.js";

const KEY = "expense-tracker.ledger.v1";
const TEA = { amountCents: 20, date: "2026-04-08", description: "Tea", category: "Food" };
const BUS = { amountCents: 100, date: "2026-04-05", description: "Bus", category: "Transport" };

test("storage keys, with and without a profile", () => {
  assert.deepEqual(storageKeys(), { ledger: "expense-tracker.ledger.v1", theme: "expense-tracker.theme" });
  assert.deepEqual(storageKeys("e2e"), { ledger: "expense-tracker.e2e.ledger.v1", theme: "expense-tracker.theme" });
  for (const bad of ["", "Has Space", "UPPER", "../x", "a".repeat(25)]) {
    assert.equal(storageKeys(bad).ledger, KEY, `profile ${JSON.stringify(bad)} is ignored`);
  }
});

test("nothing saved yet loads as an empty ledger", () => {
  const store = createLedgerStore(fakeStorage(), KEY);
  assert.deepEqual(store.load(), { status: "ok", ledger: emptyLedger(), raw: null });
});

test("a change is written and a fresh store reads it back", () => {
  const storage = fakeStorage();
  const result = createLedgerStore(storage, KEY).update((ledger) => addExpense(ledger, TEA));
  assert.equal(result.ok, true);
  assert.equal(result.expense.id, 1);

  const reopened = createLedgerStore(storage, KEY).load();
  assert.equal(reopened.status, "ok");
  assert.deepEqual(reopened.ledger.expenses, [{ id: 1, ...TEA }]);
});

test("a second tab's change is built on, not overwritten", () => {
  const storage = fakeStorage();
  const tabA = createLedgerStore(storage, KEY);
  const tabB = createLedgerStore(storage, KEY);

  tabA.load(); // tab A reads the empty ledger and sits there
  tabB.update((ledger) => addExpense(ledger, BUS));
  const result = tabA.update((ledger) => addExpense(ledger, TEA));

  assert.equal(result.ok, true);
  assert.deepEqual(result.ledger.expenses.map((expense) => [expense.id, expense.description]), [[1, "Bus"], [2, "Tea"]]);
});

test("editing an expense another tab deleted is reported", () => {
  const storage = fakeStorage();
  const tabA = createLedgerStore(storage, KEY);
  const tabB = createLedgerStore(storage, KEY);
  tabA.update((ledger) => addExpense(ledger, TEA));
  tabB.update((ledger) => removeExpense(ledger, 1));

  const result = tabA.update((ledger) => updateExpense(ledger, 1, { ...TEA, amountCents: 30 }));
  assert.deepEqual(result, { ok: false, status: "missing", reason: "That expense no longer exists." });
});

test("a failed write changes nothing and says so", () => {
  const storage = fakeStorage();
  const store = createLedgerStore(storage, KEY);
  store.update((ledger) => addExpense(ledger, TEA));
  const before = storage.getItem(KEY);

  storage.failWrites = "quota";
  const full = store.update((ledger) => addExpense(ledger, BUS));
  assert.deepEqual(full, { ok: false, status: "write-failed", reason: "Browser storage for this site is full." });

  storage.failWrites = "other";
  const refused = store.update((ledger) => addExpense(ledger, BUS));
  assert.deepEqual(refused, { ok: false, status: "write-failed", reason: "The browser refused to save the data." });

  assert.equal(storage.getItem(KEY), before);
});

test("unreadable data is never overwritten by a change", () => {
  const storage = fakeStorage({ [KEY]: "{not json" });
  const store = createLedgerStore(storage, KEY);

  const loaded = store.load();
  assert.equal(loaded.status, "unreadable");
  assert.equal(loaded.raw, "{not json");

  const result = store.update((ledger) => addExpense(ledger, TEA));
  assert.equal(result.ok, false);
  assert.equal(result.status, "unreadable");
  assert.equal(storage.getItem(KEY), "{not json");
});

test("a ledger from a newer version is left alone", () => {
  const newer = JSON.stringify({ version: 2, nextId: 5, expenses: [], somethingNew: true });
  const storage = fakeStorage({ [KEY]: newer });
  const store = createLedgerStore(storage, KEY);
  assert.equal(store.load().status, "unreadable");
  assert.equal(store.update((ledger) => addExpense(ledger, TEA)).ok, false);
  assert.equal(storage.getItem(KEY), newer);
});

test("starting over keeps a backup of what was there", () => {
  const storage = fakeStorage({ [KEY]: "{not json" });
  const store = createLedgerStore(storage, KEY);

  const result = store.startOver(1775606400000);
  assert.deepEqual(result, { ok: true, backupKey: `${KEY}.backup-1775606400000` });
  assert.equal(storage.getItem(`${KEY}.backup-1775606400000`), "{not json");
  assert.equal(storage.getItem(KEY), serializeLedger(emptyLedger()));
  assert.equal(store.load().status, "ok");
});

test("starting over with nothing saved makes no backup", () => {
  const storage = fakeStorage();
  assert.deepEqual(createLedgerStore(storage, KEY).startOver(1), { ok: true, backupKey: null });
  assert.deepEqual([...storage.data.keys()], [KEY]);
});

test("if the backup cannot be written, starting over changes nothing", () => {
  const storage = fakeStorage({ [KEY]: "{not json" });
  storage.failWrites = "quota";
  const result = createLedgerStore(storage, KEY).startOver(1);
  assert.equal(result.ok, false);
  assert.equal(storage.getItem(KEY), "{not json");
  assert.deepEqual([...storage.data.keys()], [KEY]);
});

test("blocked storage is reported for reads, changes and starting over", () => {
  for (const storage of [null, Object.assign(fakeStorage(), { failReads: true })]) {
    const store = createLedgerStore(storage, KEY);
    const loaded = store.load();
    assert.equal(loaded.status, "unavailable");
    assert.equal(loaded.reason, "This browser is not letting the site store data.");
    const result = store.update((ledger) => addExpense(ledger, TEA));
    assert.equal(result.ok, false);
    assert.equal(result.status, "unavailable");
  }
  assert.equal(createLedgerStore(null, KEY).startOver(1).ok, false);
});

test("profiles keep separate ledgers in the same storage", () => {
  const storage = fakeStorage();
  const real = createLedgerStore(storage, storageKeys().ledger);
  const test = createLedgerStore(storage, storageKeys("e2e").ledger);
  real.update((ledger) => addExpense(ledger, TEA));
  test.update((ledger) => addExpense(ledger, BUS));
  assert.deepEqual(real.load().ledger.expenses.map((expense) => expense.description), ["Tea"]);
  assert.deepEqual(test.load().ledger.expenses.map((expense) => expense.description), ["Bus"]);
});
