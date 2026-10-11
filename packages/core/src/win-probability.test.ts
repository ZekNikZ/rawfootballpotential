import { describe, expect, it } from "vitest";
import {
  forecastTeam,
  gameFractionLeft,
  normalCdf,
  winProbability,
  type LiveStarter,
  type TeamForecast,
} from "./win-probability";

const starter = (position: string, projected: number, fractionLeft = 1): LiveStarter => ({
  position,
  projected,
  fractionLeft,
});
const lineup = (n: number, fractionLeft = 1) =>
  Array.from({ length: n }, () => starter("WR", 12, fractionLeft));

describe("normalCdf", () => {
  it("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.841345, 5);
    expect(normalCdf(-1.96)).toBeCloseTo(0.024998, 5);
  });
});

describe("gameFractionLeft", () => {
  const kickoff = new Date("2025-10-12T17:00:00Z");
  it("is 1 before kickoff and 0 once final or on bye", () => {
    expect(gameFractionLeft("scheduled", kickoff, new Date("2025-10-12T16:00:00Z"))).toBe(1);
    expect(gameFractionLeft("final", kickoff, new Date("2025-10-12T21:00:00Z"))).toBe(0);
    expect(gameFractionLeft(null, null, new Date())).toBe(0);
  });
  it("estimates an in-progress game from time since kickoff", () => {
    const half = gameFractionLeft(
      "in_progress",
      kickoff,
      new Date(kickoff.getTime() + 1.625 * 3_600_000)
    );
    expect(half).toBeCloseTo(0.5, 6);
  });
  it("never reads a live game as finished, and treats a stale scheduled status as live", () => {
    expect(
      gameFractionLeft("in_progress", kickoff, new Date(kickoff.getTime() + 6 * 3_600_000))
    ).toBeGreaterThan(0);
    expect(
      gameFractionLeft("scheduled", kickoff, new Date(kickoff.getTime() + 3_600_000))
    ).toBeLessThan(1);
  });
});

describe("winProbability", () => {
  it("is 50% for identical teams", () => {
    const t: TeamForecast = { points: 0, starters: lineup(9) };
    expect(winProbability(t, t)).toBeCloseTo(0.5, 6);
  });

  it("a +26 projected margin with everyone left is a favourite, not a lock", () => {
    const a: TeamForecast = { points: 0, starters: [...lineup(8), starter("WR", 38)] };
    const b: TeamForecast = { points: 0, starters: lineup(9) };
    expect(forecastTeam(a).mean - forecastTeam(b).mean).toBeCloseTo(26, 6);
    const p = winProbability(a, b)!;
    expect(p).toBeGreaterThan(0.65);
    expect(p).toBeLessThan(0.85);
  });

  it("the same +26 lead is far safer when the opponent has one player left", () => {
    const everyone = winProbability(
      { points: 0, starters: [...lineup(8), starter("WR", 38)] },
      { points: 0, starters: lineup(9) }
    )!;
    const oneLeft = winProbability(
      { points: 100, starters: [] },
      { points: 62, starters: [starter("WR", 12)] }
    )!;
    expect(oneLeft).toBeGreaterThan(0.95);
    expect(oneLeft).toBeGreaterThan(everyone);
  });

  it("is symmetric", () => {
    const a: TeamForecast = { points: 40, starters: lineup(5, 0.6) };
    const b: TeamForecast = { points: 55, starters: lineup(3, 0.3) };
    expect(winProbability(a, b)! + winProbability(b, a)!).toBeCloseTo(1, 9);
  });

  it("is decided only when nothing is left, and never 0 or 1 before that", () => {
    expect(winProbability({ points: 90, starters: [] }, { points: 80, starters: [] })).toBe(1);
    expect(winProbability({ points: 80, starters: [] }, { points: 80, starters: [] })).toBe(0.5);
    const nearly = winProbability(
      { points: 200, starters: [] },
      { points: 50, starters: [starter("K", 8, 0.1)] }
    )!;
    expect(nearly).toBeLessThanOrEqual(0.999);
    expect(nearly).toBeGreaterThan(0.99);
  });

  it("returns null when nothing is projected", () => {
    const none: TeamForecast = {
      points: 0,
      starters: [{ position: "WR", projected: null, fractionLeft: 1 }],
    };
    expect(winProbability(none, none)).toBeNull();
  });
});
