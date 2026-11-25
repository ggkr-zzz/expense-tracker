import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRoute } from "../public/js/routes.js";

test("known routes", () => {
  assert.deepEqual(parseRoute(""), { name: "dashboard" });
  assert.deepEqual(parseRoute("#"), { name: "dashboard" });
  assert.deepEqual(parseRoute("#/"), { name: "dashboard" });
  assert.deepEqual(parseRoute("#/expenses"), { name: "expenses" });
  assert.deepEqual(parseRoute("#/add"), { name: "form", id: null });
  assert.deepEqual(parseRoute("#/edit/1"), { name: "form", id: 1 });
  assert.deepEqual(parseRoute("#/edit/42"), { name: "form", id: 42 });
});

test("anything else is not found rather than guessed", () => {
  for (const hash of ["#/nope", "#/edit", "#/edit/", "#/edit/0", "#/edit/-1", "#/edit/1.5", "#/edit/abc", "#/edit/1/2", "#/edit/01", "#/expenses/", "#main", "#/edit/9999999999999999"]) {
    assert.deepEqual(parseRoute(hash), { name: "not-found" }, hash);
  }
});

test("a missing hash is the dashboard", () => {
  assert.deepEqual(parseRoute(undefined), { name: "dashboard" });
  assert.deepEqual(parseRoute(null), { name: "dashboard" });
});
