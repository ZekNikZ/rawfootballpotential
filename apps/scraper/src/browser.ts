import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import type { Getter } from "./espn";

const LOGIN_URL = "https://www.espn.com/fantasy/football/";
const WAIT_MS = 10 * 60 * 1000;

export interface LoggedIn {
  get: Getter;
  close: () => Promise<void>;
}

const hasSession = async (ctx: BrowserContext) => {
  const names = new Set((await ctx.cookies("https://www.espn.com")).map((c) => c.name));
  return names.has("espn_s2") && names.has("SWID");
};

/**
 * Opens a headed browser on a persistent profile and waits until the espn_s2 and SWID cookies exist, i.e. until you
 * have logged in by hand (2FA, captcha and all). Nothing about your credentials touches this code or the disk
 * outside the browser profile. The profile keeps you logged in between runs; delete it to start fresh.
 */
export async function loginInBrowser(
  profileDir: string,
  log: (msg: string) => void
): Promise<LoggedIn> {
  const ctx = await chromium.launchPersistentContext(join(profileDir), {
    headless: false,
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    viewport: { width: 1100, height: 800 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(LOGIN_URL);
  if (!(await hasSession(ctx))) {
    log("Log in to ESPN in the browser window that just opened. I'll carry on once you're in.");
    const started = Date.now();
    while (!(await hasSession(ctx))) {
      if (Date.now() - started > WAIT_MS) {
        await ctx.close();
        throw new Error("Timed out waiting for an ESPN login (10 minutes)");
      }
      await page.waitForTimeout(1500);
    }
    log("Logged in.");
  } else {
    log("Using the saved ESPN login.");
  }
  const get: Getter = async (url) => {
    const res = await ctx.request.get(url, { headers: { accept: "application/json" } });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status(), body };
  };
  return { get, close: () => ctx.close() };
}
