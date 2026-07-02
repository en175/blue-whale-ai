const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/canvas', { waitUntil: 'networkidle' });

  // Wait for the left toolbar and the initial node
  const aiImageBtn = page.locator('[data-tour-target="creation-sidebar"] button[aria-label="AI 图片"]').first();
  await aiImageBtn.waitFor({ timeout: 10000 });

  const countImages = async () => page.$$eval('[role="img"][aria-label="图片"]', (els) => els.length);
  const initialCount = await countImages();
  console.log('Initial image nodes:', initialCount);

  await aiImageBtn.click();
  await page.waitForSelector('[data-canvas-reference-drop-target="image-dock"]', { timeout: 10000 });
  await page.waitForTimeout(500);

  const afterCount = await countImages();
  console.log('Image nodes after click:', afterCount);
  await page.screenshot({ path: '/Users/apple/Desktop/blue_whale/screenshots/dock-open.png', fullPage: false });

  if (afterCount > initialCount) {
    console.error('BUG: image node was added instead of toggling the dock');
    process.exitCode = 1;
  } else {
    console.log('OK: dock opened and no new image node added');
  }

  await browser.close();
})();
