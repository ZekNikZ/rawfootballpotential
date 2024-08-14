import { Router, Response } from "express";
import { GetNFLResponse } from "../../types";
import { nflService } from "../services";
import { makeResponse } from "../../utils";

export const nflRouter = Router();

nflRouter.get("/nfl", async (_, res: Response<GetNFLResponse>) => {
  const data = await nflService.getNFLData();
  return res.json(makeResponse(data));
});
