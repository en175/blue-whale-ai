import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.getByText("AI 图片").click();
  await page.waitForTimeout(300);
  const resButton = page.locator('[aria-label="分辨率"]').first();
  await resButton.click();
  await page.waitForSelector('[role="listbox"][aria-label="分辨率"]', { state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "docs/preview-ai-image-resolution-dropdown.png", fullPage: false });
  await browser.close();
  console.log("saved docs/preview-ai-image-resolution-dropdown.png");
})();
