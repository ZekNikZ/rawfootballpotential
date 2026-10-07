import type { AdminRole } from "@rfp/core/admin";
import { HttpError } from "../lib/http";
import type { Auth } from "./auth";

/** Creates an email + password account (invite acceptance and the `admin:create-owner` command both use this). */
export async function createAccount(
  auth: Auth,
  input: { email: string; name: string; password: string; role: AdminRole }
): Promise<{ id: string }> {
  const ctx = await auth.$context;
  const email = input.email.toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email))
    throw new HttpError(409, "An account with that email already exists");
  const user = await ctx.internalAdapter.createUser(
    { email, name: input.name, emailVerified: true, role: input.role },
    { method: "admin" }
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(input.password),
  });
  return { id: user.id };
}
