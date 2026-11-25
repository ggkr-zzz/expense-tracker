#!/usr/bin/env node
// Headless browser acceptance run. No dependencies: Node 22+ and Chrome or Chromium.
//
//   node tests/e2e/run.js                      run the checks
//   node tests/e2e/run.js --screenshots <dir>  also save screenshots of every view in both themes
//
// It serves the repository on a random local port and uses a throwaway Chrome profile, so it
// never sees your own browser data. Three passes:
//   acceptance  the in-page run at tests/e2e/ (the known-answer walkthrough and failure cases)
//   keyboard    add and delete an expense using only real key presses
//   edge cases  the bare address and real clock, midnight passing, storage blocked by the browser
// Set CHROME_BIN if Chrome is not in the usual place. Exit code 0 means everything passed.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const TODAY = "2026-04-08";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const screenshotFlag = process.argv.indexOf("--screenshots");
const screenshotDir = screenshotFlag === -1 ? null : resolve(process.argv[screenshotFlag + 1] ?? "screenshots");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

// ---- a static file server for the repository -------------------------------------------

function serve() {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      let file = normalize(join(ROOT, path));
      if (file !== ROOT && !file.startsWith(ROOT + sep)) throw new Error("outside the repository");
      if (path.endsWith("/")) file = join(file, "index.html");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    }
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

// ---- Chrome and the DevTools protocol --------------------------------------------------

function chromeBinary() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "google-chrome";
}

async function launchChrome(profileDir) {
  const chrome = spawn(
    chromeBinary(),
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--use-mock-keychain",
      "--hide-scrollbars",
      "--window-size=1100,900",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = await new Promise((done, giveUp) => {
    let output = "";
    const timer = setTimeout(() => giveUp(new Error(`Chrome did not start within 30 seconds.\n${output}`)), 30_000);
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    chrome.on("error", (error) => {
      clearTimeout(timer);
      giveUp(new Error(`Could not start Chrome at ${chromeBinary()} (${error.message}). Set CHROME_BIN.`));
    });
    chrome.on("exit", (code) => {
      clearTimeout(timer);
      giveUp(new Error(`Chrome exited early with code ${code}.\n${output.slice(0, 2000)}`));
    });
  });
  return { chrome, endpoint };
}

/** A minimal DevTools protocol client over the WebSocket that Node provides. */
async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((done, giveUp) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", () => giveUp(new Error("Could not connect to Chrome's DevTools port.")), { once: true });
  });
  let nextId = 0;
  const waiting = new Map();
  const listeners = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { done, giveUp } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) giveUp(new Error(`${message.error.message} (${JSON.stringify(message.error.data ?? "")})`));
      else done(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  return {
    send(method, params = {}, sessionId = undefined) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      return new Promise((done, giveUp) => waiting.set(id, { done, giveUp }));
    },
    onEvent: (listener) => listeners.push(listener),
    close: () => socket.close(),
  };
}

/** Opens a tab and returns helpers bound to it. Problems the page reports are collected. */
async function openTab(browser) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const problems = [];
  browser.onEvent((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      problems.push(`uncaught error: ${details.exception?.description ?? details.text}`);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      problems.push(`console.error: ${message.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`);
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      problems.push(`browser error: ${message.params.entry.text} ${message.params.entry.url ?? ""}`.trim());
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  async function evaluate(expression) {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async function until(expression, what, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await evaluate(expression).catch(() => false); // the page may be mid-navigation
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((done) => setTimeout(done, 50));
    }
  }

  async function open(url) {
    await send("Page.navigate", { url: "about:blank" });
    await send("Page.navigate", { url });
    await until("document.readyState === 'complete'", `${url} to load`);
  }

  async function press(key, { code = key, keyCode, text } = {}) {
    const event = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...event, text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  }

  return { send, evaluate, until, open, press, problems, close: () => browser.send("Target.closeTarget", { targetId }) };
}

// ---- the three passes ------------------------------------------------------------------

/** The in-page acceptance run: tests/e2e/index.html. */
async function runAcceptance(browser, base) {
  const tab = await openTab(browser);
  await tab.open(`${base}/tests/e2e/`);
  await tab.until("/^(PASS|FAIL)/.test(document.title)", "the acceptance run to finish", 120_000);
  const result = JSON.parse(await tab.evaluate("document.getElementById('result-json').textContent"));
  for (const failure of result.failed) {
    fail(`FAILED  ${failure.section} › ${failure.name}\n  expected: ${JSON.stringify(failure.expected)}\n  actual:   ${JSON.stringify(failure.actual)}`);
  }
  if (tab.problems.length > 0) fail(`The browser reported problems during the run:\n  ${[...new Set(tab.problems)].join("\n  ")}`);
  console.log(`acceptance: ${result.total - result.failed.length} of ${result.total} checks passed`);
  await tab.close();
}

/** Add and delete an expense with real key presses only: Tab, Enter, Escape and typing. */
async function runKeyboard(browser, base) {
  const tab = await openTab(browser);
  const checks = [];
  const check = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push(pass);
    if (!pass) fail(`FAILED  keyboard › ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  };
  const KEYS = { Tab: { keyCode: 9 }, Enter: { keyCode: 13, text: "\r" }, Escape: { keyCode: 27 } };
  const press = (key) => tab.press(key, KEYS[key]);
  const focused = () => tab.evaluate("(() => { const e = document.activeElement; return e.id || e.getAttribute('aria-label') || e.textContent.trim(); })()");
  /** Presses Tab until focus is on the wanted control, as a keyboard user would. */
  const tabTo = async (wanted) => {
    for (let presses = 0; presses < 40; presses += 1) {
      await press("Tab");
      const now = await focused();
      if (typeof wanted === "string" ? now === wanted : wanted.test(now)) return now;
    }
    throw new Error(`Tab never reached ${wanted}`);
  };
  const h1 = () => tab.evaluate("document.querySelector('h1')?.textContent");

  try {
    await tab.open(`${base}/public/index.html?profile=keyboard&today=${TODAY}#/`);
    await tab.until("document.documentElement.dataset.ready === 'true'", "the app");

    await tabTo("+ add");
    await press("Enter");
    await tab.until("document.querySelector('h1')?.textContent === 'Add expense'", "the form");
    check("Enter on the add link opens the form with focus in Amount", await focused(), "amount");

    await tab.send("Input.insertText", { text: "4.50" });
    await tabTo("description"); // the date keeps today's date
    await tab.send("Input.insertText", { text: "Keyboard only" });
    await tabTo("category");
    await tab.press("B", { code: "KeyB", keyCode: 66, text: "B" }); // type-ahead in the list picks Bills
    check("typing a letter chooses a category", await tab.evaluate("document.getElementById('category').value"), "Bills");
    await tabTo("save");
    await press("Enter");
    await tab.until("document.querySelector('h1')?.textContent === 'Dashboard'", "the dashboard after saving");
    check("Enter on Save stores the expense", await tab.evaluate("document.querySelector('#recent .row').textContent"), "Keyboard only$4.502026-04-08Billseditdelete");
    check("focus moves to the new view's heading", await tab.evaluate("document.activeElement.tagName"), "H1");

    await tabTo(/^Delete Keyboard only/);
    await press("Enter");
    await tab.until("document.getElementById('confirm').open", "the delete dialog");
    check("the dialog opens with focus on Cancel", await focused(), "confirm-cancel");
    await press("Escape");
    await tab.until("!document.getElementById('confirm').open", "the dialog to close");
    check("Escape closes the dialog without deleting", await tab.evaluate("document.querySelectorAll('#recent .row').length"), 1);
    check("and focus returns to the control that opened it", await focused(), "Delete Keyboard only, $4.50, 2026-04-08");

    await press("Enter");
    await tab.until("document.getElementById('confirm').open", "the delete dialog");
    await tabTo("confirm-ok");
    await press("Enter");
    await tab.until("document.getElementById('no-expenses') !== null", "the empty dashboard");
    check("Tab to Delete and Enter removes the expense", await h1(), "Dashboard");
    check("the status line says what happened", await tab.evaluate("document.getElementById('status').textContent"), "Deleted Keyboard only, $4.50.");
  } catch (error) {
    check("keyboard pass ran to the end", error.message, "no error");
  }
  if (tab.problems.length > 0) fail(`The browser reported problems during the keyboard pass:\n  ${[...new Set(tab.problems)].join("\n  ")}`);
  console.log(`keyboard:   ${checks.filter(Boolean).length} of ${checks.length} checks passed`);
  await tab.close();
}

/** Things the in-page run cannot reach: the real clock, the bare address, and blocked storage. */
async function runEdgeCases(browser, base) {
  const checks = [];
  const check = (name, actual, expected) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push(pass);
    if (!pass) fail(`FAILED  edge cases › ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  };
  const ready = "document.documentElement.dataset.ready === 'true'";
  const todayTile = "[...document.querySelectorAll('[data-total=today] dd')].map((cell) => cell.textContent)";
  const localDate = "((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)";
  const problems = [];

  // 1. The address a visitor actually uses: no parameters, the real date, the default ledger.
  let tab = await openTab(browser);
  try {
    await tab.open(`${base}/public/`);
    await tab.until(ready, "the app at its bare address");
    const today = await tab.evaluate(`${localDate}(new Date())`);
    check("the bare address opens the dashboard", await tab.evaluate("document.title"), "Dashboard — Expense Tracker");
    check("today is the browser's local date", await tab.evaluate(todayTile), ["$0.00", today]);

    // 2. Midnight passes while the tab is open: an expense dated today stops counting as today's.
    await tab.evaluate(`localStorage.setItem("expense-tracker.ledger.v1", JSON.stringify({ version: 1, nextId: 2, expenses: [{ id: 1, amountCents: 500, date: "${today}", description: "Before midnight", category: "Food" }] }))`);
    await tab.open(`${base}/public/`);
    await tab.until(ready, "the app");
    check("an expense dated today counts as today's", await tab.evaluate(todayTile), ["$5.00", today]);
    const tomorrow = await tab.evaluate(`(() => {
      const noonTomorrow = new Date();
      noonTomorrow.setDate(noonTomorrow.getDate() + 1);
      noonTomorrow.setHours(12, 0, 0, 0);
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...parts) { super(...(parts.length === 0 ? [noonTomorrow.getTime()] : parts)); }
        static now() { return noonTomorrow.getTime(); }
      };
      window.dispatchEvent(new Event("focus")); // the tab regains focus on the next day
      return ${localDate}(noonTomorrow);
    })()`);
    check("after midnight, returning to the tab moves today forward", await tab.evaluate(todayTile), ["$0.00", tomorrow]);
    check("and the expense is still in the ledger", await tab.evaluate("document.querySelector('[data-total=all] .tile-value').textContent"), "$5.00");
  } catch (error) {
    check("clock checks ran to the end", error.message, "no error");
  }
  problems.push(...tab.problems);
  await tab.close();

  // 3. A browser that refuses storage altogether.
  tab = await openTab(browser);
  try {
    await tab.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Access is denied.", "SecurityError"); } });`,
    });
    await tab.open(`${base}/public/index.html#/add`);
    await tab.until(ready, "the app without storage");
    check("blocked storage is announced", await tab.evaluate("document.getElementById('storage-blocked')?.textContent"), "This browser is not letting the site store data. Expenses cannot be saved here.");
    await tab.evaluate(`(() => {
      document.getElementById("amount").value = "3.50";
      document.getElementById("description").value = "Cannot be stored";
      document.getElementById("category").value = "Other";
      document.getElementById("expense-form").requestSubmit();
    })()`);
    check("saving says why it failed", await tab.evaluate("document.getElementById('form-error').textContent"), "Not saved. This browser is not letting the site store data.");
    check("and keeps the form", await tab.evaluate("[document.querySelector('h1').textContent, document.getElementById('amount').value, document.getElementById('description').value]"), ["Add expense", "3.50", "Cannot be stored"]);
    const before = await tab.evaluate("document.documentElement.dataset.theme");
    await tab.evaluate("document.getElementById('theme-toggle').click()");
    check("the theme still switches for this visit", await tab.evaluate("document.documentElement.dataset.theme"), before === "dark" ? "light" : "dark");
  } catch (error) {
    check("blocked-storage checks ran to the end", error.message, "no error");
  }
  problems.push(...tab.problems);
  await tab.close();

  // 4. The widest content on the narrowest screen: nothing may force sideways scrolling.
  tab = await openTab(browser);
  try {
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    const widest = {
      version: 1,
      nextId: 3,
      expenses: [
        { id: 1, amountCents: 100000000, date: TODAY, description: "W".repeat(100), category: "Entertainment" },
        { id: 2, amountCents: 99999999, date: TODAY, description: "Second largest", category: "Transport" },
      ],
    };
    const fits = "document.documentElement.scrollWidth <= document.documentElement.clientWidth";
    await tab.open(`${base}/public/index.html?profile=widest&today=${TODAY}#/`);
    await tab.evaluate(`localStorage.setItem("expense-tracker.widest.ledger.v1", ${JSON.stringify(JSON.stringify(widest))})`);
    const fitsAt = {};
    for (const [view, hash] of Object.entries({ dashboard: "#/", expenses: "#/expenses", edit: "#/edit/1" })) {
      await tab.open(`${base}/public/index.html?profile=widest&today=${TODAY}${hash}`);
      await tab.until(ready, "the app");
      fitsAt[view] = await tab.evaluate(fits);
    }
    check("at 320 px, a 100-character word and million-dollar amounts fit every view", fitsAt, { dashboard: true, expenses: true, edit: true });
    await tab.open(`${base}/public/index.html?profile=widest&today=${TODAY}#/expenses`);
    await tab.until(ready, "the app");
    await tab.evaluate("document.querySelector('#results .row button').click()");
    await tab.until("document.getElementById('confirm').open", "the dialog");
    check("and the delete dialog fits too", await tab.evaluate("(() => { const box = document.getElementById('confirm').getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth; })()"), true);
  } catch (error) {
    check("narrow-screen checks ran to the end", error.message, "no error");
  }
  problems.push(...tab.problems);
  await tab.close();

  if (problems.length > 0) fail(`The browser reported problems during the edge cases:\n  ${[...new Set(problems)].join("\n  ")}`);
  console.log(`edge cases: ${checks.filter(Boolean).length} of ${checks.length} checks passed`);
}

/** Screenshots of each view at desktop and phone width in both themes, for a human to look at. */
async function takeScreenshots(browser, base, directory) {
  await mkdir(directory, { recursive: true });
  const tab = await openTab(browser);
  const ledger = {
    version: 1,
    nextId: 9,
    expenses: [
      { id: 1, amountCents: 185000, date: "2026-04-01", description: "Rent", category: "Bills" },
      { id: 2, amountCents: 8640, date: "2026-04-04", description: "Weekly groceries", category: "Food" },
      { id: 3, amountCents: 5200, date: "2026-04-05", description: "Opal top-up", category: "Transport" },
      { id: 4, amountCents: 12999, date: "2026-04-06", description: "Running shoes", category: "Shopping" },
      { id: 5, amountCents: 2450, date: "2026-04-07", description: "Cinema", category: "Entertainment" },
      { id: 6, amountCents: 3895, date: "2026-04-07", description: "Pharmacy", category: "Health" },
      { id: 7, amountCents: 550, date: "2026-04-08", description: "Flat white", category: "Food" },
      { id: 8, amountCents: 1500, date: "2026-04-08", description: "Birthday card and a rather long description to show wrapping", category: "Other" },
    ],
  };
  const sizes = {
    desktop: { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false },
    tablet: { width: 720, height: 960, deviceScaleFactor: 1, mobile: true },
    phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
    narrow: { width: 320, height: 640, deviceScaleFactor: 2, mobile: true },
  };
  const views = { dashboard: "#/", expenses: "#/expenses", form: "#/add", "form-errors": "#/add", edit: "#/edit/8", delete: "#/expenses", empty: "#/" };
  const url = (profile, hash) => `${base}/public/index.html?profile=${profile}&today=${TODAY}${hash}`;

  await tab.open(url("shots", "#/"));
  await tab.evaluate(`localStorage.setItem("expense-tracker.shots.ledger.v1", ${JSON.stringify(JSON.stringify(ledger))})`);

  for (const theme of ["light", "dark"]) {
    await tab.evaluate(`localStorage.setItem("expense-tracker.theme", "${theme}")`);
    for (const [sizeName, metrics] of Object.entries(sizes)) {
      await tab.send("Emulation.setDeviceMetricsOverride", metrics);
      for (const [view, hash] of Object.entries(views)) {
        await tab.open(url(view === "empty" ? "shots-empty" : "shots", hash));
        await tab.until("document.documentElement.dataset.ready === 'true'", "the app");
        if (view === "form-errors") {
          await tab.evaluate("document.getElementById('amount').value = '12,50'; document.getElementById('expense-form').requestSubmit()");
        }
        if (view === "delete") {
          await tab.evaluate("document.querySelector('#results .row button').click()");
          await tab.until("document.getElementById('confirm').open", "the dialog");
        }
        const { cssContentSize } = await tab.send("Page.getLayoutMetrics");
        const { data } = await tab.send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: metrics.width, height: Math.max(cssContentSize.height, view === "delete" ? metrics.height : 0), scale: 1 },
        });
        await writeFile(join(directory, `${view}-${sizeName}-${theme}.png`), Buffer.from(data, "base64"));
      }
    }
  }
  console.log(`screenshots: saved to ${directory}`);
  await tab.close();
}

// ---- main ------------------------------------------------------------------------------

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const profileDir = await mkdtemp(join(tmpdir(), "expense-tracker-e2e-"));
let chrome;
let browser;
try {
  const launched = await launchChrome(profileDir);
  chrome = launched.chrome;
  browser = await connect(launched.endpoint);
  await runAcceptance(browser, base);
  await runKeyboard(browser, base);
  await runEdgeCases(browser, base);
  if (screenshotDir) await takeScreenshots(browser, base, screenshotDir);
} catch (error) {
  fail(`The run could not finish: ${error.message}`);
} finally {
  await browser?.send("Browser.close").catch(() => {});
  browser?.close();
  chrome?.kill();
  server.close();
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
console.log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
