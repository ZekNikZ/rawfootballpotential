import { Router } from "express";
import { GetConfigResponse } from "../../types";

export const leaguesRouter = Router();

leaguesRouter.get<unknown, GetConfigResponse>("/leagues", (_, res) =>
  res.json({
    success: true,
    data: {
      metadata: {
        name: "Raw Football Potential",
      },
      leagues: [
        {
          name: "Redraft",
          color: "blue",
          years: [
            {
              source: "db",
              year: 2023,
              leagueId: "L-Redraft-2023",
              internalId: "986655084714999808",
            },
          ],
        },
        {
          name: "Dynasty",
          color: "red",
          years: [
            {
              source: "sleeper",
              year: 2023,
              leagueId: "L-Dynasty-2023",
              internalId: "993972607831584768",
            },
          ],
        },
      ],
    },
  })
);
