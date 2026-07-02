import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/Users/apple/Desktop/blue_whale/docs/preview-agent.png', fullPage: true });
  await browser.close();
})();
