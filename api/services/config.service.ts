import { Config } from "../../types";
import { BaseService } from "./base.service";

export class ConfigService extends BaseService<Config> {
  constructor() {
    super("config");
  }
}

export const configService = new ConfigService();
