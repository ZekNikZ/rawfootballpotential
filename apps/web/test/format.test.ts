import { describe, expect, it } from "vitest";
import { fmtDecimal, fmtMoney, fmtPct, fmtPct1, ordinal, seasonLabel } from "../src/lib/format";
import { slugify } from "../src/components/records/section-state";
import { numberText } from "../src/components/records/cells";

describe("formatting", () => {
  it("formats numbers the way the tables show them", () => {
    expect(fmtDecimal(236.1)).toBe("236.10");
    expect(fmtDecimal(12361.5)).toBe("12,361.50");
    expect(fmtPct(0.6015625)).toBe("60.16%");
    expect(fmtPct1(0.5)).toBe("50.0%");
    expect(fmtMoney(305)).toBe("$305");
  });
  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
    ]);
  });
  it("labels seasons as two calendar years", () => {
    expect(seasonLabel(2024)).toBe("2024 - 2025");
  });
  it("slugs section titles for URL params", () => {
    expect(slugify("Single Week Scores")).toBe("single-week-scores");
    expect(slugify("Career Lineup IQ")).toBe("career-lineup-iq");
  });
  it("renders missing numbers as a dash, not NaN", () => {
    expect(numberText({ type: "int" }, null)).toBe("–");
    expect(numberText({ type: "pct" }, 0.9035)).toBe("90.35%");
  });
});
