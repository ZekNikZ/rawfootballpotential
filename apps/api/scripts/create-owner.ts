// Creates the first owner account. Usage:
//   pnpm admin:create-owner --email you@example.com --name "Your Name"
// The password is read from the ADMIN_PASSWORD environment variable or prompted for (not echoed); it is never printed.
import { createInterface } from "node:readline";
import { createDb } from "@rfp/db";
import { MIN_PASSWORD_LENGTH, passwordSchema } from "@rfp/core/admin";
import { createAuth } from "../src/auth/auth";
import { createAccount } from "../src/auth/bootstrap";
import { loadConfig } from "../src/config";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function promptSecret(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const mutable = rl as unknown as { _writeToOutput?: (s: string) => void };
  let muted = false;
  mutable._writeToOutput = (s) => {
    if (!muted) process.stdout.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const config = loadConfig();
if (!config.BETTER_AUTH_SECRET) throw new Error("Set BETTER_AUTH_SECRET first");
const email = arg("email");
const name = arg("name") ?? "Owner";
if (!email) throw new Error("--email is required");
const password =
  process.env.ADMIN_PASSWORD ??
  (await promptSecret(`Password (min ${MIN_PASSWORD_LENGTH} chars): `));
const checked = passwordSchema.safeParse(password);
if (!checked.success) throw new Error(checked.error.issues[0]!.message);

const { db, pool } = createDb(config.DATABASE_URL, { max: 2 });
const auth = createAuth(db, {
  secret: config.BETTER_AUTH_SECRET,
  origin: config.PUBLIC_URL,
  secureCookies: false,
});
try {
  const user = await createAccount(auth, { email, name, password, role: "owner" });
  console.log(`Owner created (${email}, id ${user.id}).`);
} finally {
  await pool.end();
}
