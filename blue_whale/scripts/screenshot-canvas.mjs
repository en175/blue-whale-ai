import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, "../canvas-screenshot.png");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(
    "http://localhost:3000/canvas?prompt=%E7%94%9F%E6%88%90%E4%B8%80%E5%8F%AA%E5%B8%85%E6%B0%94%E7%9A%84%E5%B0%8F%E7%8C%AB",
    { waitUntil: "networkidle" }
  );

  // Allow Suspense fallback to resolve, toolbar animation to finish, and UI to settle
  await page.waitForTimeout(2500);

  await page.screenshot({ path: outPath, fullPage: false });
  console.log("Screenshot saved to:", outPath);

  await browser.close();
})();
