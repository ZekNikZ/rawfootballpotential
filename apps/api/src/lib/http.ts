import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Sends JSON with an ETag and Cache-Control (doc §3.5). A matching If-None-Match gets a 304 with no body.
 * `maxAge` is seconds; completed-season data can use a longer one than live data.
 */
export function sendCacheable(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  maxAge: number,
  /** Identifies the content without hashing the body (records: data version + query), so cache hits and misses agree. */
  etagSeed?: string
) {
  const body = JSON.stringify(payload);
  const etag = `W/"${createHash("sha1")
    .update(etagSeed ?? body)
    .digest("hex")
    .slice(0, 20)}"`;
  reply.header("ETag", etag);
  reply.header("Cache-Control", `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 10}`);
  if (req.headers["if-none-match"] === etag) return reply.code(304).send();
  return reply.type("application/json; charset=utf-8").send(body);
}
