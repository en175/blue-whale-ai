/* ============================================
 * canvas-marquee-select 验收取证（IKDKII）
 * 真实浏览器（Playwright Chromium）验证画布框选几何判定：
 * 选择模式下空白处左键拖拽直接出框（无需 Shift）、
 * 部分相交即选中、完全包住选中、不相交不选中、单击空白取消选中
 * ============================================ */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureForRequest, smokeFailures } from '../scripts/bugfix-smoke-support.mjs';

type Fixture = { status: number; body: unknown; headers?: Record<string, string> };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'canvas-marquee-select.json'), 'utf8'),
) as Record<string, Fixture>;

interface Tracking {
  consoleErrors: string[];
  unexpectedRequests: string[];
  failedResponses: string[];
}

async function setupPage(page: Page): Promise<Tracking> {
  const tracking: Tracking = { consoleErrors: [], unexpectedRequests: [], failedResponses: [] };

  await page.addInitScript(() => {
    localStorage.setItem(
      'bw-auth',
      JSON.stringify({
        state: {
          isNewUser: false,
          user: {
            userId: 101,
            username: 'smoke-user',
            email: 'smoke@example.com',
            phone: '',
            hasPassword: true,
            isAdmin: false,
          },
        },
        version: 0,
      }),
    );
  });

  page.on('console', (message) => {
    if (message.type() === 'error') tracking.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => tracking.consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && !url.pathname.startsWith('/api/')) {
      tracking.failedResponses.push(`${response.status()} ${url.pathname}${url.search}`);
    }
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}${url.search}`;
    let response: Fixture;
    try {
      response = fixtureForRequest(fixture, key);
    } catch (error) {
      tracking.unexpectedRequests.push(key);
      await route.fulfill({ status: 599, body: JSON.stringify({ error: String(error) }) });
      return;
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      headers: response.headers,
      body: JSON.stringify(response.body),
    });
  });

  return tracking;
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

test.use({ viewport: { width: 1900, height: 1400 } });

test('框选：空白拖拽出框 / 部分相交与全包均选中 / 不相交不选中 / 单击空白取消', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(node(page, 'n-c')).toBeVisible();

  const boxA = (await node(page, 'n-a').boundingBox())!;
  const boxB = (await node(page, 'n-b').boundingBox())!;
  const boxC = (await node(page, 'n-c').boundingBox())!;

  // 选框：从 A 左上外侧空白起拖，右缘只伸进 B 左缘 40px，下缘完整压过 A；不碰 C。
  const start = { x: boxA.x - 30, y: boxA.y - 30 };
  const end = { x: boxB.x + 40, y: boxA.y + boxA.height + 30 };
  expect(end.x, '选框右缘不应触达 C').toBeLessThan(boxC.x);
  expect(start.x, '起点应在 C 左侧空白').toBeLessThan(boxC.x);

  // 不按任何修饰键，直接左键拖拽空白区域
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(page.locator('.react-flow__selection')).toBeVisible();
  await page.mouse.up();

  await expect(node(page, 'n-a'), '完全包住的卡片应选中').toHaveClass(/selected/);
  await expect(node(page, 'n-b'), '部分相交的卡片应选中').toHaveClass(/selected/);
  await expect(node(page, 'n-c'), '不相交的卡片不应选中').not.toHaveClass(/selected/);

  // 单击选框以外的空白区域：取消全部选中
  const emptySpot = { x: boxA.x - 30, y: boxC.y - 60 };
  await page.mouse.click(emptySpot.x, emptySpot.y);
  await expect(node(page, 'n-a'), '单击空白后 A 应取消选中').not.toHaveClass(/selected/);
  await expect(node(page, 'n-b'), '单击空白后 B 应取消选中').not.toHaveClass(/selected/);

  expect(smokeFailures(tracking)).toEqual([]);
});
