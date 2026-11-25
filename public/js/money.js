// Money is always an integer number of cents. Nothing here does arithmetic on decimal fractions.

import { CURRENCY, LOCALE, MAX_AMOUNT_CENTS } from "./config.js";

const formatter = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY });

/** 123450 -> "$1,234.50" */
export function formatCents(cents) {
  return formatter.format(cents / 100);
}

/** 123450 -> "1234.50", the value an edit form starts with. */
export function centsToInput(cents) {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const PLAIN = /^(\d+)(?:\.(\d{0,2}))?$/; // 12   12.5   12.50   12.
const GROUPED = /^([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{0,2}))?$/; // 1,234.50 but not 0,123
const FRACTION_ONLY = /^\.(\d{1,2})$/; // .5
const TOO_PRECISE = /^[\d,]*\.\d{3,}$/; // 1.234
const DECIMAL_COMMA = /^\d+,\d{1,2}$/; // 12,50

const fail = (error) => ({ ok: false, error });

/**
 * What a person typed -> { ok: true, cents } or { ok: false, error }.
 * The digits are read as text and converted straight to cents, so "0.29" is exactly 29.
 */
export function parseAmount(input) {
  let text = String(input ?? "").trim();
  if (text === "") return fail("Enter an amount.");
  if (text.startsWith("$")) text = text.slice(1).trim();
  if (/^[-−]/.test(text)) return fail("Amount must be more than zero.");

  let whole;
  let fraction;
  let match;
  if ((match = PLAIN.exec(text)) || (match = GROUPED.exec(text))) {
    whole = match[1].replaceAll(",", "");
    fraction = match[2] ?? "";
  } else if ((match = FRACTION_ONLY.exec(text))) {
    whole = "0";
    fraction = match[1];
  } else if (TOO_PRECISE.test(text)) {
    return fail("Use at most 2 decimal places.");
  } else if (DECIMAL_COMMA.test(text)) {
    return fail("Use a full stop for cents, like 12.50.");
  } else {
    return fail("Enter a number like 12.50.");
  }

  const tooLarge = () => fail(`Amount must be ${formatCents(MAX_AMOUNT_CENTS)} or less.`);
  whole = whole.replace(/^0+(?=\d)/, "");
  if (whole.length > 12) return tooLarge(); // far past the limit; avoids imprecise big numbers
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents === 0) return fail("Amount must be more than zero.");
  if (cents > MAX_AMOUNT_CENTS) return tooLarge();
  return { ok: true, cents };
}
