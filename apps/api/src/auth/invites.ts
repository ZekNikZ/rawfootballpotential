import { createHash, randomBytes } from "node:crypto";
import { adminInvite, adminSession, adminUser, and, eq, gt, isNull } from "@rfp/db";
import type { Db } from "@rfp/db";
import type { AdminRole } from "@rfp/core/admin";
import { HttpError } from "../lib/http";
import type { Auth } from "./auth";
import { createAccount } from "./bootstrap";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const INVITE_TTL_MS = 3 * 24 * 3_600_000;
export const RESET_TTL_MS = 24 * 3_600_000;

export interface NewInvite {
  purpose: "invite" | "reset";
  role: AdminRole;
  email?: string | undefined;
  userId?: string | undefined;
  createdBy: string;
}

/** Creates a one-time link. Only the token's hash is stored, so the link is shown once and never recoverable. */
export async function createInvite(db: Db, origin: string, input: NewInvite) {
  const token = randomBytes(32).toString("base64url");
  const ttl = input.purpose === "reset" ? RESET_TTL_MS : INVITE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const [row] = await db
    .insert(adminInvite)
    .values({
      tokenHash: hash(token),
      email: input.email ?? null,
      role: input.role,
      purpose: input.purpose,
      userId: input.userId ?? null,
      createdBy: input.createdBy,
      expiresAt,
    })
    .returning({ id: adminInvite.id });
  return { id: row!.id, link: `${origin}/admin/accept?token=${token}`, expiresAt };
}

async function findOpen(db: Db, token: string) {
  const [row] = await db
    .select()
    .from(adminInvite)
    .where(
      and(
        eq(adminInvite.tokenHash, hash(token)),
        isNull(adminInvite.usedAt),
        gt(adminInvite.expiresAt, new Date())
      )
    );
  return row;
}

const INVALID = "This link is invalid, expired or already used";

/** What the accept page shows before the person picks a password. */
export async function inspectInvite(db: Db, token: string) {
  const row = await findOpen(db, token);
  if (!row) throw new HttpError(404, INVALID);
  let email = row.email;
  if (row.purpose === "reset" && row.userId) {
    const [u] = await db
      .select({ email: adminUser.email })
      .from(adminUser)
      .where(eq(adminUser.id, row.userId));
    email = u?.email ?? email;
  }
  return { purpose: row.purpose as "invite" | "reset", role: row.role, email };
}

/** Consumes the invite (exactly once, even under concurrent requests) and creates the account or sets the password. */
export async function acceptInvite(
  db: Db,
  auth: Auth,
  input: { token: string; email?: string | undefined; name?: string | undefined; password: string }
) {
  const row = await findOpen(db, input.token);
  if (!row) throw new HttpError(404, INVALID);
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(input.password);

  // Claim first: the update only matches while used_at is still null.
  const claimed = await db
    .update(adminInvite)
    .set({ usedAt: new Date() })
    .where(and(eq(adminInvite.id, row.id), isNull(adminInvite.usedAt)))
    .returning({ id: adminInvite.id });
  if (claimed.length === 0) throw new HttpError(404, INVALID);

  if (row.purpose === "reset") {
    if (!row.userId) throw new HttpError(400, "Reset link has no account");
    await ctx.internalAdapter.updatePassword(row.userId, passwordHash);
    await db.delete(adminSession).where(eq(adminSession.userId, row.userId));
    return { userId: row.userId, created: false };
  }

  const email = (row.email ?? input.email)?.toLowerCase();
  if (!email) throw new HttpError(400, "An email address is required");
  try {
    const user = await createAccount(auth, {
      email,
      name: input.name ?? email.split("@")[0]!,
      password: input.password,
      role: row.role,
    });
    return { userId: user.id, created: true };
  } catch (err) {
    // The link stays usable if the account couldn't be created (e.g. the email is taken).
    await db.update(adminInvite).set({ usedAt: null }).where(eq(adminInvite.id, row.id));
    throw err;
  }
}
