import { adminInvite, adminSession, auditLog, adminUser, eq } from "@rfp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminWorld, ORIGIN, PASSWORD, tokenOf, type AdminWorld } from "./admin-helpers";

let w: AdminWorld;
let ownerCookie: string;
let adminCookie: string;
let ownerId: string;
let adminId: string;

beforeAll(async () => {
  w = await createAdminWorld();
  ownerId = await w.addUser("owner@example.com", "owner");
  adminId = await w.addUser("admin@example.com", "admin");
  ownerCookie = await w.login("owner@example.com");
  adminCookie = await w.login("admin@example.com");
});
afterAll(async () => {
  await w?.close();
});

/** Fills `:param` segments with a harmless placeholder. */
const concrete = (route: string) => route.replace(/:[a-zA-Z]+/g, "1");
const OWNER_ONLY = /^(GET|POST|PATCH|DELETE|PUT) \/api\/admin\/(users|invites)/;

describe("authentication", () => {
  it("every admin route rejects a request with no session", async () => {
    expect(w.adminRoutes.length).toBeGreaterThan(30);
    for (const route of w.adminRoutes) {
      const [method, path] = route.split(" ") as [Parameters<typeof w.call>[0], string];
      const res = await w.call(method, concrete(path), { body: {} });
      expect(res.status, route).toBe(401);
    }
  });

  it("rejects a forged / garbage session cookie", async () => {
    const res = await w.call("GET", "/api/admin/me", { cookie: "rfp.session_token=nope.nope" });
    expect(res.status).toBe(401);
  });

  it("signs in with the right password and not with a wrong one", async () => {
    const me = await w.call("GET", "/api/admin/me", { cookie: ownerCookie });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ email: "owner@example.com", role: "owner" });
    await expect(w.login("owner@example.com", "wrong password here")).rejects.toThrow();
  });

  it("has no sign-up and exposes only sign-in / sign-out / session from better-auth", async () => {
    for (const path of [
      "/api/auth/sign-up/email",
      "/api/auth/admin/create-user",
      "/api/auth/forget-password",
      "/api/auth/admin/list-users",
    ]) {
      const res = await w.call("POST", path, {
        body: { email: "x@example.com", password: PASSWORD, name: "x" },
      });
      expect(res.status, path).toBe(404);
    }
    const count = await w.world.db.select().from(adminUser);
    expect(count.map((u) => u.email).sort()).toEqual(["admin@example.com", "owner@example.com"]);
  });

  it("rate limits repeated failed logins", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await w.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-forwarded-for": "9.9.9.9",
        },
        payload: JSON.stringify({ email: "owner@example.com", password: "bad bad bad bad" }),
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses).toContain(429);
  });
});

describe("authorization", () => {
  it("lets an admin use the config endpoints but not the owner-only ones", async () => {
    expect((await w.call("GET", "/api/admin/site", { cookie: adminCookie })).status).toBe(200);
    for (const route of w.adminRoutes.filter((r) => OWNER_ONLY.test(r))) {
      const [method, path] = route.split(" ") as [Parameters<typeof w.call>[0], string];
      const res = await w.call(method, concrete(path), { cookie: adminCookie, body: {} });
      expect(res.status, route).toBe(403);
    }
  });

  it("covers the owner-only routes the plan lists", () => {
    const owner = w.adminRoutes.filter((r) => OWNER_ONLY.test(r));
    expect(owner).toEqual(
      expect.arrayContaining([
        "GET /api/admin/users",
        "PATCH /api/admin/users/:id",
        "DELETE /api/admin/users/:id",
        "POST /api/admin/users/:id/reset-link",
        "GET /api/admin/invites",
        "POST /api/admin/invites",
        "DELETE /api/admin/invites/:id",
      ])
    );
  });

  it("lets the owner reach the owner-only routes", async () => {
    expect((await w.call("GET", "/api/admin/users", { cookie: ownerCookie })).status).toBe(200);
    expect((await w.call("GET", "/api/admin/invites", { cookie: ownerCookie })).status).toBe(200);
  });

  it("never lets an admin change their own role, even sending the owner's endpoint directly", async () => {
    const res = await w.call("PATCH", `/api/admin/users/${adminId}`, {
      cookie: adminCookie,
      body: { role: "owner" },
    });
    expect(res.status).toBe(403);
    const [u] = await w.world.db.select().from(adminUser).where(eq(adminUser.id, adminId));
    expect(u?.role).toBe("admin");
  });
});

describe("CSRF / origin checks", () => {
  it("rejects a write with no Origin or a foreign one, even with a valid session", async () => {
    for (const origin of [null, "https://evil.example.com"]) {
      const res = await w.call("PUT", "/api/admin/site", {
        cookie: ownerCookie,
        origin,
        body: { name: "Hacked", shortName: "H" },
      });
      expect(res.status, String(origin)).toBe(403);
    }
    const site = await w.call("GET", "/api/admin/site", { cookie: ownerCookie });
    expect(site.json.site.name).not.toBe("Hacked");
  });

  it("allows reads without an Origin header", async () => {
    const res = await w.call("GET", "/api/admin/me", { cookie: ownerCookie, origin: null });
    expect(res.status).toBe(200);
  });

  it("never caches admin responses", async () => {
    const res = await w.call("GET", "/api/admin/site", { cookie: ownerCookie });
    expect(String(res.headers["cache-control"])).toContain("no-store");
  });
});

describe("invites and password links", () => {
  it("an invite creates an account once and only once", async () => {
    const created = await w.call("POST", "/api/admin/invites", {
      cookie: ownerCookie,
      body: { email: "new@example.com", role: "admin" },
    });
    expect(created.status).toBe(201);
    const token = tokenOf(created.json.link);

    // The database only holds a hash of the token.
    const rows = await w.world.db.select().from(adminInvite);
    expect(rows.every((r) => !r.tokenHash.includes(token))).toBe(true);

    const peek = await w.call("GET", `/api/invite?token=${token}`);
    expect(peek.json).toMatchObject({ purpose: "invite", role: "admin", email: "new@example.com" });

    const weak = await w.call("POST", "/api/invite/accept", { body: { token, password: "short" } });
    expect(weak.status).toBe(400);

    const ok = await w.call("POST", "/api/invite/accept", {
      body: { token, name: "Newbie", password: "a brand new password" },
    });
    expect(ok.status).toBe(201);
    const cookie = await w.login("new@example.com", "a brand new password");
    expect((await w.call("GET", "/api/admin/me", { cookie })).json.role).toBe("admin");

    const again = await w.call("POST", "/api/invite/accept", {
      body: { token, name: "Eve", password: "another password here" },
    });
    expect(again.status).toBe(404);
  });

  it("an expired invite is refused", async () => {
    const link = await w.newInviteLink("admin", ownerId);
    const token = tokenOf(link);
    await w.world.db.update(adminInvite).set({ expiresAt: new Date(Date.now() - 1000) });
    const res = await w.call("POST", "/api/invite/accept", {
      body: { token, email: "late@example.com", password: "a brand new password" },
    });
    expect(res.status).toBe(404);
  });

  it("a revoked invite is refused", async () => {
    const created = await w.call("POST", "/api/admin/invites", {
      cookie: ownerCookie,
      body: { role: "admin" },
    });
    const revoke = await w.call("DELETE", `/api/admin/invites/${created.json.id}`, {
      cookie: ownerCookie,
    });
    expect(revoke.status).toBe(204);
    const res = await w.call("POST", "/api/invite/accept", {
      body: {
        token: tokenOf(created.json.link),
        email: "revoked@example.com",
        password: "a brand new password",
      },
    });
    expect(res.status).toBe(404);
  });

  it("a reset link sets a new password and signs the user out everywhere", async () => {
    const victim = await w.addUser("reset@example.com", "admin");
    const oldCookie = await w.login("reset@example.com");
    const link = await w.call("POST", `/api/admin/users/${victim}/reset-link`, {
      cookie: ownerCookie,
    });
    expect(link.status).toBe(200);
    const ok = await w.call("POST", "/api/invite/accept", {
      body: { token: tokenOf(link.json.link), password: "the replacement password" },
    });
    expect(ok.status).toBe(201);
    expect((await w.call("GET", "/api/admin/me", { cookie: oldCookie })).status).toBe(401);
    await expect(w.login("reset@example.com")).rejects.toThrow();
    expect(await w.login("reset@example.com", "the replacement password")).toBeTruthy();
  });

  it("rate limits guessing at invite tokens", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await w.call("GET", `/api/invite?token=${"x".repeat(30)}${i}`, {
        ip: "7.7.7.7",
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("account management", () => {
  it("disabling a user revokes their sessions immediately", async () => {
    const id = await w.addUser("temp@example.com", "admin");
    const cookie = await w.login("temp@example.com");
    expect((await w.call("GET", "/api/admin/site", { cookie })).status).toBe(200);
    const res = await w.call("PATCH", `/api/admin/users/${id}`, {
      cookie: ownerCookie,
      body: { disabled: true },
    });
    expect(res.status).toBe(200);
    expect((await w.call("GET", "/api/admin/site", { cookie })).status).toBe(401);
    await expect(w.login("temp@example.com")).rejects.toThrow();
    const sessions = await w.world.db
      .select()
      .from(adminSession)
      .where(eq(adminSession.userId, id));
    expect(sessions).toHaveLength(0);
  });

  it("a disabled account can't use a session that was already open", async () => {
    const id = await w.addUser("ban@example.com", "admin");
    const cookie = await w.login("ban@example.com");
    // Disabled behind the sessions' back (no session cleanup): the guard still refuses.
    await w.world.db.update(adminUser).set({ banned: true }).where(eq(adminUser.id, id));
    expect((await w.call("GET", "/api/admin/site", { cookie })).status).toBe(403);
  });

  it("a demoted owner loses owner powers at once", async () => {
    const id = await w.addUser("second@example.com", "owner");
    const cookie = await w.login("second@example.com");
    expect((await w.call("GET", "/api/admin/users", { cookie })).status).toBe(200);
    await w.call("PATCH", `/api/admin/users/${id}`, {
      cookie: ownerCookie,
      body: { role: "admin" },
    });
    expect((await w.call("GET", "/api/admin/users", { cookie })).status).toBe(401);
    const fresh = await w.login("second@example.com");
    expect((await w.call("GET", "/api/admin/users", { cookie: fresh })).status).toBe(403);
  });

  it("protects the last active owner and yourself", async () => {
    const owners = (await w.world.db.select().from(adminUser)).filter(
      (u) => u.role === "owner" && !u.banned
    );
    expect(owners.map((o) => o.id)).toEqual([ownerId]);
    for (const [method, body] of [
      ["PATCH", { disabled: true }],
      ["PATCH", { role: "admin" }],
      ["DELETE", undefined],
    ] as const) {
      const res = await w.call(method, `/api/admin/users/${ownerId}`, {
        cookie: ownerCookie,
        body,
      });
      expect(res.status, method).toBe(400);
    }
  });
});

describe("audit trail", () => {
  it("records who changed what, with before and after", async () => {
    const res = await w.call("PUT", "/api/admin/site", {
      cookie: adminCookie,
      body: { name: "Audited League Site", shortName: "ALS" },
    });
    expect(res.status).toBe(200);
    const entries = await w.call("GET", "/api/admin/audit?entity=site_config", {
      cookie: adminCookie,
    });
    const entry = entries.json.entries[0];
    expect(entry).toMatchObject({ action: "site.update", user: "admin@example.com" });
    expect(entry.after).toMatchObject({ name: "Audited League Site" });
    expect(await w.world.db.select().from(auditLog)).not.toHaveLength(0);
  });

  it("public pages pick up the new site name", async () => {
    const res = await w.app.inject({ method: "GET", url: "/api/site" });
    expect(res.json().site.name).toBe("Audited League Site");
  });
});
