/** Entity ids are opaque to core: numbers from Postgres, strings from sources. */
export type Id = string | number;

export type ResultValue = "W" | "L" | "T";
export type GameType = "regular" | "playoffs" | "toilet_bowl" | "none";
export type Bracket = "winners" | "losers";
export type SlotKind = "starter" | "bench" | "ir" | "taxi";
export type GameResultKind = "h2h" | "median";
