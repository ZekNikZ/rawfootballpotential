import { League } from "../../types";
import { BaseService } from "./base.service";

export class LeagueService extends BaseService<League> {
  constructor() {
    super("leagues");
  }
}

export const leagueService = new LeagueService();
