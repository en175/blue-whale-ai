import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');

  // Open the Skill panel from the composer toolbar
  const skillButton = page.locator('[aria-label="Skills"]').first();
  await skillButton.waitFor({ state: 'visible' });
  await skillButton.click();

  // Wait for the panel to mount and animate in, then let cover images decode and paint
  await page.waitForSelector('#home-canvas-skill-panel', { state: 'visible' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Use viewport screenshot so fixed panel and background images render correctly
  await page.screenshot({ path: '/Users/apple/Desktop/blue_whale/docs/preview-skill-panel.png', fullPage: false });
  await browser.close();
})();
