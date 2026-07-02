import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForSelector('[aria-label^="模式:"]', { timeout: 10000 });
  await page.click('[aria-label^="模式:"]');
  await page.waitForSelector('[role="listbox"][aria-label="模式"]', { state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "docs/preview-direct-gen-dropdown.png", fullPage: false });
  await browser.close();
  console.log("saved docs/preview-direct-gen-dropdown.png");
})();
