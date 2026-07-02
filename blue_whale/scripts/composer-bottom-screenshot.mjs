import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForSelector('[aria-label="选择模型"]', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "docs/preview-composer-bottom.png", fullPage: false });
  await browser.close();
  console.log("saved docs/preview-composer-bottom.png");
})();
