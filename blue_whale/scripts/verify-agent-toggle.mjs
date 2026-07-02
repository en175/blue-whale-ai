import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openPath = path.resolve(__dirname, "../canvas-agent-open.png");
const closedPath = path.resolve(__dirname, "../canvas-agent-closed.png");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto("http://localhost:3000/canvas", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: openPath, fullPage: false });
  console.log("Agent open saved to:", openPath);

  await page.locator('button[aria-label="Canvas Agent"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: closedPath, fullPage: false });
  console.log("Agent closed saved to:", closedPath);

  await browser.close();
})();
