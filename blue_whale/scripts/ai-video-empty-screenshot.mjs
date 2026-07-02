import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(1000);

  // Switch to AI 视频 tab
  const tab = page.locator('button:has-text("AI 视频")');
  await tab.click();
  await page.waitForTimeout(500);

  // Remove all uploaded media items to show empty-state upload entry
  const removeButtons = page.locator('[aria-label^="移除"]');
  let count = await removeButtons.count();
  while (count > 0) {
    await removeButtons.first().click();
    await page.waitForTimeout(200);
    count = await removeButtons.count();
  }
  await page.waitForTimeout(500);

  await page.screenshot({ path: '/Users/apple/Desktop/blue_whale/docs/preview-ai-video-empty.png', fullPage: true });
  await browser.close();
})();
