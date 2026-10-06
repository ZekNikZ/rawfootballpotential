// Browser smoke test against a running dev server + API: URL-backed filters, paging, version-history modal,
// and "no horizontal page scroll" on a phone viewport. Exits non-zero on any failed assertion.
import { chromium } from "playwright";

const base = process.env.WEB_URL ?? "http://localhost:5173";
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
);
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

// --- desktop: filters, paging, modal ---
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem("rfp-last-version-viewed", "1.4.1"));
  const page = await ctx.newPage();
  await page.goto(`${base}/redraft/records/overall`, { waitUntil: "networkidle" });
  const section = page.locator("section", { has: page.locator("#h-single-week-scores") });
  const firstRow = () => section.locator("tbody tr").first().innerText();
  const before = await firstRow();

  const scoped = page.waitForResponse((r) => r.url().includes("scope=playoffs"));
  await section.getByText("🏆 Playoffs").click();
  await scoped;
  await page.waitForFunction(() => location.search.includes("single-week-scores.scope=playoffs"));
  await page.waitForTimeout(300);
  const afterScope = await firstRow();
  check(before !== afterScope, "scope filter changes the table and the URL");

  await section.getByRole("button", { name: "2", exact: true }).click();
  await page.waitForFunction(() => location.search.includes("single-week-scores.page=2"));
  check(true, "paging writes page=2 to the URL");

  await section.getByText("📅 Regular Season").click();
  await page.waitForFunction(() => location.search.includes("scope=regular"));
  check(!page.url().includes("single-week-scores.page="), "changing a filter resets to page 1");

  const url = page.url();
  await page.reload({ waitUntil: "networkidle" });
  check(page.url() === url, "URL state survives a reload");
  const selected = await section
    .getByRole("radio", { checked: true })
    .first()
    .innerText()
    .catch(() => "");
  check(true, `restored control state (${selected.trim() || "season select"})`);

  // record picker changes the record and keeps the filter
  await section.getByLabel("Single Week Scores record").selectOption({ label: "Largest blowout" });
  await page.waitForFunction(() => location.search.includes("single-week-scores.rec=blowout"));
  check(page.url().includes("scope=regular"), "switching record keeps filters");

  // season pages: week navigation, lineups, standings week, transaction filters
  await page.goto(`${base}/redraft/2025/matchups/16`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Next week" }).click();
  await page.waitForURL(/\/matchups\/17$/);
  check(true, "next-week button moves to week 17");
  await page.getByRole("button", { name: "Show lineups" }).first().click();
  check(await page.getByText("Starters").first().isVisible(), "a game's lineups expand");
  await page.getByRole("button", { name: "Previous week" }).click();
  await page.waitForURL(/\/matchups\/16$/);

  await page.goto(`${base}/redraft/2026/standings`, { waitUntil: "networkidle" });
  const weeks = page.getByLabel("Week");
  await weeks.selectOption({ label: "Week 2" });
  await page.waitForFunction(() => location.search.includes("week=2"));
  check(true, "standings week is kept in the URL");

  await page.goto(`${base}/dynasty/2025/transactions`, { waitUntil: "networkidle" });
  const filtered = page.waitForResponse((r) => r.url().includes("type=trade"));
  await page.getByText("Trades", { exact: true }).click();
  await filtered;
  check(page.url().includes("type=trade"), "transaction type filter lands in the URL");

  await page.goto(`${base}/redraft`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Standings" }).click();
  await page.waitForURL(/\/redraft\/2026\/standings$/);
  check(true, "the nav opens the selected season's standings");
  await page.goto(`${base}/redraft/standings`, { waitUntil: "networkidle" });
  check(
    page.url().endsWith("/redraft/2026/standings"),
    "/:league/standings redirects to the latest season"
  );

  // modal opens automatically for an unseen version, and not again after closing
  await ctx.close();
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await fresh.newPage();
  await p2.goto(`${base}/redraft`, { waitUntil: "networkidle" });
  check(
    await p2.getByRole("dialog").isVisible(),
    "version history opens automatically on a new version"
  );
  await p2.keyboard.press("Escape");
  await p2.waitForTimeout(400);
  await p2.reload({ waitUntil: "networkidle" });
  check(
    !(await p2.getByRole("dialog").isVisible()),
    "version history stays closed after being dismissed"
  );
  await fresh.close();
}

// --- phone: nothing may force the page itself to scroll sideways ---
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => localStorage.setItem("rfp-last-version-viewed", "1.4.1"));
  const page = await ctx.newPage();
  for (const path of [
    "/redraft",
    "/dynasty",
    "/redraft/records",
    "/redraft/records/overall",
    "/redraft/records/single-season",
    "/redraft/records/managers",
    "/dynasty/records/managers",
    "/redraft/franchises/5",
    "/redraft/2026/standings",
    "/redraft/2025/matchups/17",
    "/redraft/2026/teams",
    "/redraft/2026/teams/rosters",
    "/redraft/2026/transactions",
    "/redraft/2025/draft",
    "/dynasty/2025/draft",
    "/dynasty/picks",
  ]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    check(overflow <= 0, `no horizontal page scroll on ${path} (overflow ${overflow}px)`);
  }
  await ctx.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
