import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { espnBundle, type EspnBundle } from "@rfp/core/admin";
import type { EspnResponse } from "./espn";

export function buildBundle(
  meta: { league: string; year: number; espnLeagueId: string },
  responses: EspnResponse[]
): EspnBundle {
  const bundle = {
    manifest: { format: 1 as const, ...meta, scrapedAt: new Date().toISOString() },
    responses,
  };
  // The same schema the server validates on import: a bundle that passes here imports.
  return espnBundle.parse(bundle);
}

/** Gzipped JSON, the format the admin import takes. Returns the size in bytes. */
export function writeBundle(path: string, bundle: EspnBundle): number {
  mkdirSync(dirname(path), { recursive: true });
  const buf = gzipSync(Buffer.from(JSON.stringify(bundle)));
  writeFileSync(path, buf);
  return buf.length;
}

export function readBundle(path: string): EspnBundle {
  const raw = readFileSync(path);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return espnBundle.parse(JSON.parse(text.toString("utf8")));
}
