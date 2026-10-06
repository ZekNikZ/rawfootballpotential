import { CachedProjections, LeagueId, NFLPlayerId } from "../../types";
import { logger } from "../logger";
import { BaseService } from "./base.service";

export class ProjectionsService extends BaseService<CachedProjections> {
  constructor() {
    super("projections-cache");
  }

  async getProjectionsForWeek(
    year: number,
    week: number,
    leagueId: LeagueId,
    leagueScoringSettings?: Record<string, number>
  ): Promise<CachedProjections> {
    const cachedProjections = await this.collection.findOne<CachedProjections>({
      year,
      week,
      leagueId,
    });
    if (cachedProjections) {
      logger.info(`Fetching ${year} WK ${week} (${leagueId}) projections => cached!`);
      return cachedProjections;
    }

    if (!leagueScoringSettings) {
      throw new Error("NOT IMPLEMENTED");
    }

    logger.info(`Fetching ${year} WK ${week} (${leagueId}) projections...`);
    const response = await fetch(
      `https://api.sleeper.app/projections/nfl/${year}/${week}?season_type=regular&position%5B%5D=DB&position%5B%5D=DEF&position%5B%5D=DL&position%5B%5D=FLEX&position%5B%5D=IDP_FLEX&position%5B%5D=K&position%5B%5D=LB&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=REC_FLEX&position%5B%5D=SUPER_FLEX&position%5B%5D=TE&position%5B%5D=WR&position%5B%5D=WRRB_FLEX&order_by=ppr`
    );
    const json = await response.json();

    logger.info(
      `Computing ${year} WK ${week} projected scores with league (${leagueId}) scoring settings...`
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projections = (json as any[]).reduce<Record<NFLPlayerId, number>>((res, proj) => {
      const stats = proj.stats;
      let total = 0;

      if (stats) {
        Object.entries(stats).forEach(([stat, pts]) => {
          total += (pts as number) * (leagueScoringSettings[stat] ?? 0);
        });
      }

      return {
        ...res,
        [proj.player_id as NFLPlayerId]: total,
      };
    }, {});

    const result: CachedProjections = {
      week,
      year,
      leagueId,
      projections,
    };
    await this.collection.insertOne(result);

    return result;
  }
}

export const projectionsService = new ProjectionsService();
