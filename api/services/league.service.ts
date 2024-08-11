import { BaseService } from "./base.service";

export class LeagueService extends BaseService<LeagueService> {
  constructor() {
    super("leagues");
  }
}

export const leagueService = new LeagueService();
