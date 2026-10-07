import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import type { Getter } from "./espn";

/**
 * Your installed Google Chrome by default (no download, and ESPN's login is happier with a real browser). Set
 * PW_CHROMIUM to a browser executable, or PW_BUNDLED=1 to use Playwright's own Chromium (`playwright install chromium`).
 */
function browserChoice(): { executablePath: string } | { channel: string } | Record<string, never> {
  if (process.env.PW_CHROMIUM) return { executablePath: process.env.PW_CHROMIUM };
  return process.env.PW_BUNDLED ? {} : { channel: "chrome" };
}

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
    ...browserChoice(),
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

export interface Captured {
  url: string;
  method: string;
  status: number;
  /** The headers ESPN's own pages send that matter (the player filter is in x-fantasy-filter). */
  headers: Record<string, string>;
  body: unknown;
}

const API = /fantasy\.espn\.com\/apis\/v3\/games\/ffl/;
const KEEP_HEADERS = ["x-fantasy-filter", "x-fantasy-platform", "x-fantasy-source"];

/**
 * Discovery mode: opens ESPN's own pages in the logged-in browser and records every fantasy API call they make, so the
 * scraper can ask for exactly what the pages ask for (the team page's projections, the player card's transactions).
 * You click around; press Enter in the terminal (or close the window) when done.
 */
export async function discoverApis(
  profileDir: string,
  startUrl: string,
  log: (msg: string) => void
): Promise<Captured[]> {
  const ctx = await chromium.launchPersistentContext(join(profileDir), {
    headless: false,
    ...browserChoice(),
    viewport: { width: 1280, height: 900 },
  });
  const captured: Captured[] = [];
  const pending: Promise<void>[] = [];
  ctx.on("response", (res) => {
    if (!API.test(res.url())) return;
    pending.push(
      (async () => {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        const headers: Record<string, string> = {};
        const sent = res.request().headers();
        for (const h of KEEP_HEADERS) if (sent[h]) headers[h] = sent[h];
        captured.push({
          url: res.url(),
          method: res.request().method(),
          status: res.status(),
          headers,
          body,
        });
      })().catch(() => undefined)
    );
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(startUrl);
  if (!(await hasSession(ctx))) log("Log in to ESPN in the window first; I'm recording as you go.");
  log("Recording ESPN API calls. Open the pages you want me to learn from, then press Enter here.");
  let closed = false;
  ctx.on("close", () => (closed = true));
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
    const t = setInterval(() => {
      if (closed) {
        clearInterval(t);
        resolve();
      }
    }, 1000);
  });
  await Promise.allSettled(pending);
  if (!closed) await ctx.close().catch(() => undefined);
  return captured;
}
