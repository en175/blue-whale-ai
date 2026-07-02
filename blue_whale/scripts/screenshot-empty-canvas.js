const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/canvas', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/canvas-empty.png', fullPage: false });
  const nodeCount = await page.locator('[role=\"img\"][aria-label=\"图片\"]').count();
  console.log('image node count:', nodeCount);
  await browser.close();
})();
