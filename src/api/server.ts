import express from "express";
import ViteExpress from "vite-express";
import cors from "cors";

const app = express();
app.use(cors());

app.get("/config", (_, res) =>
  res.json({
    metadata: {
      name: "Raw Football Potential",
    },
    leagues: [
      {
        name: "Redraft",
        color: "blue",
        years: [
          {
            source: "espn",
            year: 2020,
            id: "L123",
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
            id: "L456",
          },
        ],
      },
    ],
  })
);

ViteExpress.listen(app, 8000, () => console.log("Server is listening..."));
