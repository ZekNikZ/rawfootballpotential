import { hashParams, rawPayload, type Db } from "@rfp/db";
import { and, desc, eq } from "@rfp/db";
import { log } from "./log";

export type RawSource = (typeof rawPayload.$inferInsert)["source"];

export { hashParams };

/** Simple spacing limiter: at most `perSecond` calls start per second. Sleeper allows 1000/min; we use ~8/s. */
export class RateLimiter {
  private next = 0;
  constructor(private readonly perSecond: number) {}
  async wait(): Promise<void> {
    const gap = 1000 / this.perSecond;
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

export interface FreshnessPolicy {
  /** Reuse a cached response younger than this. `Infinity` = never re-fetch (immutable data). */
  maxAgeMs: number;
}

export const FOREVER: FreshnessPolicy = { maxAgeMs: Infinity };
export const hours = (n: number): FreshnessPolicy => ({ maxAgeMs: n * 3_600_000 });
export const minutes = (n: number): FreshnessPolicy => ({ maxAgeMs: n * 60_000 });

export interface Fetched<T> {
  data: T;
  /** True when served from raw_payload without hitting the network. */
  cached: boolean;
  fetchedAt: Date;
}

/**
 * Reads/writes raw_payload. Every external response goes through here: a cache hit never touches the
 * network, and each network fetch is stored as a new row (history is kept for stat corrections).
 */
export class RawStore {
  constructor(private readonly db: Db) {}

  async latest(source: RawSource, endpoint: string, params: Record<string, unknown>) {
    const [row] = await this.db
      .select()
      .from(rawPayload)
      .where(
        and(
          eq(rawPayload.source, source),
          eq(rawPayload.endpoint, endpoint),
          eq(rawPayload.paramsHash, hashParams(params))
        )
      )
      .orderBy(desc(rawPayload.fetchedAt))
      .limit(1);
    return row;
  }

  async save(
    source: RawSource,
    endpoint: string,
    params: Record<string, unknown>,
    value: { payload?: unknown; body?: string; httpStatus?: number; bundle?: string }
  ): Promise<void> {
    await this.db.insert(rawPayload).values({
      source,
      endpoint,
      params,
      paramsHash: hashParams(params),
      payload: value.payload ?? null,
      body: value.body ?? null,
      httpStatus: value.httpStatus ?? 200,
      bundle: value.bundle ?? null,
    });
  }

  /** JSON through the cache. `fetcher` returns the parsed body, or `null` for "404 / no data" (also cached). */
  async json<T>(
    source: RawSource,
    endpoint: string,
    params: Record<string, unknown>,
    policy: FreshnessPolicy,
    fetcher: () => Promise<T | null>,
    opts: { force?: boolean } = {}
  ): Promise<Fetched<T | null>> {
    const hit = await this.latest(source, endpoint, params);
    if (hit && !opts.force && Date.now() - hit.fetchedAt.getTime() < policy.maxAgeMs) {
      return { data: (hit.payload as T | null) ?? null, cached: true, fetchedAt: hit.fetchedAt };
    }
    const data = await fetcher();
    await this.save(source, endpoint, params, { payload: data });
    log.debug({ source, endpoint }, "raw payload stored");
    return { data, cached: false, fetchedAt: new Date() };
  }

  /** Text (CSV) through the cache. */
  async text(
    source: RawSource,
    endpoint: string,
    params: Record<string, unknown>,
    policy: FreshnessPolicy,
    fetcher: () => Promise<string | null>,
    opts: { force?: boolean } = {}
  ): Promise<Fetched<string | null>> {
    const hit = await this.latest(source, endpoint, params);
    if (hit && !opts.force && Date.now() - hit.fetchedAt.getTime() < policy.maxAgeMs) {
      return { data: hit.body ?? null, cached: true, fetchedAt: hit.fetchedAt };
    }
    const body = await fetcher();
    await this.save(source, endpoint, params, { body: body ?? undefined });
    return { data: body, cached: false, fetchedAt: new Date() };
  }
}
