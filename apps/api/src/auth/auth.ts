import { adminAccount, adminSession, adminUser, adminVerification, eq } from "@rfp/db";
import type { Db } from "@rfp/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";
import { MIN_PASSWORD_LENGTH } from "@rfp/core/admin";

export interface AuthOptions {
  secret: string;
  /** The public origin the app is served from (cookies, CSRF, links in invites). */
  origin: string;
  /** More origins allowed to make state-changing requests (dev servers). */
  extraOrigins?: string[];
  /** Set the Secure cookie attribute (production, behind TLS). */
  secureCookies: boolean;
}

/**
 * better-auth on our own tables (doc §3.9): email + password only, sign-up disabled (accounts come from invites),
 * roles through the admin plugin, httpOnly SameSite=Lax session cookies, login rate limiting.
 */
const ac = createAccessControl(defaultStatements);

export function createAuth(db: Db, opts: AuthOptions) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.origin,
    basePath: "/api/auth",
    trustedOrigins: [opts.origin, ...(opts.extraOrigins ?? [])],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: adminUser,
        session: adminSession,
        account: adminAccount,
        verification: adminVerification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    advanced: {
      useSecureCookies: opts.secureCookies,
      cookiePrefix: "rfp",
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      storage: "memory",
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await db
              .update(adminUser)
              .set({ lastLoginAt: new Date() })
              .where(eq(adminUser.id, session.userId));
          },
        },
      },
    },
    // The plugin supplies the role / ban columns and refuses sign-in for banned users. Authorization of our own
    // /api/admin endpoints is done by the guard in admin/index.ts; the plugin's own endpoints are not exposed.
    plugins: [
      admin({
        ac,
        roles: { owner: ac.newRole(adminAc.statements), admin: ac.newRole({}) },
        defaultRole: "admin",
        adminRoles: ["owner"],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
