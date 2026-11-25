// The only module that touches persistent storage. Every function reports what happened
// instead of throwing, and nothing here ever overwrites data it could not read.

import { STORAGE_PREFIX } from "./config.js";
import { emptyLedger, parseLedger, serializeLedger } from "./ledger.js";

const PROFILE = /^[a-z0-9-]{1,24}$/;

/** `profile` selects a separate ledger (see docs/product.md, "URL parameters"). */
export function storageKeys(profile = null) {
  const base = profile && PROFILE.test(profile) ? `${STORAGE_PREFIX}.${profile}` : STORAGE_PREFIX;
  return { ledger: `${base}.ledger.v1`, theme: `${STORAGE_PREFIX}.theme` };
}

/** window.localStorage (or sessionStorage), or null when the browser blocks it. */
export function browserStorage(name = "localStorage") {
  try {
    return globalThis[name] ?? null;
  } catch {
    return null;
  }
}

const BLOCKED = "This browser is not letting the site store data.";

function writeFailure(error) {
  const full = error?.name === "QuotaExceededError" || error?.code === 22;
  return full ? "Browser storage for this site is full." : "The browser refused to save the data.";
}

/**
 * `storage` is a Storage-like object (getItem / setItem) or null.
 *
 * load()   -> { status: "ok", ledger, raw }
 *           | { status: "unreadable", reason, raw }   the saved text is left exactly as it is
 *           | { status: "unavailable", reason }
 * update() -> { ok: true, ledger, ...whatever the change returned }
 *           | { ok: false, status, reason }
 */
export function createLedgerStore(storage, key) {
  function load() {
    if (!storage) return { status: "unavailable", reason: BLOCKED };
    let raw;
    try {
      raw = storage.getItem(key);
    } catch {
      return { status: "unavailable", reason: BLOCKED };
    }
    const parsed = parseLedger(raw);
    if (!parsed.ok) return { status: "unreadable", reason: parsed.reason, raw };
    return { status: "ok", ledger: parsed.ledger, raw };
  }

  function write(ledger) {
    try {
      storage.setItem(key, serializeLedger(ledger));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: writeFailure(error) };
    }
  }

  /**
   * Read, change, write, in one synchronous step. Re-reading first means a change made in
   * another tab is built on, never overwritten. `change(ledger)` returns `{ ledger, ... }`,
   * or null when the expense it wanted is gone.
   */
  function update(change) {
    const current = load();
    if (current.status !== "ok") return { ok: false, status: current.status, reason: current.reason };
    const changed = change(current.ledger);
    if (!changed) return { ok: false, status: "missing", reason: "That expense no longer exists." };
    const written = write(changed.ledger);
    if (!written.ok) return { ok: false, status: "write-failed", reason: written.reason };
    return { ok: true, ...changed };
  }

  /**
   * The way out of an unreadable ledger: copy the saved text to a backup key, then start empty.
   * If the backup cannot be written, nothing is changed.
   */
  function startOver(timestamp = Date.now()) {
    if (!storage) return { ok: false, reason: BLOCKED };
    try {
      const raw = storage.getItem(key);
      const backupKey = raw === null ? null : `${key}.backup-${timestamp}`;
      if (backupKey) storage.setItem(backupKey, raw);
      storage.setItem(key, serializeLedger(emptyLedger()));
      return { ok: true, backupKey };
    } catch (error) {
      return { ok: false, reason: writeFailure(error) };
    }
  }

  return { load, update, startOver };
}
