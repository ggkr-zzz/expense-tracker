// Browser acceptance run for docs/delivery.md. It drives the real app in the iframe through
// its own controls and compares what a person would see with known answers.
// It uses ?profile=e2e, so it reads and writes a ledger of its own, and ?today= for a fixed date.
// It starts locked and enters the PIN itself, then puts this tab's lock state back at the end.

import { ACCESS_PIN } from "../../public/js/config.js";
import { UNLOCKED_KEY } from "../../public/js/lock.js";

const TODAY = "2026-04-08"; // a Wednesday
const LEDGER_KEY = "expense-tracker.e2e.ledger.v1";
const THEME_KEY = "expense-tracker.theme";
const APP = `../../public/index.html?profile=e2e&today=${TODAY}`;

// Entered out of date order on purpose: the app has to sort them.
const FIXTURE = [
  { amount: "2.00", date: "2026-04-06", description: "Lunch", category: "Food" },
  { amount: "4", date: "2026-03-31", description: "Pharmacy", category: "Health" },
  { amount: "0.20", date: "2026-04-08", description: "Tea", category: "Food" },
  { amount: "$1.00", date: "2026-04-05", description: "Bus", category: "Transport" },
  { amount: ".1", date: "2026-04-07", description: "Apple", category: "Food" },
];

const frame = document.getElementById("app");
const report = document.getElementById("report");
const summary = document.getElementById("summary");
const results = [];
let currentList = null;

// ---- helpers ---------------------------------------------------------------------------

const doc = () => frame.contentDocument;
const win = () => frame.contentWindow;
const $ = (selector) => doc().querySelector(selector);
const $$ = (selector) => [...doc().querySelectorAll(selector)];
const text = (selector) => $(selector)?.textContent.trim() ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition, what, timeout = 5000) {
  const deadline = performance.now() + timeout;
  for (;;) {
    let value = false;
    try {
      value = condition();
    } catch {
      // The frame may be between pages; try again.
    }
    if (value) return value;
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(20);
  }
}

function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ section: currentList.dataset.section, name, pass, actual, expected });
  const item = document.createElement("li");
  item.className = pass ? "pass" : "fail";
  item.textContent = `${pass ? "ok" : "FAILED"}  ${name}`;
  if (!pass) {
    const detail = document.createElement("pre");
    detail.textContent = `expected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`;
    item.append(detail);
  }
  currentList.append(item);
}

async function section(title, steps) {
  const heading = document.createElement("h2");
  heading.textContent = title;
  currentList = document.createElement("ol");
  currentList.dataset.section = title;
  report.append(heading, currentList);
  try {
    await steps();
  } catch (error) {
    check("section ran to the end", String(error?.message ?? error), "no error");
  }
}

/** A full page load, as when a person reloads or reopens the site. */
async function load(hash = "#/") {
  const blank = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.src = "about:blank";
  await blank;
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.src = APP + hash;
  await loaded;
  await until(() => doc().documentElement.dataset.ready === "true", "the app to draw");
}

/** In-app navigation, as when a person follows a link. */
async function go(hash, heading) {
  win().location.hash = hash;
  await until(() => win().location.hash === hash && text("h1") === heading, `the "${heading}" view`);
}

function type(selector, value) {
  const control = $(selector);
  control.focus();
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

const submit = () => $("#expense-form").requestSubmit();

async function addExpense({ amount, date, description, category }) {
  await go("#/add", "Add expense");
  type("#amount", amount);
  type("#date", date);
  type("#description", description);
  type("#category", category);
  submit();
  await until(() => text("h1") !== "Add expense", `"${description}" to be saved`);
}

const totals = () => Object.fromEntries($$("[data-total]").map((tile) => [tile.dataset.total, tile.querySelector(".tile-value").textContent]));
const details = () => Object.fromEntries($$("[data-total]").map((tile) => [tile.dataset.total, tile.querySelector(".tile-detail").textContent]));
const rows = (list = "#results") =>
  $$(`${list} .row`).map((row) => [".row-date", ".row-description", ".row-category", ".row-amount"].map((part) => row.querySelector(part).textContent.trim()).join(" | "));
const rowFor = (description) => $$("#results .row").find((row) => row.querySelector(".row-description").textContent === description);
const legend = () => $$(".legend tbody tr").map((row) => [row.dataset.category, ...[...row.querySelectorAll("td")].map((cell) => cell.textContent)]);
const formValues = () => ["#amount", "#date", "#description", "#category"].map((selector) => $(selector).value);
const stored = () => JSON.parse(localStorage.getItem(LEDGER_KEY));
const backupKeys = () => Object.keys(localStorage).filter((key) => key.startsWith(`${LEDGER_KEY}.backup-`));

async function openDeleteDialog(description) {
  rowFor(description).querySelector("button").click();
  await until(() => $("#confirm").open, "the delete dialog");
}

const ALL_FIVE = [
  "2026-04-08 | Tea | Food | $0.20",
  "2026-04-07 | Apple | Food | $0.10",
  "2026-04-06 | Lunch | Food | $2.00",
  "2026-04-05 | Bus | Transport | $1.00",
  "2026-03-31 | Pharmacy | Health | $4.00",
];
const FIXTURE_TOTALS = { today: "$0.20", week: "$2.30", month: "$3.30", all: "$7.30" };

// ---- the run ---------------------------------------------------------------------------

const themeBefore = localStorage.getItem(THEME_KEY);
const unlockedBefore = sessionStorage.getItem(UNLOCKED_KEY); // this page and the app share one tab's session
for (const key of [LEDGER_KEY, ...backupKeys()]) localStorage.removeItem(key);
sessionStorage.removeItem(UNLOCKED_KEY);

await section("PIN page", async () => {
  const tryPin = (value) => {
    type("#pin", value);
    $("#unlock-form").requestSubmit();
  };

  await load("#/expenses"); // a direct link, opened while locked
  check("asks for the PIN before showing anything", text("h1"), "Enter PIN");
  check("the page title gives nothing away", doc().title, "Locked — Expense Tracker");
  check("navigation and the lock control are hidden", [$("nav").hidden, $("#lock").hidden], [true, true]);
  check("nothing from the app is on the page", $$(".tiles, .rows, .filters, #no-expenses, #expense-form").length, 0);
  check("focus starts in the PIN field", doc().activeElement.id, "pin");
  check("the PIN is masked and labelled", [$("#pin").type, $("#pin").labels[0]?.textContent], ["password", "PIN"]);

  tryPin("");
  check("an empty PIN is refused", text("#pin-error"), "Enter the PIN.");
  for (const wrong of ["0000", "242", "24280", "2429"]) {
    tryPin(wrong);
    check(`"${wrong}" is refused, the field is cleared and keeps focus`, [text("h1"), text("#pin-error"), $("#pin").value, doc().activeElement.id], ["Enter PIN", "That PIN is not right.", "", "pin"]);
  }
  check("a wrong PIN is not remembered", sessionStorage.getItem(UNLOCKED_KEY), null);

  tryPin(ACCESS_PIN);
  await until(() => text("h1") === "Expenses", "the app to open");
  check("the right PIN opens the view the link asked for", [text("h1"), win().location.hash], ["Expenses", "#/expenses"]);
  check("navigation and the lock control appear", [$("nav").hidden, $("#lock").hidden], [false, false]);

  await load("#/");
  check("a reload in the same tab does not ask again", text("h1"), "Dashboard");

  $("#lock").click();
  check("locking returns to the PIN page at once", [text("h1"), $$(".tiles").length, $("nav").hidden, doc().activeElement.id], ["Enter PIN", 0, true, "pin"]);
  await load("#/");
  check("and it stays locked after a reload", text("h1"), "Enter PIN");

  tryPin(` ${ACCESS_PIN} `);
  await until(() => text("h1") === "Dashboard", "the app to open");
  check("spaces around the PIN are ignored", text("h1"), "Dashboard");
});

await section("A new ledger", async () => {
  await load();
  check("opens on the dashboard", text("h1"), "Dashboard");
  check("all four totals are zero", totals(), { today: "$0.00", week: "$0.00", month: "$0.00", all: "$0.00" });
  check("each total says which dates it covers", details(), {
    today: "2026-04-08",
    week: "2026-04-06 to 2026-04-12",
    month: "2026-04-01 to 2026-04-30",
    all: "0 expenses",
  });
  check("invites the first expense", text("#no-expenses"), "No expenses yet.");
  check("draws no pie chart", $(".pie"), null);
  await go("#/expenses", "Expenses");
  check("the list is empty too", text("#no-expenses"), "No expenses yet.");
});

await section("The form rejects bad input and keeps what was typed", async () => {
  await go("#/add", "Add expense");
  check("the date defaults to today", $("#date").value, TODAY);
  check("no category is pre-selected", $("#category").value, "");
  submit();
  check("empty amount", text("#amount-error"), "Enter an amount.");
  check("empty description", text("#description-error"), "Describe the expense.");
  check("no category", text("#category-error"), "Choose a category.");
  check("focus moves to the first problem", doc().activeElement.id, "amount");
  check("the bad field is marked for assistive technology", $("#amount").getAttribute("aria-invalid"), "true");

  type("#description", "Keep me");
  type("#category", "Food");
  const bad = {
    "0": "Amount must be more than zero.",
    "-5": "Amount must be more than zero.",
    "1.234": "Use at most 2 decimal places.",
    "12,50": "Use a full stop for cents, like 12.50.",
    "abc": "Enter a number like 12.50.",
    "1000000.01": "Amount must be $1,000,000.00 or less.",
  };
  for (const [typed, message] of Object.entries(bad)) {
    type("#amount", typed);
    submit();
    check(`"${typed}" is rejected with a reason`, text("#amount-error"), message);
    check(`"${typed}" stays in the field`, $("#amount").value, typed);
  }
  check("the other fields keep their values", formValues().slice(1), [TODAY, "Keep me", "Food"]);
  check("fields without a problem show no message", [text("#description-error"), text("#category-error")], ["", ""]);

  type("#amount", "5");
  type("#date", "");
  submit();
  check("a missing date is rejected", text("#date-error"), "Choose a date.");
  check("still on the form", text("h1"), "Add expense");
  check("nothing was saved", localStorage.getItem(LEDGER_KEY), null);
});

await section("Adding expenses", async () => {
  await go("#/", "Dashboard");
  for (const expense of FIXTURE) await addExpense(expense);
  check("saving returns to the view the form was opened from", text("h1"), "Dashboard");
  check("the status line confirms the save", text("#status"), "Added Apple, $0.10.");
  check("totals for Wednesday 8 April 2026", totals(), FIXTURE_TOTALS);
  check("the all-time total counts the expenses", details().all, "5 expenses");
  check("recent expenses, newest first", rows("#recent"), ALL_FIVE);
  check("amounts are stored as whole cents", stored().expenses.map((expense) => expense.amountCents), [200, 400, 20, 100, 10]);
});

await section("Category chart", async () => {
  check("table: largest first, every category listed, shares add to 100", legend(), [
    ["Health", "$4.00", "55%"],
    ["Food", "$2.30", "31%"],
    ["Transport", "$1.00", "14%"],
    ["Bills", "$0.00", "0%"],
    ["Shopping", "$0.00", "0%"],
    ["Entertainment", "$0.00", "0%"],
    ["Other", "$0.00", "0%"],
  ]);
  check("table total equals the all-time total", [...$$(".legend tfoot td")].map((cell) => cell.textContent), ["$7.30", "100%"]);
  check("one slice per category with spending, in the same order", $$(".slice").map((slice) => slice.dataset.category), ["Health", "Food", "Transport"]);
  check("each slice is labelled with its key letter", $$(".slice-key").map((label) => label.textContent), ["H", "F", "T"]);
  check("the chart has a text alternative", $(".pie").getAttribute("aria-label"), "Pie chart of all-time spending by category: Health 55%, Food 31%, Transport 14%.");
  check("slices take their category's colour", $$(".slice").map((slice) => win().getComputedStyle(slice).fill !== "none"), [true, true, true]);

  const [healthSlice] = $$(".slice");
  healthSlice.dispatchEvent(new PointerEvent("pointerenter"));
  check("pointing at a slice highlights its row in the table", $$(".legend .is-active").map((row) => row.dataset.category), ["Health"]);
  check("and dims the other slices", $(".chart").classList.contains("has-active"), true);
  healthSlice.dispatchEvent(new PointerEvent("pointerleave"));
  check("moving away clears the highlight", [$$(".is-active").length, $(".chart").classList.contains("has-active")], [0, false]);
  const foodRow = $$(".legend tbody tr")[1];
  foodRow.dispatchEvent(new PointerEvent("pointerenter"));
  check("pointing at a row highlights its slice", $$(".slice.is-active").map((slice) => slice.dataset.category), ["Food"]);
  foodRow.dispatchEvent(new PointerEvent("pointerleave"));
});

await section("Expense list and filters", async () => {
  await go("#/expenses", "Expenses");
  check("every expense, newest first", rows(), ALL_FIVE);
  check("count and sum of everything", text("#results-summary"), "5 expenses · $7.30");
  check("nothing to clear yet", $("#filter-clear").disabled, true);

  type("#filter-category", "Food");
  check("by category", rows(), ALL_FIVE.slice(0, 3));
  check("count and sum of the matches", text("#results-summary"), "3 of 5 expenses shown · $2.30");

  type("#filter-from", "2026-04-06");
  type("#filter-to", "2026-04-07");
  check("category and an inclusive date range together", rows(), ALL_FIVE.slice(1, 3));
  check("their sum", text("#results-summary"), "2 of 5 expenses shown · $2.10");

  type("#filter-search", "APP");
  check("plus a case-insensitive search", rows(), ALL_FIVE.slice(1, 2));

  await go("#/", "Dashboard");
  check("filters never change the dashboard", totals(), FIXTURE_TOTALS);
  await go("#/expenses", "Expenses");
  check("filters are still applied after visiting another view", rows(), ALL_FIVE.slice(1, 2));
  check("and the controls still show them", ["#filter-search", "#filter-category", "#filter-from", "#filter-to"].map((selector) => $(selector).value), ["APP", "Food", "2026-04-06", "2026-04-07"]);

  type("#filter-search", "zzz");
  check("no matches: no rows", rows(), []);
  check("no matches: says so", [$("#no-matches").hidden, text("#no-matches")], [false, "No expenses match these filters."]);

  $("#filter-clear").click();
  check("clearing restores the full list", rows(), ALL_FIVE);
  check("and empties every control", ["#filter-search", "#filter-category", "#filter-from", "#filter-to"].map((selector) => $(selector).value), ["", "", "", ""]);

  type("#filter-from", "2026-04-06");
  check("a start date alone", rows(), ALL_FIVE.slice(0, 3));
  $("#filter-clear").click();
  type("#filter-to", "2026-04-05");
  check("an end date alone", rows(), ALL_FIVE.slice(3));

  type("#filter-from", "2026-04-07");
  type("#filter-to", "2026-04-06");
  check("a reversed range is explained", text("#filter-problem"), "The start date is after the end date, so nothing can match.");
  check("and matches nothing", rows(), []);
  $("#filter-clear").click();
  check("the explanation goes away", text("#filter-problem"), "");
});

await section("Data survives a reload", async () => {
  await load("#/expenses");
  check("the list after reloading", rows(), ALL_FIVE);
  await load("#/");
  check("the totals after reloading", totals(), FIXTURE_TOTALS);
});

await section("Editing", async () => {
  await load("#/expenses");
  rowFor("Tea").querySelector("a").click();
  await until(() => text("h1") === "Edit expense", "the edit form");
  check("the form opens with the saved values", formValues(), ["0.20", "2026-04-08", "Tea", "Food"]);

  $("#cancel").click();
  await until(() => text("h1") === "Expenses", "the list after cancelling");
  check("cancel changes nothing", rows(), ALL_FIVE);

  rowFor("Tea").querySelector("a").click();
  await until(() => text("h1") === "Edit expense", "the edit form");
  type("#amount", "0.30");
  type("#category", "Other");
  submit();
  await until(() => text("h1") === "Expenses", "the list after saving");
  check("the status line confirms the edit", text("#status"), "Updated Tea, $0.30.");
  check("the row shows the new values in the same position", rows()[0], "2026-04-08 | Tea | Other | $0.30");
  check("the id and so the creation order is unchanged", stored().expenses.find((expense) => expense.description === "Tea").id, 3);

  await load("#/");
  check("totals after the edit and a reload", totals(), { today: "$0.30", week: "$2.40", month: "$3.40", all: "$7.40" });
  check("category totals follow the edit", legend().slice(0, 4), [
    ["Health", "$4.00", "54%"],
    ["Food", "$2.10", "28%"],
    ["Transport", "$1.00", "14%"],
    ["Other", "$0.30", "4%"],
  ]);
  check("the new slice is labelled", $$(".slice-key").map((label) => label.textContent), ["H", "F", "T", "O"]);
});

await section("Deleting", async () => {
  await go("#/expenses", "Expenses");
  await openDeleteDialog("Tea");
  check("the dialog names the expense", text("#confirm-detail"), "Tea — $0.30 — 2026-04-08 (Other)");
  check("Cancel has focus, so Enter cannot delete by accident", doc().activeElement.id, "confirm-cancel");
  $("#confirm-cancel").click();
  await until(() => !$("#confirm").open, "the dialog to close");
  check("cancelling keeps the expense", rows().length, 5);
  check("and says so", text("#status"), "Nothing was deleted.");

  // Reopening and confirming straight away, before the first dialog's close event has even
  // been delivered, must delete once: the cancelled question cannot be answered again.
  await openDeleteDialog("Tea");
  $("#confirm-ok").click();
  await until(() => rows().length === 4, "the row to go");
  check("confirming removes it", rowFor("Tea") ?? null, null);
  check("the status line confirms the deletion", text("#status"), "Deleted Tea, $0.30.");
  await sleep(50);
  check("and it was deleted exactly once", [rows().length, text("#status")], [4, "Deleted Tea, $0.30."]);

  await load("#/");
  check("totals after the deletion and a reload", totals(), { today: "$0.00", week: "$2.10", month: "$3.10", all: "$7.10" });
});

await section("Same-day order and text that looks like markup", async () => {
  const markup = `<img src=x onerror="document.title='hacked'"> <b>bold</b> & "quotes"`;
  await go("#/expenses", "Expenses");
  await addExpense({ amount: "1", date: "2026-04-07", description: "Second on the 7th", category: "Shopping" });
  await addExpense({ amount: "1", date: "2026-04-07", description: markup, category: "Entertainment" });
  check("saving returns to the list it came from", text("h1"), "Expenses");
  check("same date: the entry created last comes first", rows().slice(0, 3), [
    `2026-04-07 | ${markup} | Entertainment | $1.00`,
    "2026-04-07 | Second on the 7th | Shopping | $1.00",
    "2026-04-07 | Apple | Food | $0.10",
  ]);
  check("markup in a description stays text", $$(".row img, .row b").length, 0);
  check("the page title was not changed by the description", doc().title, "Expenses — Expense Tracker");
  check("controls name their expense", rowFor("Apple").querySelector("a").getAttribute("aria-label"), "Edit Apple, $0.10, 2026-04-07");
  check("delete controls too", rowFor("Apple").querySelector("button").getAttribute("aria-label"), "Delete Apple, $0.10, 2026-04-07");
  await openDeleteDialog(markup);
  check("the dialog shows the description as text", $$("#confirm img, #confirm b").length, 0);
  $("#confirm-ok").click();
  await until(() => rows().length === 5, "the row to go");
});

await section("A write that fails", async () => {
  await load("#/add");
  const before = localStorage.getItem(LEDGER_KEY);
  const storagePrototype = win().Storage.prototype;
  const realSetItem = storagePrototype.setItem;
  storagePrototype.setItem = () => {
    throw new (win().DOMException)("The quota has been exceeded.", "QuotaExceededError");
  };
  try {
    type("#amount", "9.99");
    type("#description", "Will not fit");
    type("#category", "Bills");
    submit();
    check("says the expense was not saved, and why", text("#form-error"), "Not saved. Browser storage for this site is full.");
    check("the form stays open with everything typed", [text("h1"), ...formValues()], ["Add expense", "9.99", TODAY, "Will not fit", "Bills"]);
  } finally {
    storagePrototype.setItem = realSetItem;
  }
  check("the saved data is untouched", localStorage.getItem(LEDGER_KEY), before);
  submit();
  submit(); // a second Enter before the view has changed
  await until(() => text("h1") === "Dashboard", "the retry to save");
  check("the same form saves once storage works again", text("#status"), "Added Will not fit, $9.99.");
  check("and submitting twice saves one expense, not two", stored().expenses.filter((expense) => expense.description === "Will not fit").length, 1);
});

await section("Saved data that cannot be read", async () => {
  const good = localStorage.getItem(LEDGER_KEY);
  localStorage.setItem(LEDGER_KEY, "{broken");
  await load("#/");
  check("explains instead of showing an empty ledger", text("h1"), "Saved expenses could not be read");
  check("gives the reason", text("#unreadable-reason"), "The saved data is not valid JSON.");
  check("shows the saved text", $("#saved-data").value, "{broken");
  await go("#/add", "Saved expenses could not be read");
  check("the form is not offered", $("#expense-form"), null);

  $("#start-over").click();
  await until(() => $("#confirm").open, "the confirmation dialog");
  $("#confirm-cancel").click();
  await until(() => !$("#confirm").open, "the dialog to close");
  check("the saved text is left exactly as it was", localStorage.getItem(LEDGER_KEY), "{broken");

  $("#start-over").click();
  await until(() => $("#confirm").open, "the confirmation dialog");
  $("#confirm-ok").click();
  await until(() => text("h1") === "Add expense", "the app to come back");
  check("starting over keeps a backup of the old text", backupKeys().map((key) => localStorage.getItem(key)), ["{broken"]);
  check("and begins an empty ledger", stored(), { version: 1, nextId: 1, expenses: [] });

  for (const key of backupKeys()) localStorage.removeItem(key);
  localStorage.setItem(LEDGER_KEY, good);

  localStorage.setItem(LEDGER_KEY, JSON.stringify({ version: 2, nextId: 1, expenses: [] }));
  await load("#/");
  check("data from a newer version is refused, not overwritten", text("#unreadable-reason"), "The saved data is version 2; this app reads version 1.");
  localStorage.setItem(LEDGER_KEY, good);
});

await section("A change made in another tab", async () => {
  await load("#/");
  check("today before the other tab's change", totals().today, "$9.99");
  // This page shares storage with the app, so writing here is what a second tab would do.
  const ledger = stored();
  ledger.expenses.push({ id: ledger.nextId, amountCents: 5000, date: TODAY, description: "From another tab", category: "Bills" });
  ledger.nextId += 1;
  localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
  await until(() => totals().today !== "$9.99", "the dashboard to notice the other tab");
  check("the open dashboard updates by itself", totals().today, "$59.99");

  await addExpense({ amount: "1", date: TODAY, description: "After the other tab", category: "Other" });
  check("the next save builds on the other tab's change", stored().expenses.slice(-2).map((expense) => expense.description), ["From another tab", "After the other tab"]);
});

await section("Theme", async () => {
  const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const other = system === "dark" ? "light" : "dark";
  const background = { light: "rgb(255, 255, 255)", dark: "rgb(25, 25, 25)" };
  const theme = () => doc().documentElement.dataset.theme;

  localStorage.removeItem(THEME_KEY);
  await load("#/");
  check("a first visit follows the system setting", theme(), system);
  check("the switch shows the current state", $("#theme-toggle").getAttribute("aria-checked"), String(system === "dark"));

  $("#theme-toggle").click();
  check("the toggle switches theme", theme(), other);
  check("the page really changes colour", win().getComputedStyle(doc().body).backgroundColor, background[other]);
  check("the choice is saved", localStorage.getItem(THEME_KEY), other);

  await load("#/");
  check("the choice survives a reload", theme(), other);
  check("and the switch agrees", $("#theme-toggle").getAttribute("aria-checked"), String(other === "dark"));

  $("#theme-toggle").click();
  check("toggling again goes back", [theme(), win().getComputedStyle(doc().body).backgroundColor], [system, background[system]]);
});

await section("Navigation and structure", async () => {
  await load("#/");
  check("the page title names the view", doc().title, "Dashboard — Expense Tracker");
  check("the current view is marked in the navigation", $$("nav [aria-current=page]").map((link) => link.textContent), ["dashboard"]);

  await go("#/expenses", "Expenses");
  check("changing view moves focus to its heading", doc().activeElement.tagName, "H1");
  check("the navigation follows", $$("nav [aria-current=page]").map((link) => link.textContent), ["expenses"]);

  await go("#/add", "Add expense");
  check("the form puts focus in its first field", doc().activeElement.id, "amount");
  check("cancel returns to the view the form was opened from", $("#cancel").getAttribute("href"), "#/expenses");
  check("every form control has a label", $$("#expense-form input, #expense-form select").map((control) => control.labels[0]?.textContent), ["Amount (AUD)", "Date", "Description", "Category"]);

  await load("#/add");
  check("opened from a direct link, cancel goes to the dashboard", $("#cancel").getAttribute("href"), "#/");

  await go("#/nope", "Page not found");
  check("an unknown address says so", text("#not-found"), "There is nothing at this address.");
  await go("#/edit/9999", "Expense not found");
  check("an edit link for a deleted expense says so", text("#missing-expense"), "That expense does not exist. It may have been deleted.");

  await go("#/", "Dashboard");
  $("#skip").click();
  check("the skip link moves focus to the content without changing the address", [doc().activeElement.id, win().location.hash], ["main", "#/"]);
  check("nothing uses a positive tab order", $$("[tabindex]").filter((element) => element.tabIndex > 0).length, 0);
  check("every image-like element has a text alternative", $$("svg[role=img]").every((image) => image.getAttribute("aria-label")), true);
});

// ---- wrap up ---------------------------------------------------------------------------

for (const key of [LEDGER_KEY, ...backupKeys()]) localStorage.removeItem(key);
if (themeBefore === null) localStorage.removeItem(THEME_KEY);
else localStorage.setItem(THEME_KEY, themeBefore);
if (unlockedBefore === null) sessionStorage.removeItem(UNLOCKED_KEY);
else sessionStorage.setItem(UNLOCKED_KEY, unlockedBefore);

const failed = results.filter((result) => !result.pass);
const status = failed.length === 0 ? "pass" : "fail";
summary.dataset.status = status;
summary.textContent = failed.length === 0 ? `PASS: all ${results.length} checks passed.` : `FAIL: ${failed.length} of ${results.length} checks failed.`;
document.getElementById("result-json").textContent = JSON.stringify({ status, total: results.length, failed });
document.title = failed.length === 0 ? `PASS ${results.length} checks` : `FAIL ${failed.length} of ${results.length}`;
