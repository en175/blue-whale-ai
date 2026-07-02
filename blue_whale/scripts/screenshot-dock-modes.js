const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/canvas', { waitUntil: 'networkidle' });

  const aiImageBtn = page.locator('[data-tour-target="creation-sidebar"] button[aria-label="AI 图片"]').first();
  const aiVideoBtn = page.locator('[data-tour-target="creation-sidebar"] button[aria-label="AI 视频"]').first();
  await aiImageBtn.waitFor({ timeout: 10000 });

  // AI image mode
  await aiImageBtn.click();
  await page.waitForSelector('[data-canvas-reference-drop-target="image-dock"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/dock-image.png', fullPage: false });

  // Switch to AI video mode
  await aiVideoBtn.click();
  await page.waitForSelector('[data-canvas-reference-drop-target="video-dock"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/dock-video.png', fullPage: false });

  // Toggle off video mode
  await aiVideoBtn.click();
  await page.waitForTimeout(500);
  const videoDock = await page.locator('[data-canvas-reference-drop-target="video-dock"]').count();
  const imageDock = await page.locator('[data-canvas-reference-drop-target="image-dock"]').count();
  console.log('image dock visible:', imageDock > 0);
  console.log('video dock visible:', videoDock > 0);

  await browser.close();
})();
