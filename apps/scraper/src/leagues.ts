/** ESPN league ids by our league slug and season. The seasons are also rows in `league_season` (source = espn). */
export const KNOWN_LEAGUES: Record<string, Record<number, string>> = {
  redraft: { 2020: "79321063", 2021: "50111898" },
};
