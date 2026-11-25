// The only module that touches the page. Everything on screen is derived from the ledger in
// storage and today's date; the modules beside this one do the calculating.
// User text only ever reaches the page as text nodes, never as markup.

import { pieSlices, rankByAmount } from "./chart.js";
import { CATEGORIES, CURRENCY, MAX_DATE, MAX_DESCRIPTION_LENGTH, MIN_DATE, RECENT_COUNT } from "./config.js";
import { isValidDate, localISODate } from "./dates.js";
import {
  NO_FILTERS,
  addExpense,
  categoryTotals,
  emptyLedger,
  filterExpenses,
  filterProblem,
  findExpense,
  hasActiveFilters,
  periodTotals,
  removeExpense,
  sortExpenses,
  sumCents,
  updateExpense,
  validateDraft,
} from "./ledger.js";
import { createLock } from "./lock.js";
import { centsToInput, formatCents } from "./money.js";
import { parseRoute } from "./routes.js";
import { browserStorage, createLedgerStore, storageKeys } from "./storage.js";

// ---- setup -----------------------------------------------------------------------------

const byId = (id) => document.getElementById(id);
const main = byId("main");
const alerts = byId("alerts");
const statusLine = byId("status");
const themeToggle = byId("theme-toggle");
const lockButton = byId("lock");
const navigation = document.querySelector("nav");
const dialog = byId("confirm");

// ?profile=<name> selects a separate ledger and ?today=YYYY-MM-DD fixes the date.
// Both exist so the acceptance run has known answers and never touches real data.
const params = new URLSearchParams(location.search);
const todayOverride = isValidDate(params.get("today")) ? params.get("today") : null;
const keys = storageKeys(params.get("profile"));
const storage = browserStorage();
const store = createLedgerStore(storage, keys.ledger);
const lock = createLock(browserStorage("sessionStorage")); // the PIN page; see config.js
const categoryByName = new Map(CATEGORIES.map((category) => [category.name, category]));

const currentDate = () => todayOverride ?? localISODate(new Date());

const state = {
  status: "ok", // "ok" | "unreadable" | "unavailable"
  reason: "",
  raw: null, // the stored text the screen was last drawn from
  ledger: emptyLedger(),
  today: currentDate(),
  filters: { ...NO_FILTERS },
  returnTo: "#/", // where Save and Cancel go: the last dashboard or list view
  route: { name: "dashboard" },
};

/** Re-reads storage and the date. True when what is on screen is now out of date. */
function sync() {
  const loaded = store.load();
  const today = currentDate();
  const raw = loaded.raw ?? null;
  const reason = loaded.reason ?? "";
  const changed = loaded.status !== state.status || raw !== state.raw || reason !== state.reason || today !== state.today;
  state.status = loaded.status;
  state.reason = reason;
  state.raw = raw;
  state.ledger = loaded.status === "ok" ? loaded.ledger : emptyLedger();
  state.today = today;
  return changed;
}

// ---- building elements -----------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function build(element, attributes, children) {
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === false || child === null || child === undefined) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

const h = (tag, attributes, ...children) => build(document.createElement(tag), attributes, children);
const s = (tag, attributes, ...children) => build(document.createElementNS(SVG_NS, tag), attributes, children);

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const heading = (text) => h("h1", { tabindex: "-1" }, text);

function panel(title, ...children) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return h("section", { class: "panel", "aria-labelledby": id }, h("h2", { id }, title), children);
}

function field(label, control, error = null) {
  return h("div", { class: "field" }, h("label", { for: control.id }, label), control, error);
}

// ---- status line and confirmation ------------------------------------------------------

function announce(message) {
  statusLine.textContent = message;
}

// The answer to the question the dialog is currently asking. Each question is answered exactly
// once, by the button that was pressed, so a late "close" event can never answer a newer one.
let answer = null;

function settle(confirmed) {
  const resolve = answer;
  answer = null;
  if (dialog.open) dialog.close();
  resolve?.(confirmed);
}

/** Resolves true only when the action button is chosen. Escape and Cancel resolve false. */
function ask({ title, detail, action }) {
  if (typeof dialog.showModal !== "function") {
    return Promise.resolve(window.confirm(`${title}\n\n${detail}`));
  }
  if (dialog.open) return Promise.resolve(false); // already asking something
  byId("confirm-title").textContent = title;
  byId("confirm-detail").textContent = detail;
  byId("confirm-ok").textContent = action;
  return new Promise((resolve) => {
    answer?.(false); // a question that was closed but not yet answered counts as "no"
    answer = resolve;
    dialog.showModal(); // focus lands on Cancel, the first button
  });
}

byId("confirm-cancel").addEventListener("click", () => settle(false));
byId("confirm-ok").addEventListener("click", () => settle(true));
// Escape, or anything else that closes the dialog, counts as "no".
dialog.addEventListener("close", () => {
  if (!dialog.open) settle(false);
});

// ---- views -----------------------------------------------------------------------------

function tile(key, label, cents, detail) {
  return h(
    "div",
    { class: "tile", "data-total": key },
    h("dt", {}, label),
    h("dd", { class: "tile-value" }, formatCents(cents)),
    h("dd", { class: "tile-detail" }, detail),
  );
}

function expenseRow(expense) {
  const amount = formatCents(expense.amountCents);
  const name = `${expense.description}, ${amount}, ${expense.date}`;
  const { slug } = categoryByName.get(expense.category);
  // Two groups, so a narrow screen can show two lines (description and amount, then the rest).
  // On a wide screen the groups dissolve and the five cells line up in columns: see styles.css.
  return h(
    "li",
    { class: "row", "data-id": expense.id },
    h(
      "span",
      { class: "row-main" },
      h("span", { class: "row-description" }, expense.description),
      h("span", { class: "row-amount" }, amount),
    ),
    h(
      "span",
      { class: "row-sub" },
      h(
        "span",
        { class: "row-meta" },
        h("span", { class: "row-date" }, expense.date),
        h("span", { class: "row-category" }, h("span", { class: `swatch c-${slug}`, "aria-hidden": "true" }), expense.category),
      ),
      h(
        "span",
        { class: "row-actions" },
        h("a", { class: "link", href: `#/edit/${expense.id}`, "aria-label": `Edit ${name}` }, "edit"),
        h("button", { type: "button", class: "link danger", "aria-label": `Delete ${name}`, onclick: () => deleteExpense(expense.id) }, "delete"),
      ),
    ),
  );
}

function categoryChart(expenses) {
  const ranked = rankByAmount(
    categoryTotals(expenses).map(({ category, cents }) => ({ ...categoryByName.get(category), cents })),
  );
  const slices = pieSlices(ranked, { r: 50, labelR: 61 });
  const percentOf = new Map(slices.map((slice) => [slice.name, slice.percent]));
  const total = sumCents(expenses);
  const share = (item) => {
    if (item.cents === 0) return "0%";
    const percent = percentOf.get(item.name);
    return percent === 0 ? "<1%" : `${percent}%`;
  };

  const pie = s(
    "svg",
    {
      class: "pie",
      viewBox: "-70 -70 140 140",
      role: "img",
      "aria-label": `Pie chart of all-time spending by category: ${slices.map((slice) => `${slice.name} ${share(slice)}`).join(", ")}.`,
    },
    slices.map((slice) => {
      const attributes = { class: `slice c-${slice.slug}`, "data-category": slice.name };
      const label = s("title", {}, `${slice.name}: ${formatCents(slice.cents)} (${share(slice)})`);
      return slice.full ? s("circle", { ...attributes, cx: 0, cy: 0, r: 50 }, label) : s("path", { ...attributes, d: slice.d }, label);
    }),
    slices
      .filter((slice) => slice.showLabel)
      .map((slice) =>
        s("text", { class: "slice-key", x: slice.labelX, y: slice.labelY, "text-anchor": "middle", "dominant-baseline": "central", "aria-hidden": "true" }, slice.key),
      ),
  );

  const legend = h(
    "table",
    { class: "legend", "aria-label": "All-time spending by category" },
    h(
      "thead",
      {},
      h("tr", {}, h("th", { scope: "col" }, "Category"), h("th", { scope: "col", class: "num" }, "Amount"), h("th", { scope: "col", class: "num" }, "Share")),
    ),
    h(
      "tbody",
      {},
      ranked.map((item) =>
        h(
          "tr",
          { "data-category": item.name, class: item.cents === 0 ? "is-zero" : null },
          h(
            "th",
            { scope: "row" },
            h("span", { class: `swatch c-${item.slug}`, "aria-hidden": "true" }),
            h("span", { class: "key", "aria-hidden": "true" }, item.key),
            item.name,
          ),
          h("td", { class: "num" }, formatCents(item.cents)),
          h("td", { class: "num" }, share(item)),
        ),
      ),
    ),
    h("tfoot", {}, h("tr", {}, h("th", { scope: "row" }, "Total"), h("td", { class: "num" }, formatCents(total)), h("td", { class: "num" }, "100%"))),
  );

  // Pointing at a slice or a row highlights both, so a slice can be identified without colour.
  const chart = h("div", { class: "chart" }, pie, legend);
  const marks = [...chart.querySelectorAll("[data-category]")];
  const highlight = (name) => {
    chart.classList.toggle("has-active", name !== null && percentOf.has(name));
    for (const mark of marks) mark.classList.toggle("is-active", mark.dataset.category === name);
  };
  for (const mark of marks) {
    mark.addEventListener("pointerenter", () => highlight(mark.dataset.category));
    mark.addEventListener("pointerleave", () => highlight(null));
  }
  return chart;
}

function dashboardView() {
  const expenses = state.ledger.expenses;
  const totals = periodTotals(expenses, state.today);
  const day = (date) => h("span", { class: "nowrap" }, date); // a date never breaks at its hyphens
  const range = ({ start, end }) => [day(start), " to ", day(end)];
  const nodes = [
    heading("Dashboard"),
    panel(
      "Totals",
      h(
        "dl",
        { class: "tiles" },
        tile("today", "Today", totals.today, day(state.today)),
        tile("week", "This week", totals.week, range(totals.weekRange)),
        tile("month", "This month", totals.month, range(totals.monthRange)),
        tile("all", "All time", totals.all, plural(expenses.length, "expense")),
      ),
    ),
  ];

  if (expenses.length === 0) {
    nodes.push(
      panel(
        "Get started",
        h("p", { class: "empty", id: "no-expenses" }, "No expenses yet."),
        h("p", {}, h("a", { class: "btn primary", href: "#/add" }, "add your first expense")),
      ),
    );
  } else {
    nodes.push(
      panel("By category", categoryChart(expenses)),
      panel(
        "Recent expenses",
        h("ul", { class: "rows", id: "recent" }, sortExpenses(expenses).slice(0, RECENT_COUNT).map(expenseRow)),
        h("p", { class: "more" }, h("a", { href: "#/expenses" }, `view all ${plural(expenses.length, "expense")}`)),
      ),
    );
  }
  return { title: "Dashboard", nodes };
}

function expensesView() {
  const all = sortExpenses(state.ledger.expenses);
  if (all.length === 0) {
    return {
      title: "Expenses",
      nodes: [
        heading("Expenses"),
        panel(
          "Get started",
          h("p", { class: "empty", id: "no-expenses" }, "No expenses yet."),
          h("p", {}, h("a", { class: "btn primary", href: "#/add" }, "add your first expense")),
        ),
      ],
    };
  }

  const search = h("input", { id: "filter-search", type: "search", autocomplete: "off", spellcheck: "false" });
  const category = h(
    "select",
    { id: "filter-category" },
    h("option", { value: "" }, "all"),
    CATEGORIES.map(({ name }) => h("option", { value: name }, name)),
  );
  const from = h("input", { id: "filter-from", type: "date", min: MIN_DATE, max: MAX_DATE });
  const to = h("input", { id: "filter-to", type: "date", min: MIN_DATE, max: MAX_DATE });
  const clear = h("button", { type: "button", class: "btn", id: "filter-clear" }, "clear filters");
  const problem = h("p", { class: "error", id: "filter-problem", role: "alert" });
  const summary = h("p", { class: "summary", id: "results-summary", role: "status" });
  const list = h("ul", { class: "rows", id: "results" });
  const noMatches = h("p", { class: "empty", id: "no-matches" }, "No expenses match these filters.");

  const controls = { search, category, from, to };
  const showFilters = () => {
    for (const [name, control] of Object.entries(controls)) control.value = state.filters[name];
  };

  const showResults = () => {
    const matches = filterExpenses(all, state.filters);
    const active = hasActiveFilters(state.filters);
    list.replaceChildren(...matches.map(expenseRow));
    list.hidden = matches.length === 0;
    noMatches.hidden = matches.length > 0;
    problem.textContent = filterProblem(state.filters) ?? "";
    clear.disabled = !active;
    summary.textContent = active
      ? `${matches.length} of ${plural(all.length, "expense")} shown · ${formatCents(sumCents(matches))}`
      : `${plural(all.length, "expense")} · ${formatCents(sumCents(all))}`;
  };

  const readFilters = () => {
    state.filters = { search: search.value, category: category.value, from: from.value, to: to.value };
    showResults();
  };
  search.addEventListener("input", readFilters);
  for (const control of [category, from, to]) control.addEventListener("change", readFilters);
  clear.addEventListener("click", () => {
    state.filters = { ...NO_FILTERS };
    showFilters();
    showResults();
    search.focus();
  });

  showFilters();
  showResults();

  return {
    title: "Expenses",
    nodes: [
      heading("Expenses"),
      panel(
        "Filter",
        h(
          "form",
          { class: "filters", role: "search", "aria-label": "Filter expenses", onsubmit: (event) => event.preventDefault() },
          field("Search", search),
          field("Category", category),
          field("From", from),
          field("To", to),
          clear,
        ),
        problem,
      ),
      panel("All expenses", summary, list, noMatches),
    ],
  };
}

function formView(id) {
  const editing = id !== null;
  const expense = editing ? findExpense(state.ledger, id) : null;
  if (editing && !expense) {
    return {
      title: "Expense not found",
      nodes: [
        heading("Expense not found"),
        h("p", { id: "missing-expense" }, "That expense does not exist. It may have been deleted."),
        h("p", {}, h("a", { class: "btn", href: "#/expenses" }, "back to expenses")),
      ],
    };
  }

  const controls = {
    amount: h("input", { id: "amount", name: "amount", type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "0.00", required: true, "aria-describedby": "amount-error" }),
    date: h("input", { id: "date", name: "date", type: "date", min: MIN_DATE, max: MAX_DATE, required: true, "aria-describedby": "date-error" }),
    description: h("input", { id: "description", name: "description", type: "text", maxlength: MAX_DESCRIPTION_LENGTH, autocomplete: "off", required: true, "aria-describedby": "description-error" }),
    category: h(
      "select",
      { id: "category", name: "category", required: true, "aria-describedby": "category-error" },
      h("option", { value: "" }, "choose…"),
      CATEGORIES.map(({ name }) => h("option", { value: name }, name)),
    ),
  };
  const errors = Object.fromEntries(Object.keys(controls).map((name) => [name, h("p", { class: "error", id: `${name}-error` })]));
  const formError = h("p", { class: "error", id: "form-error", role: "alert" });

  controls.amount.value = editing ? centsToInput(expense.amountCents) : "";
  controls.date.value = editing ? expense.date : state.today;
  controls.description.value = editing ? expense.description : "";
  controls.category.value = editing ? expense.category : "";

  let saved = false;

  function save(event) {
    event.preventDefault();
    if (saved) return; // a second Enter or click before the view changes must not save twice
    const draft = Object.fromEntries(Object.entries(controls).map(([name, control]) => [name, control.value]));
    const result = validateDraft(draft);

    formError.textContent = "";
    for (const [name, control] of Object.entries(controls)) {
      const message = result.ok ? "" : (result.errors[name] ?? "");
      errors[name].textContent = message;
      if (message) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
    if (!result.ok) {
      controls[Object.keys(controls).find((name) => result.errors[name])].focus();
      return;
    }

    const outcome = store.update((ledger) => (editing ? updateExpense(ledger, id, result.fields) : addExpense(ledger, result.fields)));
    if (!outcome.ok) {
      formError.textContent = `Not saved. ${outcome.reason}`; // the form and its values stay as they are
      return;
    }
    saved = true;
    announce(`${editing ? "Updated" : "Added"} ${outcome.expense.description}, ${formatCents(outcome.expense.amountCents)}.`);
    navigate(state.returnTo);
  }

  const title = editing ? "Edit expense" : "Add expense";
  return {
    title,
    focus: controls.amount,
    nodes: [
      heading(title),
      h(
        "form",
        { class: "expense-form", id: "expense-form", novalidate: true, onsubmit: save },
        field(`Amount (${CURRENCY})`, controls.amount, errors.amount),
        field("Date", controls.date, errors.date),
        field("Description", controls.description, errors.description),
        field("Category", controls.category, errors.category),
        formError,
        h(
          "div",
          { class: "actions" },
          h("button", { type: "submit", class: "btn primary", id: "save" }, "save"),
          h("a", { class: "btn", id: "cancel", href: state.returnTo }, "cancel"),
        ),
      ),
    ],
  };
}

function notFoundView() {
  return {
    title: "Page not found",
    nodes: [
      heading("Page not found"),
      h("p", { id: "not-found" }, "There is nothing at this address."),
      h("p", {}, h("a", { class: "btn", href: "#/" }, "go to the dashboard")),
    ],
  };
}

/** Shown instead of every view until the PIN is entered. Nothing from the ledger is on the page. */
function lockedView() {
  const pin = h("input", { id: "pin", name: "pin", type: "password", inputmode: "numeric", autocomplete: "off", required: true, "aria-describedby": "pin-error" });
  const error = h("p", { class: "error", id: "pin-error", role: "alert" });

  function unlock(event) {
    event.preventDefault();
    if (lock.unlock(pin.value)) {
      announce("Unlocked.");
      sync();
      render({ focus: true }); // the view the address asked for
      return;
    }
    error.textContent = pin.value.trim() === "" ? "Enter the PIN." : "That PIN is not right.";
    pin.setAttribute("aria-invalid", "true");
    pin.value = "";
    pin.focus();
  }

  return {
    title: "Locked",
    focus: pin,
    nodes: [
      heading("Enter PIN"),
      h(
        "form",
        { class: "expense-form", id: "unlock-form", novalidate: true, onsubmit: unlock },
        field("PIN", pin, error),
        h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", id: "unlock" }, "unlock")),
      ),
    ],
  };
}

/** Shown instead of every view while the saved data cannot be read. Nothing is written. */
function unreadableView() {
  const saved = h("textarea", { id: "saved-data", readonly: true, rows: 8, "aria-label": "Saved data" });
  saved.value = state.raw ?? "";

  async function startOver() {
    const confirmed = await ask({
      title: "Start a new ledger?",
      detail: "The saved data will first be copied to a backup entry in this browser's storage. Nothing is deleted.",
      action: "start a new ledger",
    });
    if (!confirmed) return;
    const result = store.startOver();
    sync();
    render({ focus: true });
    if (!result.ok) announce(`Could not start over. ${result.reason}`);
    else if (result.backupKey) announce(`Started a new ledger. The old data is kept under ${result.backupKey}.`);
    else announce("Started a new ledger.");
  }

  return {
    title: "Saved data unreadable",
    nodes: [
      heading("Saved expenses could not be read"),
      h("p", { id: "unreadable-reason" }, state.reason),
      h("p", {}, "Nothing has been changed or deleted, and nothing will be saved until this is resolved."),
      h("details", {}, h("summary", {}, "show the saved data"), saved),
      h("p", {}, h("button", { type: "button", class: "btn danger", id: "start-over", onclick: startOver }, "start a new ledger")),
    ],
  };
}

// ---- actions ---------------------------------------------------------------------------

async function deleteExpense(id) {
  const expense = findExpense(state.ledger, id);
  if (!expense) return;
  const amount = formatCents(expense.amountCents);
  const confirmed = await ask({
    title: "Delete this expense?",
    detail: `${expense.description} — ${amount} — ${expense.date} (${expense.category})`,
    action: "delete",
  });
  if (!confirmed) {
    announce("Nothing was deleted.");
    return;
  }
  const result = store.update((ledger) => removeExpense(ledger, id));
  sync();
  render({ focus: true }); // the button that had focus is gone
  announce(result.ok ? `Deleted ${expense.description}, ${amount}.` : `Not deleted. ${result.reason}`);
}

// ---- rendering -------------------------------------------------------------------------

function renderAlerts() {
  alerts.replaceChildren(
    ...(state.status === "unavailable"
      ? [h("p", { class: "notice error", id: "storage-blocked", role: "alert" }, `${state.reason} Expenses cannot be saved here.`)]
      : []),
  );
}

function render({ focus = false } = {}) {
  const route = parseRoute(location.hash);
  state.route = route;
  if (route.name === "dashboard") state.returnTo = "#/";
  if (route.name === "expenses") state.returnTo = "#/expenses";

  const locked = lock.isLocked();
  let view;
  if (locked) view = lockedView();
  else if (state.status === "unreadable") view = unreadableView();
  else if (route.name === "dashboard") view = dashboardView();
  else if (route.name === "expenses") view = expensesView();
  else if (route.name === "form") view = formView(route.id);
  else view = notFoundView();

  navigation.hidden = locked;
  lockButton.hidden = locked || !lock.enabled;
  renderAlerts();
  main.replaceChildren(...view.nodes);
  document.title = `${view.title} — Expense Tracker`;

  const current = route.name === "form" ? (route.id === null ? "add" : null) : route.name;
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  if (focus) (view.focus ?? main.querySelector("h1"))?.focus();
  document.documentElement.dataset.ready = "true";
}

/** Catches changes made elsewhere: another tab, a new day, a page restored from history. */
function refresh() {
  const statusBefore = state.status;
  if (!sync()) return;
  if (lock.isLocked()) return; // the PIN page shows nothing that could be out of date
  // Redrawing an open form would throw away what is being typed. Saving re-reads storage anyway.
  if (state.route.name === "form" && state.status === statusBefore) return;
  render();
}

let navigating = false;

function navigate(hash) {
  if (location.hash === hash) {
    sync();
    render({ focus: true });
    return;
  }
  navigating = true; // keep the status message that explains why the view changed
  location.hash = hash;
}

// ---- theme -----------------------------------------------------------------------------

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function savedTheme() {
  try {
    const theme = storage?.getItem(keys.theme);
    return theme === "light" || theme === "dark" ? theme : null;
  } catch {
    return null;
  }
}

function showTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.setAttribute("aria-checked", String(theme === "dark"));
}

themeToggle.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  showTheme(theme);
  try {
    storage.setItem(keys.theme, theme);
    announce(`Switched to the ${theme} theme.`);
  } catch {
    announce(`Switched to the ${theme} theme for this visit. The browser would not save the choice.`);
  }
});

// Follow the system setting until an explicit choice has been saved.
systemDark.addEventListener("change", () => {
  if (!savedTheme()) showTheme(systemDark.matches ? "dark" : "light");
});

// ---- wiring ----------------------------------------------------------------------------

window.addEventListener("hashchange", () => {
  if (!navigating) announce("");
  navigating = false;
  sync();
  render({ focus: true });
});

window.addEventListener("storage", (event) => {
  if (event.key === keys.theme || event.key === null) showTheme(savedTheme() ?? (systemDark.matches ? "dark" : "light"));
  if (event.key === keys.ledger || event.key === null) refresh();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
window.addEventListener("pageshow", refresh);
window.addEventListener("focus", refresh);
setInterval(refresh, 30_000); // an open tab notices midnight within half a minute

byId("skip").addEventListener("click", (event) => {
  event.preventDefault(); // "#main" must not be read as a route
  main.focus();
});

lockButton.addEventListener("click", () => {
  lock.lock();
  state.filters = { ...NO_FILTERS }; // a search term is not left behind for the next person
  announce("");
  render({ focus: true });
});

showTheme(savedTheme() ?? (systemDark.matches ? "dark" : "light"));
sync();
render({ focus: lock.isLocked() || parseRoute(location.hash).name === "form" });
