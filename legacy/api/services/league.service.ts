import { League, LeagueId } from "../../types";
import { BaseService } from "./base.service";

export class LeagueService extends BaseService<League> {
  constructor() {
    super("leagues");
  }

  async findById(leagueId: LeagueId): Promise<League | null> {
    return await this.collection.findOne({
      leagueId,
    });
  }
}

export const leagueService = new LeagueService();
