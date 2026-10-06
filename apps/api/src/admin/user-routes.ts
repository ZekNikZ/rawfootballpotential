import { adminInvite, adminSession, adminUser, and, asc, desc, eq, gt, isNull, sql } from "@rfp/db";
import { inviteInput, userPatch } from "@rfp/core/admin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createInvite } from "../auth/invites";
import { HttpError } from "../lib/http";
import { audit, parseBody, type AdminDeps } from "./context";

export function requireOwner(req: FastifyRequest) {
  if (req.admin?.role !== "owner") throw new HttpError(403, "Only an owner can do that");
}

/** Owner-only account management (doc §3.9): invite, reset, disable, change role, remove. */
export function registerUserRoutes(app: FastifyInstance, deps: AdminDeps) {
  const { db, origin } = deps;

  const activeOwners = async () => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(adminUser)
      .where(and(eq(adminUser.role, "owner"), eq(adminUser.banned, false)));
    return row?.n ?? 0;
  };

  app.get("/users", async (req) => {
    requireOwner(req);
    const users = await db
      .select({
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        role: adminUser.role,
        disabled: adminUser.banned,
        lastLoginAt: adminUser.lastLoginAt,
        createdAt: adminUser.createdAt,
      })
      .from(adminUser)
      .orderBy(asc(adminUser.createdAt));
    return { users };
  });

  app.patch<{ Params: { id: string } }>("/users/:id", async (req) => {
    requireOwner(req);
    const patch = parseBody(userPatch, req.body);
    const [before] = await db.select().from(adminUser).where(eq(adminUser.id, req.params.id));
    if (!before) throw new HttpError(404, "Unknown user");
    const self = before.id === req.admin!.id;
    if (self && (patch.role !== undefined || patch.disabled !== undefined))
      throw new HttpError(400, "You can't change your own role or disable yourself");
    const losesOwner =
      before.role === "owner" &&
      !before.banned &&
      ((patch.role !== undefined && patch.role !== "owner") || patch.disabled === true);
    if (losesOwner && (await activeOwners()) <= 1)
      throw new HttpError(400, "There must be at least one active owner");

    const set: Partial<typeof adminUser.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.role !== undefined) set.role = patch.role;
    if (patch.disabled !== undefined) set.banned = patch.disabled;
    const [after] = await db
      .update(adminUser)
      .set(set)
      .where(eq(adminUser.id, before.id))
      .returning();
    // A disabled or demoted user is signed out everywhere right away.
    if (patch.disabled === true || (patch.role !== undefined && patch.role !== before.role))
      await db.delete(adminSession).where(eq(adminSession.userId, before.id));
    await audit(db, req.admin!, "user.update", "admin_user", before.id, pick(before), pick(after!));
    return pick(after!);
  });

  app.delete<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
    requireOwner(req);
    const [before] = await db.select().from(adminUser).where(eq(adminUser.id, req.params.id));
    if (!before) throw new HttpError(404, "Unknown user");
    if (before.id === req.admin!.id) throw new HttpError(400, "You can't remove yourself");
    if (before.role === "owner" && !before.banned && (await activeOwners()) <= 1)
      throw new HttpError(400, "There must be at least one active owner");
    await db.delete(adminUser).where(eq(adminUser.id, before.id));
    await audit(db, req.admin!, "user.delete", "admin_user", before.id, pick(before), null);
    return reply.code(204).send();
  });

  // One-time link for a new password (no email service).
  app.post<{ Params: { id: string } }>("/users/:id/reset-link", async (req) => {
    requireOwner(req);
    const [user] = await db.select().from(adminUser).where(eq(adminUser.id, req.params.id));
    if (!user) throw new HttpError(404, "Unknown user");
    const invite = await createInvite(db, origin, {
      purpose: "reset",
      role: user.role,
      userId: user.id,
      createdBy: req.admin!.id,
    });
    await audit(db, req.admin!, "user.reset_link", "admin_user", user.id, null, {
      inviteId: invite.id,
    });
    return { link: invite.link, expiresAt: invite.expiresAt };
  });

  // ---- invites ----
  app.get("/invites", async (req) => {
    requireOwner(req);
    const rows = await db
      .select({
        id: adminInvite.id,
        email: adminInvite.email,
        role: adminInvite.role,
        purpose: adminInvite.purpose,
        expiresAt: adminInvite.expiresAt,
        createdAt: adminInvite.createdAt,
      })
      .from(adminInvite)
      .where(and(isNull(adminInvite.usedAt), gt(adminInvite.expiresAt, new Date())))
      .orderBy(desc(adminInvite.createdAt));
    return { invites: rows };
  });

  app.post("/invites", async (req, reply) => {
    requireOwner(req);
    const input = parseBody(inviteInput, req.body);
    const invite = await createInvite(db, origin, {
      purpose: "invite",
      role: input.role,
      email: input.email?.toLowerCase(),
      createdBy: req.admin!.id,
    });
    await audit(db, req.admin!, "invite.create", "admin_invite", invite.id, null, {
      email: input.email ?? null,
      role: input.role,
    });
    return reply.code(201).send({ id: invite.id, link: invite.link, expiresAt: invite.expiresAt });
  });

  app.delete<{ Params: { id: string } }>("/invites/:id", async (req, reply) => {
    requireOwner(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
    const [before] = await db.select().from(adminInvite).where(eq(adminInvite.id, id));
    if (!before) throw new HttpError(404, "Unknown invite");
    await db.update(adminInvite).set({ usedAt: new Date() }).where(eq(adminInvite.id, id));
    await audit(db, req.admin!, "invite.revoke", "admin_invite", id, { email: before.email }, null);
    return reply.code(204).send();
  });
}

const pick = (u: typeof adminUser.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  disabled: u.banned,
});
