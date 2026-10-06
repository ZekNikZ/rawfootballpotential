import { Response, Router } from "express";
import { GetConfigResponse } from "../../types";
import { makeError, makeResponse } from "../../utils";
import { configService } from "../services";

export const configRouter = Router();

configRouter.get("/config", async (_, res: Response<GetConfigResponse>) => {
  const config = await configService.findOne();

  if (config) {
    return res.json(makeResponse(config));
  } else {
    return res.status(404).json(makeError("Could not find config"));
  }
});
