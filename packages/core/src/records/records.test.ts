import { describe, expect, it } from "vitest";
import { RECORD_CATALOG, getRecordDef } from "./catalog";
import { SORTABLE_COLUMN_TYPES } from "./types";
import { RECORD_DESCRIPTIONS } from "./descriptions";
import { RECORD_SUMMARIES } from "./summaries";
import { RECORD_ALIASES, parseSeasons, queryKey, recordQuerySchema, selectSeasons } from "./query";

describe("record catalog", () => {
  it("gives every record a description, and descriptions.ts has no stale ids", () => {
    for (const r of RECORD_CATALOG)
      expect(r.description?.trim().length ?? 0, `${r.id} has a description`).toBeGreaterThan(20);
    const ids = new Set(RECORD_CATALOG.map((r) => r.id));
    for (const id of Object.keys(RECORD_DESCRIPTIONS))
      expect(ids.has(id), `${id} exists`).toBe(true);
  });

  it("gives every record a short picker summary, and summaries.ts has no stale ids", () => {
    for (const r of RECORD_CATALOG) {
      const len = r.summary?.trim().length ?? 0;
      expect(len, `${r.id} has a summary`).toBeGreaterThan(5);
      expect(len, `${r.id} summary is one short line`).toBeLessThanOrEqual(70);
    }
    const ids = new Set(RECORD_CATALOG.map((r) => r.id));
    for (const id of Object.keys(RECORD_SUMMARIES)) expect(ids.has(id), `${id} exists`).toBe(true);
  });

  it("has unique ids, and every record ranks by one of its own columns", () => {
    const ids = RECORD_CATALOG.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RECORD_CATALOG)
      expect(Number.isInteger(r.version ?? 1) && (r.version ?? 1) >= 1, `${r.id} version`).toBe(
        true
      );
    for (const r of RECORD_CATALOG) {
      expect(
        r.columns.some((col) => col.key === r.sortKey),
        `${r.id} ranks by a column`
      ).toBe(true);
      expect(r.columns.filter((col) => col.ranked).length, `${r.id} has one ranked column`).toBe(1);
      // hints must point at a value that exists in some column key or a documented hint key
      expect(r.engine.length).toBeGreaterThan(0);
    }
  });

  it("ports every legacy record by name", () => {
    const legacy = [
      "Highest score",
      "Lowest score",
      "Largest blowout",
      "Narrowest win",
      "Highest scoring loss",
      "Lowest scoring win",
      "Highest teamwide score",
      "Lowest teamwide score",
      "Highest bench score",
      "Lowest bench score",
      "Highest potential points",
      "Lowest potential points",
      "Highest actual points",
      "Lowest actual points",
      "Highest realized points ratio",
      "Lowest realized points ratio",
      "Most wins",
      "Most losses",
      "Most years in league (YiL)",
      "Highest win percentage",
      "Highest win streak",
      "Highest loss streak",
      "Highest average placement",
      "Highest placement",
      "Lowest placement",
      "Most playoff appearances",
      "Most toilet bowl appearances",
      "Most perfect lineups",
      "Fewest total missed points",
      "Highest lineup IQ",
      "Highest highest score",
      "Lowest lowest score",
      "Highest total points forward (PF)",
      "Highest total points against (PA)",
      "Highest average points forward per game (PFPG)",
      "Highest average points against per game (PAPG)",
    ];
    const names = new Set(RECORD_CATALOG.map((r) => r.legacyName));
    // Legacy records that became the other direction of a sortable record (see RECORD_ALIASES).
    const folded = new Set([
      "Lowest score",
      "Narrowest win",
      "Lowest teamwide score",
      "Lowest bench score",
      "Lowest potential points",
      "Lowest actual points",
      "Lowest realized points ratio",
    ]);
    for (const n of legacy) expect(names.has(n) || folded.has(n), n).toBe(true);
    expect(legacy.length).toBe(36);
  });

  it("covers the doc 4.2-4.4 additions", () => {
    for (const id of [
      "waiver.faab-high",
      "draft.price-high",
      "moves.player",
      "trade.largest",
      "trade.broadest",
      "bench-season.player",
      "uncounted.best",
      "season.retention.high",
      "season.faab.most",
      "career.trades",
    ]) {
      expect(getRecordDef(id), id).toBeDefined();
    }
  });

  it("declares data requirements and active-season policies (doc 3.3)", () => {
    expect(getRecordDef("season.pf.high")?.activeReverse).toBe("complete_only");
    expect(getRecordDef("season.pf.high")?.active).toBe("flag");
    expect(getRecordDef("score.high")?.active).toBe("include");
    expect(getRecordDef("waiver.faab-high")?.requires).toContain("faab");
    expect(getRecordDef("potential.high")?.requires).toContain("playerData");
  });

  it("keeps the old ids of folded records working as sorted views of the survivor", () => {
    for (const [oldId, alias] of Object.entries(RECORD_ALIASES)) {
      expect(getRecordDef(oldId), `${oldId} is gone from the catalog`).toBeUndefined();
      const target = getRecordDef(alias.id);
      expect(target, `${oldId} -> ${alias.id}`).toBeDefined();
      expect(alias.sort, `${oldId} sorts the ranked column`).toBe(target?.sortKey);
      expect(alias.dir, `${oldId} flips the direction`).not.toBe(target?.direction);
    }
  });

  it("only offers sorting on columns the API can order by", () => {
    for (const r of RECORD_CATALOG) {
      const ranked = r.columns.find((col) => col.key === r.sortKey);
      expect(SORTABLE_COLUMN_TYPES.has(ranked!.type), `${r.id} ranked column is sortable`).toBe(
        true
      );
    }
  });

  it("transaction records declare which types count (doc 2)", () => {
    expect(getRecordDef("season.claims.most")?.txTypes).toEqual(["waiver"]);
    expect(getRecordDef("trade.largest")?.txTypes).toEqual(["trade"]);
  });
});

describe("RecordQuery", () => {
  it("fills defaults from an empty query string", () => {
    const q = recordQuerySchema.parse({});
    expect(q).toMatchObject({
      seasons: "all",
      scope: "all",
      median: "default",
      excludeZero: false,
      countedOnly: true,
      limit: 25,
      offset: 0,
    });
  });

  it("parses season lists, ranges and weeks from strings", () => {
    expect(parseSeasons("2023,2024")).toEqual([2023, 2024]);
    expect(parseSeasons("2020-2022")).toEqual({ from: 2020, to: 2022 });
    expect(parseSeasons("all")).toBe("all");
    expect(() => parseSeasons("abc")).toThrow();
    const q = recordQuerySchema.parse({
      seasons: "2022-2024",
      weeks: "3-6",
      positions: "QB,RB",
      excludeZero: "true",
      limit: "10",
      franchise: "7",
    });
    expect(q).toMatchObject({
      seasons: { from: 2022, to: 2024 },
      weeks: { from: 3, to: 6 },
      positions: ["QB", "RB"],
      excludeZero: true,
      limit: 10,
      franchise: 7,
    });
  });

  it("rejects values outside the allowed sets", () => {
    expect(() => recordQuerySchema.parse({ scope: "toilet-bowl" })).toThrow();
    expect(() => recordQuerySchema.parse({ limit: "9999" })).toThrow();
    expect(() => recordQuerySchema.parse({ positions: "XX" })).toThrow();
  });

  it("selects seasons and makes a stable key", () => {
    expect(selectSeasons({ from: 2021, to: 2022 }, [2020, 2021, 2022, 2023])).toEqual([2021, 2022]);
    expect(selectSeasons([2023, 2019], [2020, 2023])).toEqual([2023]);
    expect(selectSeasons("all", [2020, 2023])).toEqual([2020, 2023]);
    const a = recordQuerySchema.parse({ scope: "playoffs", limit: "5" });
    const b = recordQuerySchema.parse({ limit: "5", scope: "playoffs" });
    expect(queryKey(a)).toBe(queryKey(b));
  });
});
