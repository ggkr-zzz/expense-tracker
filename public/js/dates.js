// Calendar dates are "YYYY-MM-DD" strings in the user's local calendar.
// They sort and compare correctly as plain strings. Never build one with
// new Date("YYYY-MM-DD") or toISOString(): both use UTC and can land on the wrong day.

import { MAX_DATE, MIN_DATE } from "./config.js";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(iso) {
  const match = ISO_DATE.exec(iso);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

const pad = (number, width = 2) => String(number).padStart(width, "0");

function toISO(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// UTC is used only as a calendar calculator here: it has no daylight-saving gaps.
function toUTC(iso) {
  const [year, month, day] = parts(iso);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUTC(date) {
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A real calendar date inside the supported range. */
export function isValidDate(iso) {
  if (typeof iso !== "string" || !ISO_DATE.test(iso)) return false;
  if (iso < MIN_DATE || iso > MAX_DATE) return false;
  const [year, month, day] = parts(iso);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** The local calendar date of a moment in time, e.g. "2026-04-08". */
export function localISODate(moment = new Date()) {
  return toISO(moment.getFullYear(), moment.getMonth() + 1, moment.getDate());
}

export function addDays(iso, count) {
  const date = toUTC(iso);
  date.setUTCDate(date.getUTCDate() + count);
  return fromUTC(date);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(iso) {
  return toUTC(iso).getUTCDay();
}

/** The seven days containing `today`, starting on `weekStartsOn` (1 = Monday). */
export function weekRange(today, weekStartsOn = 1) {
  const daysSinceStart = (dayOfWeek(today) - weekStartsOn + 7) % 7;
  const start = addDays(today, -daysSinceStart);
  return { start, end: addDays(start, 6) };
}

/** The calendar month containing `today`. */
export function monthRange(today) {
  const [year, month] = parts(today);
  return { start: toISO(year, month, 1), end: toISO(year, month, daysInMonth(year, month)) };
}

/** Both ends are included. */
export function inRange(iso, { start, end }) {
  return iso >= start && iso <= end;
}
