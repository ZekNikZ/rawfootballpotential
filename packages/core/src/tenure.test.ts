import { describe, expect, it } from "vitest";
import { buildTenures, type RosterEvent } from "./tenure";
import { draftRetention } from "./retention";
import { countByTeam, movesPerPlayer, tradeSize, type Tx } from "./transactions";
import { displayManager } from "./display";

const base = { firstWeek: 1, throughWeek: 17, seasonComplete: true };

describe("buildTenures", () => {
  it("drafted and never moved = one stint to the final week", () => {
    const res = buildTenures({
      ...base,
      events: [{ playerId: "a", week: 1, kind: "add", via: "draft" }],
    });
    expect(res).toEqual([
      { playerId: "a", fromWeek: 1, toWeek: 17, acquiredVia: "draft", leftVia: "season_end" },
    ]);
  });

  it("a drop in week w ends the stint at w-1", () => {
    const events: RosterEvent[] = [
      { playerId: "a", week: 1, kind: "add", via: "draft" },
      { playerId: "a", week: 6, kind: "remove", via: "drop" },
    ];
    expect(buildTenures({ ...base, events })).toEqual([
      { playerId: "a", fromWeek: 1, toWeek: 5, acquiredVia: "draft", leftVia: "drop" },
    ]);
  });

  it("re-acquiring a dropped player makes a second, non-draft stint", () => {
    const events: RosterEvent[] = [
      { playerId: "a", week: 1, kind: "add", via: "draft" },
      { playerId: "a", week: 4, kind: "remove", via: "drop" },
      { playerId: "a", week: 9, kind: "add", via: "waiver" },
    ];
    const res = buildTenures({ ...base, events });
    expect(res).toHaveLength(2);
    expect(res[1]).toMatchObject({ fromWeek: 9, toWeek: 17, acquiredVia: "waiver" });
  });

  it("add and drop in the same week leaves no stint", () => {
    const events: RosterEvent[] = [
      { playerId: "a", week: 3, kind: "add", via: "free_agent" },
      { playerId: "a", week: 3, kind: "remove", via: "drop" },
    ];
    expect(buildTenures({ ...base, events })).toEqual([]);
  });

  it("leaves open stints un-ended in an incomplete season", () => {
    const res = buildTenures({
      firstWeek: 1,
      throughWeek: 6,
      seasonComplete: false,
      events: [{ playerId: "a", week: 1, kind: "add", via: "draft" }],
    });
    expect(res[0]).toMatchObject({ toWeek: 6, leftVia: null });
  });

  it("a week-1 roster player who was drafted is a draft stint, not 'initial'", () => {
    const res = buildTenures({
      ...base,
      initialPlayers: ["a", "z"],
      events: [{ playerId: "a", week: 1, kind: "add", via: "draft" }],
    });
    expect(res.map((r) => [r.playerId, r.acquiredVia])).toEqual([
      ["a", "draft"],
      ["z", "initial"],
    ]);
  });

  it("players present without an add event start as 'initial'", () => {
    expect(buildTenures({ ...base, initialPlayers: ["z"], events: [] })[0]?.acquiredVia).toBe(
      "initial"
    );
  });
});

describe("draftRetention (doc §2)", () => {
  const draftEvents = (ids: string[]): RosterEvent[] =>
    ids.map((id) => ({ playerId: id, week: 1, kind: "add", via: "draft" }));

  it("kept = same team, continuous from the draft to the final week", () => {
    const tenures = buildTenures({ ...base, events: draftEvents(["a", "b"]) });
    expect(draftRetention(["a", "b"], tenures, 17)).toEqual({ total: 2, kept: 2, pct: 1 });
  });

  it("dropped = not kept, even when re-acquired later by the same team", () => {
    const tenures = buildTenures({
      ...base,
      events: [
        ...draftEvents(["a", "b"]),
        { playerId: "a", week: 4, kind: "remove", via: "drop" },
        { playerId: "a", week: 9, kind: "add", via: "waiver" },
      ],
    });
    expect(draftRetention(["a", "b"], tenures, 17)).toEqual({ total: 2, kept: 1, pct: 0.5 });
  });

  it("traded away = not kept; nothing drafted = null", () => {
    const tenures = buildTenures({
      ...base,
      events: [...draftEvents(["a"]), { playerId: "a", week: 7, kind: "remove", via: "trade" }],
    });
    expect(draftRetention(["a"], tenures, 17).kept).toBe(0);
    expect(draftRetention([], tenures, 17).pct).toBeNull();
  });
});

describe("transactions", () => {
  const add = (playerId: string, toTeam: number, faabBid?: number) => ({
    kind: "player" as const,
    direction: "add" as const,
    playerId,
    toTeam,
    faabBid: faabBid ?? null,
  });
  const drop = (playerId: string, fromTeam: number) => ({
    kind: "player" as const,
    direction: "drop" as const,
    playerId,
    fromTeam,
  });

  it("most moved: dropped by A, claimed by B, traded to C = 3", () => {
    const txs: Tx[] = [
      { id: 1, type: "waiver", status: "complete", week: 2, items: [drop("p", 1)] },
      { id: 2, type: "waiver", status: "complete", week: 3, items: [add("p", 2, 5)] },
      {
        id: 3,
        type: "trade",
        status: "complete",
        week: 5,
        items: [{ kind: "player", direction: "move", playerId: "p", fromTeam: 2, toTeam: 3 }],
      },
    ];
    expect(movesPerPlayer(txs).get("p")).toBe(3);
  });

  it("failed claims are never counted", () => {
    const txs: Tx[] = [
      { id: 1, type: "waiver", status: "failed", week: 2, items: [add("p", 1, 20)] },
      { id: 2, type: "waiver", status: "complete", week: 2, items: [add("p", 2, 3)] },
    ];
    expect(movesPerPlayer(txs).get("p")).toBe(1);
    expect(countByTeam(txs, ["waiver"]).get(1)).toBeUndefined();
    expect(countByTeam(txs, ["waiver"]).get(2)).toEqual({ count: 1, spent: 3 });
  });

  it("a claim with an add and a drop counts once", () => {
    const txs: Tx[] = [
      { id: 1, type: "waiver", status: "complete", week: 2, items: [add("x", 1, 7), drop("y", 1)] },
    ];
    expect(countByTeam(txs, ["waiver"]).get(1)).toEqual({ count: 1, spent: 7 });
  });

  it("free-agent adds count only when the record's txTypes include them", () => {
    const txs: Tx[] = [
      { id: 1, type: "waiver", status: "complete", week: 2, items: [add("x", 1, 2)] },
      { id: 2, type: "free_agent", status: "complete", week: 3, items: [add("y", 1)] },
    ];
    expect(countByTeam(txs, ["waiver"]).get(1)?.count).toBe(1);
    expect(countByTeam(txs, ["waiver", "free_agent"]).get(1)?.count).toBe(2);
  });

  it("trade size counts distinct players; picks and FAAB are extras; broadest counts teams", () => {
    const tx: Tx = {
      id: 1,
      type: "trade",
      status: "complete",
      week: 4,
      items: [
        { kind: "player", direction: "move", playerId: "a", fromTeam: 1, toTeam: 2 },
        { kind: "player", direction: "move", playerId: "b", fromTeam: 2, toTeam: 3 },
        { kind: "player", direction: "move", playerId: "a", fromTeam: 1, toTeam: 2 }, // duplicate row
        { kind: "pick", direction: "move", fromTeam: 3, toTeam: 1 },
        { kind: "faab", direction: "move", amount: 10, fromTeam: 1, toTeam: 3 },
      ],
    };
    expect(tradeSize(tx)).toEqual({ players: 2, teams: 3, picks: 1, faab: 10 });
    expect([...countByTeam([tx], ["trade"]).keys()].sort()).toEqual([1, 2, 3]);
  });
});

describe("displayManager (doc §2)", () => {
  const history = [
    { year: 2022, managers: [{ managerId: "alice", role: "primary" as const }] },
    { year: 2023, managers: [{ managerId: "alice", role: "primary" as const }] },
    {
      year: 2024,
      managers: [
        { managerId: "bob", role: "primary" as const },
        { managerId: "cy", role: "co" as const },
      ],
    },
  ];

  it("single season: that season's manager", () => {
    expect(displayManager(history, { seasons: [2022] }).primary).toBe("alice");
  });

  it("several seasons: the franchise's current (most recent) manager", () => {
    expect(displayManager(history, { seasons: [2022, 2023, 2024] })).toEqual({
      primary: "bob",
      co: ["cy"],
    });
    expect(displayManager(history, { seasons: [] }).primary).toBe("bob");
  });

  it("a single game after a mid-season owner change shows who managed that week", () => {
    const h = [
      {
        year: 2024,
        managers: [
          { managerId: "old", role: "primary" as const, fromWeek: 1, toWeek: 6 },
          { managerId: "new", role: "primary" as const, fromWeek: 7, toWeek: null },
        ],
      },
    ];
    expect(displayManager(h, { seasons: [2024], week: 3 }).primary).toBe("old");
    expect(displayManager(h, { seasons: [2024], week: 9 }).primary).toBe("new");
    expect(displayManager(h, { seasons: [2024] }).primary).toBe("new"); // season total: end-of-season manager
  });
});
