import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../canvas-upload-screenshot.png");
const sampleImage = path.resolve(__dirname, "../docs/preview.png");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto("http://localhost:3000/canvas", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Click the left toolbar upload button.
  await page.locator('button[aria-label="上传"]').first().click();
  await page.waitForTimeout(300);

  // Set input files on the hidden file input.
  await page.locator('input[type="file"]').setInputFiles(sampleImage);

  // Wait for the image node to appear and render.
  await page.waitForSelector('img[src^="data:image"]', { timeout: 5000 });
  await page.waitForTimeout(500);

  await page.screenshot({ path: outPath, fullPage: false });
  console.log("Upload screenshot saved to:", outPath);

  await browser.close();
})();
