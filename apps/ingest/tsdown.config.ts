import { defineConfig } from "tsdown";

export default defineConfig({
  // The worker, plus the CLI for one-off runs in the image (`node dist/cli.js derive`, `espn <bundle>`, ...).
  entry: { worker: "src/worker.ts", cli: "src/cli.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  fixedExtension: false,
  // Workspace packages export TS source; bundle them so the runtime image needs only third-party deps.
  deps: { alwaysBundle: [/^@rfp\//] },
});
