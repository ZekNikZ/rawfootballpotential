/* eslint-disable @typescript-eslint/no-explicit-any -- legacy records are untyped on purpose (see legacy-world.ts) */
import type { Db } from "@rfp/db";
import type { LegacyWorld } from "./legacy-world";

export async function compareExtras(
  _db: Db,
  _leagueId: number,
  _seasons: string,
  _leagueDef: any,
  _asWas: LegacyWorld,
  _corrected: LegacyWorld,
  _defs: any,
  _legacyDir: string
): Promise<{ lines: string[]; unexplained: number }> {
  return { lines: [], unexplained: 0 };
}
