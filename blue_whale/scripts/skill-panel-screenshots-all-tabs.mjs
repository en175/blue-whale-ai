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

  // Wait for the panel to mount and animate in
  await page.waitForSelector('#home-canvas-skill-panel', { state: 'visible' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // 1. 我的 Skills (default tab)
  await page.screenshot({ path: '/Users/apple/Desktop/blue_whale/docs/preview-skill-panel.png', fullPage: false });

  // 2. Skill 库
  const libraryTab = page.locator('[role="tab"]').filter({ hasText: 'Skill 库' }).first();
  await libraryTab.waitFor({ state: 'visible' });
  await libraryTab.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/Users/apple/Desktop/blue_whale/docs/preview-skill-library.png', fullPage: false });

  // 3. 创建 Skill
  const createTab = page.locator('[role="tab"]').filter({ hasText: '创建 Skill' }).first();
  await createTab.waitFor({ state: 'visible' });
  await createTab.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/Users/apple/Desktop/blue_whale/docs/preview-skill-create.png', fullPage: false });

  await browser.close();
})();
