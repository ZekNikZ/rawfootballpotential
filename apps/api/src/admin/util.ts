import { z } from "zod";
import { HttpError } from "../lib/http";

const positiveInt = z.coerce.number().int().positive();

/** A numeric `:id` path param, or a 400. */
export function idParam(raw: string): number {
  const parsed = positiveInt.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Invalid id");
  return parsed.data;
}

/** Postgres unique_violation (23505), whether or not the driver wrapped it. */
export function uniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
