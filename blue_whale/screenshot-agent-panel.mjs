import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto("http://localhost:3000/canvas?prompt=生成一个小猫");
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 10000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/agent-panel-open.png", fullPage: false });

  await page.click('[aria-label="Canvas Agent"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/agent-panel-closed.png", fullPage: false });

  await page.click('[aria-label="Canvas Agent"]');
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/agent-panel-reopened.png", fullPage: false });

  await browser.close();
})();
