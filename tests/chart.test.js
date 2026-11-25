import assert from "node:assert/strict";
import { test } from "node:test";

import { percentShares, pieSlices, rankByAmount } from "../public/js/chart.js";

const sum = (numbers) => numbers.reduce((total, number) => total + number, 0);

test("shares are whole percentages that add up to 100", () => {
  // 31.5%, 13.7% and 54.8% round down to 98; the two largest remainders get the spare points.
  assert.deepEqual(percentShares([230, 100, 400]), [31, 14, 55]);
  assert.deepEqual(percentShares([1, 1, 1]), [34, 33, 33], "ties go to earlier entries");
  assert.deepEqual(percentShares([1, 1]), [50, 50]);
  assert.deepEqual(percentShares([5]), [100]);
  assert.deepEqual(percentShares([999, 1]), [100, 0]);
  assert.deepEqual(percentShares([0, 10, 0]), [0, 100, 0]);
  for (const values of [[230, 100, 400], [1, 2, 3, 4, 5, 6, 7], [333, 333, 334], [1, 999999], [17, 29, 31, 41, 53, 61, 73]]) {
    assert.equal(sum(percentShares(values)), 100, values.join(","));
  }
});

test("shares stay exact for very large totals", () => {
  // Each value is a whole multiple of the total's hundredth, so the true shares are whole numbers.
  assert.deepEqual(percentShares([55_000_000_000_000, 31_000_000_000_000, 14_000_000_000_000]), [55, 31, 14]);
  assert.deepEqual(percentShares([99_999_999_999, 1]), [100, 0]);
  assert.deepEqual(percentShares([1, 99_999_999_999]), [0, 100]);
});

test("no spending means no shares", () => {
  assert.deepEqual(percentShares([0, 0]), [0, 0]);
  assert.deepEqual(percentShares([]), []);
});

test("ranking is largest first and stable for equal amounts", () => {
  const items = [
    { name: "a", cents: 10 },
    { name: "b", cents: 30 },
    { name: "c", cents: 10 },
    { name: "d", cents: 0 },
  ];
  assert.deepEqual(rankByAmount(items).map((item) => item.name), ["b", "a", "c", "d"]);
  assert.deepEqual(items.map((item) => item.name), ["a", "b", "c", "d"], "the input is not reordered");
});

test("categories with nothing spent get no slice", () => {
  const slices = pieSlices([
    { name: "Food", cents: 300 },
    { name: "Bills", cents: 0 },
    { name: "Other", cents: 100 },
  ]);
  assert.deepEqual(slices.map((slice) => slice.name), ["Food", "Other"]);
  assert.deepEqual(slices.map((slice) => slice.percent), [75, 25]);
  assert.equal(sum(slices.map((slice) => slice.fraction)), 1);
});

test("an empty or all-zero chart has no slices", () => {
  assert.deepEqual(pieSlices([]), []);
  assert.deepEqual(pieSlices([{ name: "Food", cents: 0 }]), []);
});

test("a single category is a full circle, not a zero-length arc", () => {
  const [slice] = pieSlices([{ name: "Food", cents: 500 }]);
  assert.equal(slice.full, true);
  assert.equal(slice.d, null);
  assert.equal(slice.percent, 100);
  assert.equal(slice.fraction, 1);
});

test("slices start at 12 o'clock and run clockwise", () => {
  const [first, second] = pieSlices([{ name: "a", cents: 1 }, { name: "b", cents: 3 }], { r: 50 });
  // A quarter slice goes from the top (0,-50) to the right (50,0).
  assert.equal(first.d, "M0 0L0 -50A50 50 0 0 1 50 0Z");
  // The remaining three quarters go from the right, round the bottom, back to the top.
  assert.match(second.d, /^M0 0L50 0A50 50 0 0 1 /);
  assert.match(second.d, /0 -50Z$/);
});

test("a slice of half or more is drawn as two arcs so it can never collapse", () => {
  const arcs = (d) => (d.match(/A/g) ?? []).length;
  const [half, otherHalf] = pieSlices([{ name: "a", cents: 1 }, { name: "b", cents: 1 }]);
  assert.equal(arcs(half.d), 2);
  assert.equal(arcs(otherHalf.d), 2);

  const [huge, sliver] = pieSlices([{ name: "a", cents: 100000000 }, { name: "b", cents: 1 }]);
  assert.equal(arcs(huge.d), 2);
  assert.equal(arcs(sliver.d), 1);
  // The huge slice passes through the bottom of the circle on its way round.
  assert.match(huge.d, /A50 50 0 0 1 0 50A/);

  const [, small] = pieSlices([{ name: "a", cents: 3 }, { name: "b", cents: 1 }]);
  assert.equal(arcs(small.d), 1);
});

test("labels sit outside the pie at the middle of each slice, and tiny slices get none", () => {
  const slices = pieSlices(
    [
      { name: "a", cents: 50 },
      { name: "b", cents: 47 },
      { name: "c", cents: 3 },
    ],
    { r: 50, labelR: 60 },
  );
  // "a" covers the right half, so its label is due right of the centre.
  assert.equal(slices[0].labelX, 60);
  assert.equal(slices[0].labelY, 0);
  assert.deepEqual(slices.map((slice) => slice.showLabel), [true, true, false]);
  for (const slice of slices) {
    assert.ok(Math.abs(Math.hypot(slice.labelX, slice.labelY) - 60) < 0.01, "label is on the label circle");
  }
});

test("slices keep the extra properties they were given", () => {
  const [slice] = pieSlices([{ name: "Food", key: "F", slug: "food", cents: 5 }]);
  assert.equal(slice.key, "F");
  assert.equal(slice.slug, "food");
});
