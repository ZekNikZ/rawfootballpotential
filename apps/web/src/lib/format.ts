const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct2 = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pct1 = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const fmtInt = (n: number) => int.format(n);
export const fmtDecimal = (n: number) => dec2.format(n);
export const fmtPct = (n: number) => pct2.format(n);
export const fmtPct1 = (n: number) => pct1.format(n);
export const fmtMoney = (n: number) => usd.format(n);

/** Ordinal: 1st, 2nd, 3rd, 11th. */
export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = ["th", "st", "nd", "rd"][(v - 20) % 10] ?? ["th", "st", "nd", "rd"][v] ?? "th";
  return `${n}${suffix}`;
}

/** NFL seasons span two calendar years: 2024 is shown as "2024 - 2025". */
export const seasonLabel = (year: number) => `${year} - ${year + 1}`;

export const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Footnote for a lineup whose IR players are listed on the bench because the week predates IR recording. */
export const irMissingNote = (n: number) =>
  n === 1
    ? "1 player on the bench was on IR, but data is missing for which player that was."
    : `${n} players on the bench were on IR, but data is missing for which players those were.`;
