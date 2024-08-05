import express from "express";
import ViteExpress from "vite-express";
import cors from "cors";
import { configRouter, leaguesRouter } from "./routes";

const app = express();
app.use(cors());

app.use(configRouter);
app.use(leaguesRouter);

ViteExpress.listen(app, 8000, () => console.log("Server is listening..."));
