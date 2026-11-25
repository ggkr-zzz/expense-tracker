// The PIN page's logic. See ACCESS_PIN in config.js for what this does and does not protect.

import { ACCESS_PIN, STORAGE_PREFIX } from "./config.js";

/** Where a tab remembers that the PIN was entered. Session storage: it is forgotten when the tab closes. */
export const UNLOCKED_KEY = `${STORAGE_PREFIX}.unlocked`;

/** Spaces around what was typed are ignored; nothing else is. */
export function pinMatches(entered, pin = ACCESS_PIN) {
  return pin !== "" && String(entered ?? "").trim() === pin;
}

/**
 * `session` is a Storage-like object (the browser's sessionStorage) or null.
 * With no PIN configured the site is never locked. If session storage is blocked, the PIN
 * still works but has to be entered again after every reload.
 */
export function createLock(session, pin = ACCESS_PIN) {
  let unlockedThisPageLoad = false;

  function remembered() {
    try {
      return session?.getItem(UNLOCKED_KEY) === "yes";
    } catch {
      return false;
    }
  }

  return {
    /** False when no PIN is configured. */
    enabled: pin !== "",

    isLocked() {
      return pin !== "" && !unlockedThisPageLoad && !remembered();
    },

    /** True when the PIN was right, in which case this tab stays unlocked until it is locked or closed. */
    unlock(entered) {
      if (!pinMatches(entered, pin)) return false;
      unlockedThisPageLoad = true;
      try {
        session?.setItem(UNLOCKED_KEY, "yes");
      } catch {
        // Not remembered across reloads; still unlocked for this page load.
      }
      return true;
    },

    lock() {
      unlockedThisPageLoad = false;
      try {
        session?.removeItem(UNLOCKED_KEY);
      } catch {
        // Nothing was remembered, so there is nothing to forget.
      }
    },
  };
}
