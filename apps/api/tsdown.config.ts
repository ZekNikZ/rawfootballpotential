import { defineConfig } from "tsdown";

export default defineConfig({
  // The server, plus the one-off owner bootstrap (run in the image: `node dist/create-owner.js`).
  entry: { server: "src/server.ts", "create-owner": "scripts/create-owner.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  fixedExtension: false,
  // Workspace packages export TS source; bundle them so the runtime image needs only third-party deps.
  deps: { alwaysBundle: [/^@rfp\//] },
});
