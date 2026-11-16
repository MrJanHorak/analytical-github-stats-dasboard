// Regenerate the README screenshots and badge samples from a running instance.
//
//   npm run seed:demo                 # fake data, so screenshots never show real stats
//   npm run build && npm start        # or npm run dev
//   npm run screenshots               # BASE_URL defaults to http://localhost:3000
//
// Needs a Chromium: `npx playwright install chromium` (or set CHROME_CHANNEL=chrome to use an installed Chrome).
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = new URL("../docs/", import.meta.url);
const REPO = "demo/balsa-glider-designer";

const browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL, args: ["--no-sandbox"] });

async function shoot(name, path, { width = 1360, height = 1000, section } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const file = new URL(`${name}.png`, OUT);
  if (section) {
    // Screenshot a single card, found by its heading text
    const el = page.locator("section", { has: page.locator("h2", { hasText: section }) }).first();
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: file.pathname });
  } else {
    await page.screenshot({ path: file.pathname });
  }
  await page.close();
  console.log("✓", name);
}

await shoot("overview", "/?range=30");
await shoot("repo-detail", `/repo/${REPO}?range=90`);
await shoot("star-history", `/repo/${REPO}?range=all`, { section: "Stars & forks over time" });
await shoot("referrer-trend", `/repo/${REPO}?range=30`, { section: "Referrer trend" });
await shoot("notes-alerts", `/repo/${REPO}?range=90`, { section: "Notes & alerts" });
await shoot("languages", "/?range=30", { section: "Languages across your repos" });
await shoot("lines-of-code", "/?range=30", { section: "Lines of code" });
await shoot("your-activity", "/me", { height: 1300 });
await shoot("issues-prs", "/?range=90", { section: "Issues & pull requests" });
await shoot("actions-ci", "/?range=90", { section: "GitHub Actions" });
await shoot("community-health", `/repo/${REPO}?range=90`, { section: "Community health" });
await shoot("mobile", "/?range=30", { width: 390, height: 844 });

for (const metric of ["views", "visitors", "stars"]) {
  const res = await fetch(`${BASE}/api/badge/${REPO}?metric=${metric}`);
  await writeFile(new URL(`badge-${metric}.svg`, OUT), await res.text());
  console.log("✓", `badge-${metric}.svg`);
}

await browser.close();
