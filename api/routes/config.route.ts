import { Response, Router } from "express";
import { Config, GetConfigResponse } from "../../types";
import { client } from "../db";
import { makeError, makeResponse } from "../../utils";

export const configRouter = Router();

configRouter.get("/config", async (_, res: Response<GetConfigResponse>) => {
  const collection = client.db().collection("config");

  const config = await collection.findOne<Config>();

  if (config) {
    return res.json(makeResponse(config));
  } else {
    return res.status(404).json(makeError("Could not find config"));
  }
});
