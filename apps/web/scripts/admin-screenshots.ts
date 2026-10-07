// Walks the admin area in a real browser: sign in, open every page, check nothing errors, take screenshots
// (light/dark x desktop/mobile). Read-only apart from creating and revoking one invite link.
// Usage (dev server :5173, API :8000, an owner account):
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm --filter @rfp/web admin:screenshots [outDir]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.WEB_URL ?? "http://localhost:5173";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
const outDir = path.resolve(process.argv[2] ?? "../../docs/screenshots/m6");
mkdirSync(outDir, { recursive: true });

const PAGES = [
  "",
  "/site",
  "/leagues",
  "/people",
  "/corrections",
  "/thresholds",
  "/players",
  "/records",
  "/jobs",
  "/import",
  "/users",
  "/audit",
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
);
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
};

for (const scheme of ["light", "dark"] as const) {
  for (const [vp, viewport] of Object.entries({
    desktop: { width: 1280, height: 800 },
    mobile: { width: 390, height: 844 },
  })) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme });
    await ctx.addInitScript(
      ([s]) => {
        localStorage.setItem("mantine-color-scheme-value", s!);
      },
      [scheme]
    );
    const page = await ctx.newPage();
    const problems: string[] = [];
    // The 401 on the first /me probe (before sign-in) is expected; the browser logs it as a console error.
    page.on(
      "console",
      (m) =>
        m.type() === "error" && !m.text().includes("401") && problems.push(`console: ${m.text()}`)
    );
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().includes("/api/") && r.status() !== 401)
        problems.push(`${r.status()} ${r.url()}`);
    });

    // Unauthenticated: guarded pages bounce to sign-in.
    await page.goto(`${base}/admin/leagues`, { waitUntil: "networkidle" });
    if (scheme === "light" && vp === "desktop")
      check(
        page.url().includes("/admin/login?next="),
        "an unauthenticated visit is sent to sign-in"
      );
    await page.screenshot({ path: path.join(outDir, `login.${vp}.${scheme}.png`) });

    await page.getByLabel("Email").fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/admin\/leagues$/);
    if (scheme === "light" && vp === "desktop")
      check(true, "sign-in returns to the page that was asked for");

    for (const p of PAGES) {
      await page.goto(`${base}/admin${p}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      const name = p === "" ? "overview" : p.slice(1);
      await page.screenshot({
        path: path.join(outDir, `${name}.${vp}.${scheme}.png`),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      if (vp === "mobile")
        check(overflow <= 0, `no sideways page scroll on /admin${p} (mobile ${scheme})`);
    }

    if (scheme === "light" && vp === "desktop") {
      // Create an invite link, see the one-time link appear, and revoke it.
      await page.goto(`${base}/admin/users`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Create invite link" }).click();
      await page.getByLabel("One-time link").waitFor();
      const link = await page.getByLabel("One-time link").inputValue();
      check(link.includes("/admin/accept?token="), "an invite produces a one-time link");
      await page.screenshot({
        path: path.join(outDir, `users-invite.${vp}.${scheme}.png`),
        fullPage: true,
      });
      const peek = await ctx.newPage();
      await peek.goto(link, { waitUntil: "networkidle" });
      check(
        await peek.getByText("Join RFP Admin").isVisible(),
        "the invite link opens the accept page"
      );
      await peek.screenshot({ path: path.join(outDir, `accept.${vp}.${scheme}.png`) });
      await peek.close();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Revoke" }).first().click();
      await page.waitForTimeout(500);
      const dead = await ctx.newPage();
      await dead.goto(link, { waitUntil: "networkidle" });
      check(
        await dead.getByText(/invalid, expired or already used/).isVisible(),
        "a revoked link stops working"
      );
      await dead.close();

      // Sign out ends the session.
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/admin\/login/);
      await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
      check(
        page.url().includes("/admin/login"),
        "after signing out the admin area is closed again"
      );
    }

    if (problems.length)
      console.log(`[${scheme} ${vp}] problems:\n  ${[...new Set(problems)].join("\n  ")}`);
    if (problems.length) failures++;
    await ctx.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
