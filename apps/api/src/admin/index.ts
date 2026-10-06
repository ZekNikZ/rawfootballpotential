import { adminUser, auditLog, desc, eq, and } from "@rfp/db";
import { acceptInviteInput, ADMIN_ROLES } from "@rfp/core/admin";
import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { acceptInvite, inspectInvite } from "../auth/invites";
import { originGuard } from "../auth/origin";
import { RateLimiter } from "../auth/rate-limit";
import { HttpError } from "../lib/http";
import { registerConfigRoutes } from "./config-routes";
import { parseBody, type AdminDeps } from "./context";
import { registerImportRoutes } from "./import-routes";
import { registerOpsRoutes } from "./ops-routes";
import { registerPeopleRoutes } from "./people-routes";
import { registerResultsRoutes } from "./results-routes";
import { registerUserRoutes, requireOwner } from "./user-routes";
import { pageQuery } from "./util";

/** better-auth endpoints we expose; everything else (sign-up, admin plugin, password flows) stays internal. */
const AUTH_ALLOWLIST = new Set(["/sign-in/email", "/sign-out", "/get-session"]);

/**
 * Auth endpoints, the public invite-accept flow, and the guarded `/api/admin/*` API. Everything under `/api/admin`
 * needs a session of an enabled owner/admin; writes also need a same-origin `Origin` header.
 */
export async function registerAdmin(app: FastifyInstance, deps: AdminDeps) {
  const { db, auth } = deps;
  const origin = originGuard(deps.allowedOrigins);

  // ---- better-auth (sign in / out / session) ----
  await app.register(async (scope) => {
    scope.addHook("onRequest", origin);
    scope.addHook("onSend", async (_req, reply) => {
      reply.header("Cache-Control", "no-store");
    });
    scope.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      handler: async (req, reply) => {
        const path = req.url.split("?")[0]!.replace(/^\/api\/auth/, "");
        if (!AUTH_ALLOWLIST.has(path)) return reply.code(404).send({ error: "Not found" });
        const url = new URL(req.url, `${req.protocol}://${req.hostname}`);
        const request = new Request(url, {
          method: req.method,
          headers: fromNodeHeaders(req.headers),
          ...(req.method === "GET" ? {} : { body: JSON.stringify(req.body ?? {}) }),
        });
        const res = await auth.handler(request);
        reply.code(res.status);
        for (const [k, v] of res.headers) if (k !== "set-cookie") reply.header(k, v);
        const cookies = res.headers.getSetCookie();
        if (cookies.length) reply.header("set-cookie", cookies);
        return reply.send(await res.text());
      },
    });
  });

  // ---- invites: the link is the credential, so this is public but rate limited ----
  const inviteLimiter = new RateLimiter(10, 60_000);
  await app.register(async (scope) => {
    scope.addHook("onRequest", origin);
    scope.addHook("onRequest", async (req) => {
      if (!inviteLimiter.take(req.ip)) throw new HttpError(429, "Too many attempts, wait a minute");
    });
    scope.addHook("onSend", async (_req, reply) => {
      reply.header("Cache-Control", "no-store");
    });
    scope.get("/api/invite", async (req) => {
      const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.query);
      return inspectInvite(db, token);
    });
    scope.post("/api/invite/accept", async (req, reply) => {
      const input = parseBody(acceptInviteInput, req.body);
      const result = await acceptInvite(db, auth, input);
      return reply.code(201).send({ ok: true, created: result.created });
    });
  });

  // ---- the admin API ----
  await app.register(
    async (scope) => {
      scope.addHook("onRequest", origin);
      scope.addHook("onSend", async (_req, reply) => {
        reply.header("Cache-Control", "no-store");
      });
      scope.addHook("preHandler", async (req) => {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (!session) throw new HttpError(401, "Sign in required");
        // Read the account fresh: a disabled or demoted user must lose access immediately.
        const [user] = await db.select().from(adminUser).where(eq(adminUser.id, session.user.id));
        if (!user || user.banned) throw new HttpError(403, "This account is disabled");
        if (!(ADMIN_ROLES as readonly string[]).includes(user.role))
          throw new HttpError(403, "Not an administrator");
        req.admin = { id: user.id, email: user.email, name: user.name, role: user.role };
      });

      scope.get("/me", async (req) => req.admin);

      scope.get("/audit", async (req) => {
        const q = pageQuery
          .extend({ entity: z.string().optional(), entityId: z.string().optional() })
          .parse(req.query);
        const rows = await db
          .select({
            id: auditLog.id,
            at: auditLog.at,
            action: auditLog.action,
            entity: auditLog.entity,
            entityId: auditLog.entityId,
            before: auditLog.before,
            after: auditLog.after,
            userId: auditLog.userId,
            user: adminUser.email,
          })
          .from(auditLog)
          .leftJoin(adminUser, eq(adminUser.id, auditLog.userId))
          .where(
            and(
              q.entity ? eq(auditLog.entity, q.entity) : undefined,
              q.entityId ? eq(auditLog.entityId, q.entityId) : undefined
            )
          )
          .orderBy(desc(auditLog.at), desc(auditLog.id))
          .limit(q.limit)
          .offset(q.offset);
        return { entries: rows };
      });

      registerConfigRoutes(scope, deps);
      registerPeopleRoutes(scope, deps);
      registerResultsRoutes(scope, deps);
      registerOpsRoutes(scope, deps);
      registerUserRoutes(scope, deps);
      await registerImportRoutes(scope, deps);
    },
    { prefix: "/api/admin" }
  );

  void requireOwner;
}
