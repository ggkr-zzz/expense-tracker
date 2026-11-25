// Product constants. See docs/product.md before changing one.

export const LOCALE = "en-AU";
export const CURRENCY = "AUD";

/** 0 = Sunday, 1 = Monday. */
export const WEEK_STARTS_ON = 1;

/**
 * Adding a category is safe: add it here and give it a colour in styles.css (--cat-<slug>).
 * Renaming or removing one makes saved expenses that use it unreadable.
 * `key` is the letter that labels the category's pie slice, so keep keys unique.
 */
export const CATEGORIES = [
  { name: "Food", key: "F", slug: "food" },
  { name: "Transport", key: "T", slug: "transport" },
  { name: "Bills", key: "B", slug: "bills" },
  { name: "Shopping", key: "S", slug: "shopping" },
  { name: "Entertainment", key: "E", slug: "entertainment" },
  { name: "Health", key: "H", slug: "health" },
  { name: "Other", key: "O", slug: "other" },
];

export const CATEGORY_NAMES = CATEGORIES.map((category) => category.name);

/** $1,000,000.00 */
export const MAX_AMOUNT_CENTS = 100_000_000;
export const MAX_DESCRIPTION_LENGTH = 100;
export const MIN_DATE = "2000-01-01";
export const MAX_DATE = "2099-12-31";

/** How many expenses the dashboard lists. */
export const RECENT_COUNT = 5;

/**
 * The PIN asked for before the site shows anything. Set it to "" to turn the PIN page off.
 *
 * This is a privacy screen, not security. The PIN is in this file, which every visitor's
 * browser downloads, so anyone who looks at the page source can read it, and the expenses
 * themselves sit unencrypted in the browser's storage. Do not use a PIN you use anywhere else.
 */
export const ACCESS_PIN = "2428";

export const STORAGE_PREFIX = "expense-tracker";
