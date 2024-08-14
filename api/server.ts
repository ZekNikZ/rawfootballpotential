import express from "express";
import cors from "cors";
import { configRouter, leaguesRouter, nflRouter } from "./routes";

const app = express();
app.use(cors());

app.use(configRouter);
app.use(leaguesRouter);
app.use(nflRouter);

app.listen(8000, () => console.log("Server is listening..."));
