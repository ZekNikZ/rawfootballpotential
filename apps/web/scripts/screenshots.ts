// Screenshots of every public page for review: light/dark x desktop/mobile.
// Usage (dev server on :5173, API on :8000): pnpm --filter @rfp/web screenshots [outDir] [only-substring]
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

const base = process.env.WEB_URL ?? "http://localhost:5173";
const outDir = path.resolve(process.argv[2] ?? "../../docs/screenshots/m5");
const only = process.argv[3];
mkdirSync(outDir, { recursive: true });

const PAGES: {
  name: string;
  path: string;
  waitFor?: string;
  action?: (p: Page) => Promise<void>;
}[] = [
  { name: "home-redraft", path: "/redraft" },
  { name: "home-dynasty", path: "/dynasty" },
  { name: "home-final-results", path: "/redraft?season=2025" },
  { name: "records-trophies", path: "/redraft/records" },
  { name: "records-overall", path: "/redraft/records/overall" },
  { name: "records-single-season", path: "/redraft/records/single-season" },
  { name: "records-managers", path: "/redraft/records/managers" },
  { name: "records-managers-dynasty", path: "/dynasty/records/managers" },
  { name: "records-power-rankings", path: "/redraft/records/power-rankings" },
  {
    name: "records-filtered",
    path: "/redraft/records/overall?single-week-scores.rec=blowout&single-week-scores.scope=playoffs&single-week-scores.seasons=2024",
  },
  { name: "franchise", path: "/redraft/franchises/5" },
  { name: "standings", path: "/redraft/2026/standings" },
  { name: "standings-final", path: "/redraft/2025/standings" },
  { name: "standings-espn", path: "/redraft/2020/standings" },
  { name: "matchups-live", path: "/redraft/2026/matchups" },
  {
    name: "matchups-lineups",
    path: "/redraft/2025/matchups/17",
    action: async (p) => {
      await p.getByRole("button", { name: "Show lineups" }).first().click();
      await p.waitForTimeout(500);
    },
  },
  { name: "teams", path: "/redraft/2026/teams" },
  { name: "rosters", path: "/redraft/2026/teams/rosters" },
  { name: "transactions", path: "/redraft/2026/transactions" },
  { name: "transactions-trades", path: "/dynasty/2025/transactions?type=trade" },
  { name: "transactions-espn", path: "/redraft/2020/transactions" },
  { name: "draft-redraft", path: "/redraft/2025/draft" },
  { name: "draft-dynasty", path: "/dynasty/2025/draft" },
  { name: "future-picks", path: "/dynasty/picks" },
  { name: "not-found", path: "/redraft/nope/nothing/here" },
];

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

// PW_CHROMIUM lets a machine with an older cached Chromium build run this without downloading a new one.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
);
let count = 0;
for (const scheme of ["light", "dark"] as const) {
  for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({
      viewport,
      colorScheme: scheme,
      deviceScaleFactor: vpName === "mobile" ? 2 : 1,
    });
    await context.addInitScript(
      ([s]) => {
        localStorage.setItem("mantine-color-scheme-value", s!);
        localStorage.setItem("rfp-last-version-viewed", "1.4.1");
      },
      [scheme]
    );
    const page = await context.newPage();
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().includes("/api/")) problems.push(`${r.status()} ${r.url()}`);
    });
    for (const p of PAGES) {
      if (only && !p.name.includes(only)) continue;
      await page.goto(base + p.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      if (p.action) await p.action(page);
      const file = path.join(outDir, `${p.name}.${vpName}.${scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      count++;
    }
    if (!only || "chrome".includes(only)) {
      if (vpName === "mobile") {
        await page.goto(base + "/redraft", { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Toggle navigation" }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(outDir, `chrome-nav-open.mobile.${scheme}.png`) });
        count++;
      } else {
        await page.goto(base + "/redraft", { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Open version history" }).click();
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(outDir, `chrome-version-history.desktop.${scheme}.png`),
        });
        count++;
      }
    }
    if (problems.length)
      console.log(`[${scheme} ${vpName}] problems:\n  ${[...new Set(problems)].join("\n  ")}`);
    await context.close();
  }
}
await browser.close();
console.log(`${count} screenshots in ${outDir}`);
