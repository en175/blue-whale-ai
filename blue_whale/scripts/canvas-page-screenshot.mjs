import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Navigate to homepage and trigger generation to enter the canvas page
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');

  const generateButton = page.locator('button[aria-label="生成"]').first();
  await generateButton.waitFor({ state: 'visible' });
  await generateButton.click();

  // Wait for navigation to the canvas page
  await page.waitForURL('http://localhost:3000/canvas');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot the full canvas page
  await page.screenshot({
    path: '/Users/apple/Desktop/blue_whale/docs/preview-canvas-page.png',
    fullPage: true,
  });

  await browser.close();
})();
