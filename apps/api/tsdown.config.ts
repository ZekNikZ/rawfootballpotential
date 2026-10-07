import { defineConfig } from "tsdown";

export default defineConfig({
  // The server, plus one-off tools run in the image: `node dist/create-owner.js`, `node dist/show-record.js <id>` and
  // `node dist/sweep-records.js [id-prefix]` (read-only record checks against the production database).
  entry: {
    server: "src/server.ts",
    "create-owner": "scripts/create-owner.ts",
    "show-record": "scripts/show-record.ts",
    "sweep-records": "scripts/sweep-records.ts",
  },
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  fixedExtension: false,
  // Workspace packages export TS source; bundle them so the runtime image needs only third-party deps.
  deps: { alwaysBundle: [/^@rfp\//] },
});
