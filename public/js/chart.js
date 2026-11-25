// Pie chart arithmetic and geometry. Pure functions; app.js turns the result into SVG.

const TAU = Math.PI * 2;
const round = (number) => Math.round(number * 1000) / 1000;

/** Slices below this share get no letter beside them: neighbouring letters would collide. */
export const MIN_LABEL_FRACTION = 0.04;

/**
 * Whole-number percentages that always add up to 100 (largest-remainder method).
 * Earlier entries win ties, so the result is deterministic.
 */
export function percentShares(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  // Whole-number arithmetic only: value * 100 = share * total + remainder, exactly.
  const remainders = values.map((value) => (value * 100) % total);
  const shares = values.map((value, index) => (value * 100 - remainders[index]) / total);
  let unassigned = 100 - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = values.map((_, index) => index).sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (const index of byRemainder) {
    if (unassigned === 0) break;
    shares[index] += 1;
    unassigned -= 1;
  }
  return shares;
}

/** Largest first; entries with equal amounts keep the order they were given in. */
export function rankByAmount(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.cents - a.item.cents || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Slices for the items that have an amount, clockwise from 12 o'clock in the order given.
 * Each slice gets `fraction`, `percent`, an SVG path `d` (or `full: true` for a lone slice,
 * which must be drawn as a circle), and a point just outside the pie for its label.
 */
export function pieSlices(items, { cx = 0, cy = 0, r = 50, labelR = 61 } = {}) {
  const visible = items.filter((item) => item.cents > 0);
  const total = visible.reduce((sum, item) => sum + item.cents, 0);
  if (total === 0) return [];

  const percents = percentShares(visible.map((item) => item.cents));
  const point = (angle, radius) => [round(cx + radius * Math.cos(angle)), round(cy + radius * Math.sin(angle))];
  const angleAt = (fraction) => fraction * TAU - TAU / 4;

  let before = 0;
  return visible.map((item, index) => {
    const start = before / total;
    before += item.cents;
    const end = before / total;
    const fraction = end - start;
    const startAngle = angleAt(start);
    const endAngle = angleAt(end);
    const middleAngle = (startAngle + endAngle) / 2;
    const [x0, y0] = point(startAngle, r);
    const [x1, y1] = point(endAngle, r);
    const [labelX, labelY] = point(middleAngle, labelR);

    const full = visible.length === 1;
    let d = null;
    if (!full) {
      // A slice of half the pie or more is drawn as two arcs through its middle. One arc
      // whose ends nearly meet (a 99.99% slice) would otherwise collapse to nothing.
      const [xm, ym] = point(middleAngle, r);
      const arc =
        fraction >= 0.5
          ? `A${r} ${r} 0 0 1 ${xm} ${ym}A${r} ${r} 0 0 1 ${x1} ${y1}`
          : `A${r} ${r} 0 0 1 ${x1} ${y1}`;
      d = `M${cx} ${cy}L${x0} ${y0}${arc}Z`;
    }

    return {
      ...item,
      fraction,
      percent: percents[index],
      full,
      d,
      labelX,
      labelY,
      showLabel: fraction >= MIN_LABEL_FRACTION,
    };
  });
}
