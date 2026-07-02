const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/canvas', { waitUntil: 'networkidle' });
  const btn = page.locator('[data-tour-target="creation-sidebar"] button[aria-label="AI 视频"]').first();
  await btn.waitFor({ timeout: 10000 });
  await btn.screenshot({ path: 'screenshots/left-video-button.png' });
  await browser.close();
})();
