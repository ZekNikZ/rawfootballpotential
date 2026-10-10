import { describe, expect, it } from "vitest";
import { chainValues, type ChainItem } from "../src/records/engines/trade-chain";

const item = (o: Partial<ChainItem> & Pick<ChainItem, "itemId" | "transactionId">): ChainItem => ({
  sender: null,
  receiver: null,
  direct: 0,
  sentPoints: 0,
  nextItemId: null,
  ...o,
});

describe("estimated trade value chain", () => {
  it("a player who is not traded on is worth his points for the new team", () => {
    const v = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 40 }),
    ]);
    expect(v.get(1)).toBe(40);
  });

  it("adds a proportional share of what the team received when it traded the player on", () => {
    // Trade 1: team 2 gets A (A scores 30 for team 2). Trade 2: team 2 sends A (30 points for it) and B (10 points for it)
    // to team 3 and receives C (scores 50 for team 2) and D (20). A's share of the 70 returned is 30 / 40.
    const v = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 30, nextItemId: 3 }),
      item({ itemId: 2, transactionId: 1, sender: 2, receiver: 1, direct: 5 }),
      item({ itemId: 3, transactionId: 2, sender: 2, receiver: 3, direct: 15, sentPoints: 30 }),
      item({ itemId: 4, transactionId: 2, sender: 2, receiver: 3, direct: 8, sentPoints: 10 }),
      item({ itemId: 5, transactionId: 2, sender: 3, receiver: 2, direct: 50 }),
      item({ itemId: 6, transactionId: 2, sender: 3, receiver: 2, direct: 20 }),
    ]);
    expect(v.get(1)).toBeCloseTo(30 + 0.75 * 70, 6);
    expect(v.get(3)).toBe(15); // the second trade is judged on its own direct points
  });

  it("follows a chain of trades to the end and splits equally when nothing the team sent scored", () => {
    const v = chainValues([
      item({ itemId: 1, transactionId: 1, sender: 1, receiver: 2, direct: 10, nextItemId: 2 }),
      // trade 2: team 2 sends A (no points) and gets E, which it trades on in trade 3
      item({ itemId: 2, transactionId: 2, sender: 2, receiver: 3, sentPoints: 0 }),
      item({ itemId: 3, transactionId: 2, sender: 2, receiver: 3, sentPoints: 0 }),
      item({ itemId: 4, transactionId: 2, sender: 3, receiver: 2, direct: 6, nextItemId: 5 }),
      item({ itemId: 5, transactionId: 3, sender: 2, receiver: 4, sentPoints: 6 }),
      item({ itemId: 6, transactionId: 3, sender: 4, receiver: 2, direct: 100 }),
    ]);
    expect(v.get(4)).toBe(106); // E: 6 own points + all of what trade 3 returned (he was the only player sent)
    expect(v.get(1)).toBeCloseTo(10 + 0.5 * 106, 6); // two players sent in trade 2, none scored: equal shares
  });
});
