import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Loads the nearest `.env` walking up from `start` (dev only; containers get real env vars). Never logs values. */
export function loadEnvFile(start: string = process.cwd()): void {
  let dir = start;
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
