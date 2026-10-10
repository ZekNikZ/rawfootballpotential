import { describe, expect, it } from "vitest";
import { chainValues, type ChainItem } from "../src/records/engines/trade-chain";

const item = (o: Partial<ChainItem> & Pick<ChainItem, "itemId" | "transactionId">): ChainItem => ({
  sender: null,
  receiver: null,
  direct: 0,
  weight: 0,
  nextItemId: null,
  ...o,
});

describe("estimated trade value chain", () => {
  it("a player who is not traded on is worth what he was worth to the new team", () => {
    const v = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 40 }),
    ]);
    expect(v.get(1)).toBe(40);
  });

  it("adds a proportional share of what the team received when it traded the player on", () => {
    // Trade 1: team 2 gets A (worth 30 to it). Trade 2: team 2 sends A (weight 30) and B (weight 10) to team 3 and
    // receives C (50) and D (20). A's share of the 70 returned is 30 / 40.
    const v = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 30, nextItemId: 3 }),
      item({ itemId: 2, transactionId: 1, sender: 2, receiver: 1, direct: 5 }),
      item({ itemId: 3, transactionId: 2, sender: 2, receiver: 3, direct: 15, weight: 30 }),
      item({ itemId: 4, transactionId: 2, sender: 2, receiver: 3, direct: 8, weight: 10 }),
      item({ itemId: 5, transactionId: 2, sender: 3, receiver: 2, direct: 50 }),
      item({ itemId: 6, transactionId: 2, sender: 3, receiver: 2, direct: 20 }),
    ]);
    expect(v.get(1)).toBeCloseTo(30 + 0.75 * 70, 6);
    expect(v.get(3)).toBe(15); // the second trade is judged on its own direct value
  });

  it("a draft pick sent in the re-trade takes its share by its own value", () => {
    // Team 2 sends A (weight 30) and a pick (weight 10, a pick's weight is its value) for 80.
    const v = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 30, nextItemId: 2 }),
      item({ itemId: 2, transactionId: 2, sender: 2, receiver: 3, direct: 12, weight: 30 }),
      item({ itemId: 3, transactionId: 2, sender: 2, receiver: 3, direct: 10, weight: 10 }),
      item({ itemId: 4, transactionId: 2, sender: 3, receiver: 2, direct: 80 }),
    ]);
    expect(v.get(1)).toBeCloseTo(30 + 0.75 * 80, 6);
  });

  it("follows a chain to the end; with no weight it splits by what the sent items were worth to their new team, then equally", () => {
    const v = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 10, nextItemId: 2 }),
      // trade 2 (a preseason flip): team 2 sends two players who had no weight for it; they were worth 30 and 10 to
      // team 3. It receives E, which it trades on in trade 3.
      item({ itemId: 2, transactionId: 2, sender: 2, receiver: 3, direct: 30, weight: 0 }),
      item({ itemId: 3, transactionId: 2, sender: 2, receiver: 3, direct: 10, weight: 0 }),
      item({ itemId: 4, transactionId: 2, sender: 3, receiver: 2, direct: 6, nextItemId: 5 }),
      item({ itemId: 5, transactionId: 3, sender: 2, receiver: 4, direct: 0, weight: 6 }),
      item({ itemId: 6, transactionId: 3, sender: 4, receiver: 2, direct: 100 }),
    ]);
    expect(v.get(4)).toBe(106); // E: 6 own + all of trade 3's return (he was the only one sent)
    expect(v.get(1)).toBeCloseTo(10 + 0.75 * 106, 6); // 30 / (30 + 10) of E's value
    const equal = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 10, nextItemId: 2 }),
      item({ itemId: 2, transactionId: 2, sender: 2, receiver: 3 }),
      item({ itemId: 3, transactionId: 2, sender: 2, receiver: 3 }),
      item({ itemId: 4, transactionId: 2, sender: 3, receiver: 2, direct: 8 }),
    ]);
    expect(equal.get(1)).toBeCloseTo(10 + 0.5 * 8, 6);
  });
});

describe("week value with depth credit", () => {
  it("adds half of the points a replacement would have covered", async () => {
    const { weekValue } = await import("../src/records/engines/trade-valuation");
    expect(weekValue(17.96, 17.96, true)).toBeCloseTo(17.96, 6); // nobody could have replaced him
    expect(weekValue(15.2, 0, true)).toBeCloseTo(7.6, 6); // a better QB was on the roster: half credit
    expect(weekValue(20.38, 0.14, true)).toBeCloseTo(0.14 + 0.5 * 20.24, 6);
    expect(weekValue(12, 0, false)).toBe(0); // IR / taxi: no depth credit
    expect(weekValue(2, 5, true)).toBe(5); // a replacement scoring negative points never makes depth negative
  });
});

describe("counted values", () => {
  it("never count a re-trade's return twice, and still net to zero across the league", async () => {
    const { countedValues } = await import("../src/records/engines/trade-valuation");
    // Trade 1: team 1 sends X (item 1) to team 2 for item 0. Trade 2: team 2 sends X on (item 2) to team 3 for R (item 3).
    const list = [
      item({ itemId: 0, transactionId: 1, sender: 2, receiver: 1, direct: 5 }),
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 30, nextItemId: 2 }),
      item({ itemId: 2, transactionId: 2, sender: 2, receiver: 3, direct: 20, weight: 30 }),
      item({ itemId: 3, transactionId: 2, sender: 3, receiver: 2, direct: 80 }),
    ];
    const { chainResolve } = await import("../src/records/engines/trade-chain");
    const { values, links } = chainResolve(list);
    expect(values.get(1)).toBe(110); // X: 30 on team 2 + all of R
    const counted = countedValues(list, links, values);
    expect(counted.get(3)).toBe(0); // R was already credited to trade 1
    expect(counted.get(1)).toBe(110);
    const net = new Map<number, number>();
    for (const it of list) {
      const c = counted.get(it.itemId) ?? 0;
      net.set(it.receiver!, (net.get(it.receiver!) ?? 0) + c);
      net.set(it.sender!, (net.get(it.sender!) ?? 0) - c);
    }
    expect(net.get(2)).toBe(85); // 110 - 5 - 20: R is in there once
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
  });
});
