import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, dayOfWeek, daysInMonth, inRange, isValidDate, localISODate, monthRange, weekRange } from "../public/js/dates.js";

test("only real dates in the supported range are valid", () => {
  for (const date of ["2000-01-01", "2026-04-08", "2024-02-29", "2026-12-31", "2099-12-31"]) {
    assert.equal(isValidDate(date), true, date);
  }
  for (const date of [
    "2026-02-29", // not a leap year
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-04-00",
    "1999-12-31", // before the range
    "2100-01-01", // after the range
    "2026-4-8",
    "08/04/2026",
    "20260408",
    "2026-04-08T00:00",
    "202604-08",
    "",
    null,
    undefined,
    20260408,
  ]) {
    assert.equal(isValidDate(date), false, String(date));
  }
});

test("days in a month, including leap years", () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
});

test("adding days crosses months, years and leap days", () => {
  assert.equal(addDays("2026-04-08", 0), "2026-04-08");
  assert.equal(addDays("2026-04-08", -8), "2026-03-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-28", 2), "2024-03-01");
  assert.equal(addDays("2026-03-01", 365), "2027-03-01");
});

test("day of week", () => {
  assert.equal(dayOfWeek("2026-04-05"), 0); // Sunday
  assert.equal(dayOfWeek("2026-04-06"), 1); // Monday
  assert.equal(dayOfWeek("2026-04-08"), 3); // Wednesday
  assert.equal(dayOfWeek("2026-01-01"), 4); // Thursday
});

test("a Monday-start week contains today whatever day today is", () => {
  const week = { start: "2026-04-06", end: "2026-04-12" };
  assert.deepEqual(weekRange("2026-04-06"), week, "Monday is the first day of its own week");
  assert.deepEqual(weekRange("2026-04-08"), week, "Wednesday");
  assert.deepEqual(weekRange("2026-04-12"), week, "Sunday is the last day, not the first");
  assert.deepEqual(weekRange("2026-04-05"), { start: "2026-03-30", end: "2026-04-05" }, "the Sunday before");
  assert.deepEqual(weekRange("2026-04-13"), { start: "2026-04-13", end: "2026-04-19" }, "the Monday after");
});

test("a week can span a month end and a year end", () => {
  assert.deepEqual(weekRange("2026-01-01"), { start: "2025-12-29", end: "2026-01-04" });
  assert.deepEqual(weekRange("2026-03-31"), { start: "2026-03-30", end: "2026-04-05" });
});

test("the week start is configurable", () => {
  assert.deepEqual(weekRange("2026-04-08", 0), { start: "2026-04-05", end: "2026-04-11" });
  assert.deepEqual(weekRange("2026-04-05", 0), { start: "2026-04-05", end: "2026-04-11" });
  assert.deepEqual(weekRange("2026-04-11", 0), { start: "2026-04-05", end: "2026-04-11" });
});

test("month range covers the whole calendar month", () => {
  assert.deepEqual(monthRange("2026-04-08"), { start: "2026-04-01", end: "2026-04-30" });
  assert.deepEqual(monthRange("2024-02-10"), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(monthRange("2026-12-31"), { start: "2026-12-01", end: "2026-12-31" });
});

test("ranges include both ends", () => {
  const range = { start: "2026-04-06", end: "2026-04-12" };
  assert.equal(inRange("2026-04-06", range), true);
  assert.equal(inRange("2026-04-12", range), true);
  assert.equal(inRange("2026-04-05", range), false);
  assert.equal(inRange("2026-04-13", range), false);
});

test("local date uses the local calendar at both ends of the day", () => {
  assert.equal(localISODate(new Date(2026, 3, 8, 0, 0, 0)), "2026-04-08");
  assert.equal(localISODate(new Date(2026, 3, 8, 23, 59, 59)), "2026-04-08");
  assert.equal(localISODate(new Date(2026, 0, 1, 0, 0, 1)), "2026-01-01");
  assert.equal(localISODate(new Date(2026, 11, 31, 23, 59, 59)), "2026-12-31");
});

test("today is the local date even when UTC is on a different day", () => {
  const original = process.env.TZ;
  try {
    // 14:30 UTC on 7 April is 00:30 on 8 April in Sydney (UTC+10 after daylight saving ends).
    process.env.TZ = "Australia/Sydney";
    const sydneyMorning = new Date("2026-04-07T14:30:00Z");
    assert.equal(sydneyMorning.getHours(), 0, "the test runtime must honour TZ changes");
    assert.equal(localISODate(sydneyMorning), "2026-04-08");
    assert.equal(sydneyMorning.toISOString().slice(0, 10), "2026-04-07", "the UTC date is the day before");

    // 05:30 UTC on 8 April is still 22:30 on 7 April in Los Angeles (UTC-7).
    process.env.TZ = "America/Los_Angeles";
    const laEvening = new Date("2026-04-08T05:30:00Z");
    assert.equal(localISODate(laEvening), "2026-04-07");
    assert.equal(laEvening.toISOString().slice(0, 10), "2026-04-08", "the UTC date is the day after");
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
