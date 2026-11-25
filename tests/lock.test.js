import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCESS_PIN } from "../public/js/config.js";
import { UNLOCKED_KEY, createLock, pinMatches } from "../public/js/lock.js";
import { fakeStorage } from "./helpers/fake-storage.js";

test("the PIN is the one the owner chose", () => {
  assert.equal(ACCESS_PIN, "2428");
});

test("only the exact PIN matches", () => {
  assert.equal(pinMatches("2428"), true);
  assert.equal(pinMatches(" 2428 "), true, "spaces around it are ignored");
  for (const wrong of ["", "   ", "2429", "242", "24280", "02428", "2 428", "2428.0", "２４２８", "abcd", null, undefined, 2429]) {
    assert.equal(pinMatches(wrong), false, JSON.stringify(wrong));
  }
  assert.equal(pinMatches(2428), true, "a number is read as its digits");
});

test("a different configured PIN is honoured, and no PIN matches nothing", () => {
  assert.equal(pinMatches("0000", "0000"), true);
  assert.equal(pinMatches("2428", "0000"), false);
  assert.equal(pinMatches("", ""), false);
  assert.equal(pinMatches("anything", ""), false);
});

test("a new tab starts locked and the right PIN unlocks it", () => {
  const session = fakeStorage();
  const lock = createLock(session);
  assert.equal(lock.enabled, true);
  assert.equal(lock.isLocked(), true);

  assert.equal(lock.unlock("0000"), false);
  assert.equal(lock.isLocked(), true, "a wrong PIN leaves it locked");
  assert.equal(session.getItem(UNLOCKED_KEY), null, "and remembers nothing");

  assert.equal(lock.unlock("2428"), true);
  assert.equal(lock.isLocked(), false);
});

test("the same tab stays unlocked across a reload, and a new tab does not", () => {
  const session = fakeStorage();
  createLock(session).unlock("2428");
  assert.equal(createLock(session).isLocked(), false, "a reload: new page, same session storage");
  assert.equal(createLock(fakeStorage()).isLocked(), true, "another tab: its own session storage");
});

test("locking forgets the PIN was entered", () => {
  const session = fakeStorage();
  const lock = createLock(session);
  lock.unlock("2428");
  lock.lock();
  assert.equal(lock.isLocked(), true);
  assert.equal(session.getItem(UNLOCKED_KEY), null);
  assert.equal(createLock(session).isLocked(), true, "and stays locked after a reload");
});

test("with session storage blocked the PIN works for the page load only", () => {
  for (const session of [null, Object.assign(fakeStorage(), { failReads: true, failWrites: "other" })]) {
    const lock = createLock(session);
    assert.equal(lock.isLocked(), true);
    assert.equal(lock.unlock("2428"), true);
    assert.equal(lock.isLocked(), false);
    lock.lock();
    assert.equal(lock.isLocked(), true);
    assert.equal(createLock(session).isLocked(), true, "a reload asks again");
  }
});

test("only the stored value written by unlock counts", () => {
  for (const value of ["no", "true", "1", "", "YES"]) {
    assert.equal(createLock(fakeStorage({ [UNLOCKED_KEY]: value })).isLocked(), true, JSON.stringify(value));
  }
  assert.equal(createLock(fakeStorage({ [UNLOCKED_KEY]: "yes" })).isLocked(), false);
});

test("with no PIN configured the site is never locked", () => {
  const lock = createLock(fakeStorage(), "");
  assert.equal(lock.enabled, false);
  assert.equal(lock.isLocked(), false);
  assert.equal(lock.unlock(""), false, "there is nothing to unlock");
  lock.lock();
  assert.equal(lock.isLocked(), false);
});
