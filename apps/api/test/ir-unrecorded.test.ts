import { describe, expect, it } from "vitest";
import { unrecordedIr } from "../src/info/season-pages";

const rows = (bench: number, ir = 0) => [
  ...Array.from({ length: bench }, () => ({ slotKind: "bench" })),
  ...Array.from({ length: ir }, () => ({ slotKind: "ir" })),
  { slotKind: "starter" },
];

describe("unrecordedIr (players certainly on IR that the data lists as bench)", () => {
  const slots = { benchSlots: 5, irSlots: 1 };
  it("is zero while the bench fits", () => {
    expect(unrecordedIr(rows(5), slots)).toBe(0);
    expect(unrecordedIr(rows(3), slots)).toBe(0);
  });
  it("is the overflow past the bench size, capped by the IR size", () => {
    expect(unrecordedIr(rows(6), slots)).toBe(1);
    expect(unrecordedIr(rows(8), slots)).toBe(1);
    expect(unrecordedIr(rows(8), { benchSlots: 5, irSlots: 3 })).toBe(3);
  });
  it("does not count IR players that were recorded", () => {
    expect(unrecordedIr(rows(5, 1), slots)).toBe(0);
    expect(unrecordedIr(rows(6, 1), slots)).toBe(0);
  });
  it("is zero when the league has no IR slots", () => {
    expect(unrecordedIr(rows(9), { benchSlots: 5, irSlots: 0 })).toBe(0);
  });
});
