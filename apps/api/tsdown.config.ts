import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  clean: true,
  fixedExtension: false,
  // Workspace packages export TS source; bundle them so the runtime image needs only third-party deps.
  deps: { alwaysBundle: [/^@rfp\//] },
});
