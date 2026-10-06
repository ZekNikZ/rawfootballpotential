import { adminInvite, adminUser, eq } from "@rfp/db";
import type { AdminRole } from "@rfp/core/admin";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { JobQueue } from "../src/admin/context";
import { createAuth, type Auth } from "../src/auth/auth";
import { createAccount } from "../src/auth/bootstrap";
import { createInvite } from "../src/auth/invites";
import { createWorld, type World } from "./helpers";

export const ORIGIN = "http://localhost:5173";
export const PASSWORD = "correct horse battery";

export interface SentJob {
  name: string;
  data: Record<string, unknown>;
}

export interface AdminWorld {
  world: World;
  app: FastifyInstance;
  auth: Auth;
  sent: SentJob[];
  /** Every route registered under /api/admin, as "METHOD /path". */
  adminRoutes: string[];
  /** Creates an account and returns its id. */
  addUser: (email: string, role: AdminRole) => Promise<string>;
  /** Signs in and returns a Cookie header value. */
  login: (email: string, password?: string) => Promise<string>;
  call: (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    opts?: { cookie?: string; body?: unknown; origin?: string | null; ip?: string }
  ) => Promise<{ status: number; json: Record<string, any>; headers: Record<string, unknown> }>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test responses are inspected loosely
  newInviteLink: (role: AdminRole, by: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function createAdminWorld(): Promise<AdminWorld> {
  const world = await createWorld();
  const auth = createAuth(world.db, {
    secret: "test-secret-test-secret-test-secret-123",
    origin: ORIGIN,
    secureCookies: false,
  });
  const sent: SentJob[] = [];
  const jobs: JobQueue = {
    send: async (name, data) => {
      sent.push({ name, data });
      return "job-1";
    },
  };
  const app = buildApp({
    db: world.db,
    admin: { db: world.db, auth, jobs, origin: ORIGIN, allowedOrigins: [ORIGIN] },
  });
  const adminRoutes: string[] = [];
  app.addHook("onRoute", (r) => {
    if (!r.url.startsWith("/api/admin")) return;
    for (const m of Array.isArray(r.method) ? r.method : [r.method])
      if (m !== "HEAD" && m !== "OPTIONS") adminRoutes.push(`${m} ${r.url}`);
  });
  await app.ready();

  const call: AdminWorld["call"] = async (method, url, opts = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (opts.ip) headers["x-forwarded-for"] = opts.ip;
    const res = await app.inject({
      method,
      url,
      headers,
      ...(opts.body === undefined ? {} : { payload: JSON.stringify(opts.body) }),
    });
    let json: Record<string, unknown> = {};
    try {
      json = res.json();
    } catch {
      // empty / non-JSON body
    }
    return { status: res.statusCode, json, headers: res.headers };
  };

  // Each sign-in comes from its own address, so the per-IP login rate limit only bites in the test about it.
  let nextIp = 1;
  const login: AdminWorld["login"] = async (email, password = PASSWORD) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": `10.1.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`,
      },
      payload: JSON.stringify({ email, password }),
    });
    if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`);
    const cookies = res.headers["set-cookie"];
    const list = Array.isArray(cookies) ? cookies : [String(cookies)];
    return list.map((c) => c.split(";")[0]).join("; ");
  };

  return {
    world,
    app,
    auth,
    sent,
    adminRoutes,
    addUser: async (email, role) =>
      (await createAccount(auth, { email, name: email.split("@")[0]!, password: PASSWORD, role }))
        .id,
    login,
    call,
    newInviteLink: async (role, by) =>
      (await createInvite(world.db, ORIGIN, { purpose: "invite", role, createdBy: by })).link,
    close: async () => {
      await app.close();
      await world.close();
    },
  };
}

export const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

void adminInvite;
void adminUser;
void eq;
