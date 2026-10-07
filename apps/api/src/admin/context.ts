import { auditLog } from "@rfp/db";
import type { Db } from "@rfp/db";
import type { AdminRole } from "@rfp/core/admin";
import type { z } from "zod";
import type { Auth } from "../auth/auth";

/** Sends background jobs to the ingest worker (pg-boss in production, a recorder in tests). */
export interface JobQueue {
  send(name: string, data: Record<string, unknown>): Promise<string | null>;
}

export interface AdminDeps {
  db: Db;
  auth: Auth;
  jobs: JobQueue;
  /** Public origin: used to build invite links. */
  origin: string;
  /** Origins allowed to make state-changing requests. */
  allowedOrigins: string[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

declare module "fastify" {
  interface FastifyRequest {
    admin?: AdminUser;
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  return schema.parse(body ?? {});
}

/** Every admin write goes through here: who did what to which entity, with before / after. */
export async function audit(
  db: Db,
  user: AdminUser,
  action: string,
  entity: string,
  entityId: string | number | null,
  before: unknown,
  after: unknown
): Promise<void> {
  await db.insert(auditLog).values({
    userId: user.id,
    action,
    entity,
    entityId: entityId === null ? null : String(entityId),
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
  });
}
