import assert from "node:assert/strict";
import { test } from "node:test";

import { centsToInput, formatCents, parseAmount } from "../public/js/money.js";

function accepted(text) {
  const result = parseAmount(text);
  assert.equal(result.ok, true, `${JSON.stringify(text)} should be accepted, got: ${result.error}`);
  return result.cents;
}

function rejected(text) {
  const result = parseAmount(text);
  assert.equal(result.ok, false, `${JSON.stringify(text)} should be rejected, got ${result.cents} cents`);
  return result.error;
}

test("accepted amounts become exact cents", () => {
  const cases = {
    "12": 1200,
    "12.5": 1250,
    "12.50": 1250,
    "12.": 1200,
    ".5": 50,
    ".05": 5,
    "0.01": 1,
    " 7.30 ": 730,
    "$7.30": 730,
    "$ 7.30": 730,
    "007": 700,
    "0012.50": 1250,
    "1,234": 123400,
    "1,234.50": 123450,
    "999,999.99": 99999999,
    "1000000": 100000000,
    "1,000,000.00": 100000000,
  };
  for (const [text, cents] of Object.entries(cases)) assert.equal(accepted(text), cents, text);
});

test("amounts that binary floating point gets wrong are still exact", () => {
  // 0.29 * 100 is 28.999999999999996, 1.15 * 100 is 114.99999999999999, and so on.
  assert.equal(accepted("0.29"), 29);
  assert.equal(accepted("1.15"), 115);
  assert.equal(accepted("4.35"), 435);
  assert.equal(accepted("19.99"), 1999);
  assert.equal(accepted("0.10") + accepted("0.20"), 30);
  assert.equal(formatCents(accepted("0.10") + accepted("0.20")), "$0.30");
});

test("each kind of bad amount gets its own message", () => {
  for (const text of ["", "   "]) assert.equal(rejected(text), "Enter an amount.", JSON.stringify(text));
  for (const text of ["0", "0.00", "$0", ".00", "-5", "-0.01", "−5", "$-5"]) {
    assert.equal(rejected(text), "Amount must be more than zero.", text);
  }
  for (const text of ["1.234", ".123", "1,234.567", "0.001"]) {
    assert.equal(rejected(text), "Use at most 2 decimal places.", text);
  }
  for (const text of ["12,50", "1,5"]) assert.equal(rejected(text), "Use a full stop for cents, like 12.50.", text);
  for (const text of ["1000000.01", "1,000,000.01", "2000000", "99999999999999999999"]) {
    assert.equal(rejected(text), "Amount must be $1,000,000.00 or less.", text);
  }
  for (const text of ["abc", "1e3", "12.5.0", "1 000", "1,2345", "12,3456", "+5", "$", ".", "0x10", "１２", "Infinity", "NaN"]) {
    assert.equal(rejected(text), "Enter a number like 12.50.", text);
  }
});

test("a comma is only a thousands separator when the grouping is well formed", () => {
  assert.equal(accepted("12,345"), 1234500);
  assert.equal(accepted("123,456.78"), 12345678);
  // "0,123" could be a decimal comma (0.123) or a mistyped 123. It is refused, not guessed.
  for (const text of ["0,123", "012,345", "1,23,456", ",123", "1,,234", "1,234,"]) {
    assert.equal(rejected(text), "Enter a number like 12.50.", text);
  }
});

test("null and undefined are treated as empty", () => {
  assert.equal(rejected(null), "Enter an amount.");
  assert.equal(rejected(undefined), "Enter an amount.");
});

test("cents are formatted as Australian dollars", () => {
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(5), "$0.05");
  assert.equal(formatCents(730), "$7.30");
  assert.equal(formatCents(123450), "$1,234.50");
  assert.equal(formatCents(100000000), "$1,000,000.00");
});

test("the edit form value round-trips through the parser", () => {
  assert.equal(centsToInput(5), "0.05");
  assert.equal(centsToInput(1200), "12.00");
  assert.equal(centsToInput(123450), "1234.50");
  for (const cents of [1, 9, 10, 29, 99, 100, 115, 1999, 123456, 99999999, 100000000]) {
    assert.equal(accepted(centsToInput(cents)), cents);
  }
});
