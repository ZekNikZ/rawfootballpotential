import { Router } from "express";
import { Config, GetConfigResponse } from "../../types";
import { client } from "../utils/db";
import { makeError, makeResponse } from "../utils/responses";

export const configRouter = Router();

configRouter.get<unknown, GetConfigResponse>("/config", async (_, res) => {
  const collection = client.db().collection("config");

  const config = await collection.findOne<Config>();

  if (config) {
    return res.json(makeResponse(config));
  } else {
    return res.status(404).json(makeError("Could not find config"));
  }
});
