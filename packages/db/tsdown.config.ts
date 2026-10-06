import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/migrate.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  fixedExtension: false,
});
