import { createHash } from "node:crypto";

/** Deterministic hash of request params (key order does not matter). */
export function hashParams(params: Record<string, unknown>): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, val]) => [k, stable(val)])
          )
        : v;
  return createHash("sha1")
    .update(JSON.stringify(stable(params)))
    .digest("hex")
    .slice(0, 16);
}
