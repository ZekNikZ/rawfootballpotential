import type { FastifyReply, FastifyRequest } from "fastify";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence in depth on top of SameSite=Lax cookies: a state-changing request must carry an Origin header that is
 * one of ours. Browsers always send Origin on cross-origin and same-origin POST/PUT/PATCH/DELETE.
 */
export function originGuard(allowed: readonly string[]) {
  const set = new Set(allowed.map((o) => o.replace(/\/$/, "")));
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (SAFE.has(req.method)) return;
    const origin = req.headers.origin;
    if (typeof origin !== "string" || !set.has(origin.replace(/\/$/, "")))
      return reply.code(403).send({ error: "Forbidden origin" });
  };
}
