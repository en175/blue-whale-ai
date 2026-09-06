/* ============================================
 * canvas-group-drag 回归取证（IKDKII 人工验收发现的缺陷）
 * 真实浏览器复现并锁定：框选整组移动 → 取消选中 → 再拖任意单卡，
 * 原组内未被抓取的卡片不得被打回旧位置（父层坐标过期导致的跳变）
 * ============================================ */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureForRequest, smokeFailures } from '../scripts/bugfix-smoke-support.mjs';

type Fixture = { status: number; body: unknown; headers?: Record<string, string> };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'canvas-group-drag.json'), 'utf8'),
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

type Box = { x: number; y: number; width: number; height: number };

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** 读取节点渲染框（等待其相对基准位移到位，消除拖拽后的渲染抖动） */
async function settledBox(page: Page, id: string): Promise<Box> {
  let last: Box | null = null;
  await expect
    .poll(async () => {
      const box = await node(page, id).boundingBox();
      if (!box) return 'missing';
      if (last && Math.abs(box.x - last.x) < 0.5 && Math.abs(box.y - last.y) < 0.5) return 'stable';
      last = box;
      return 'moving';
    }, { timeout: 3000 })
    .toBe('stable');
  return last!;
}

async function dragNode(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = (await node(page, id).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
}

test.use({ viewport: { width: 1900, height: 1400 } });

test('整组移动后取消选中，再拖单卡：原组卡片不得跳变', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(node(page, 'm-c')).toBeVisible();

  const boxA = await settledBox(page, 'm-a');
  const boxB = await settledBox(page, 'm-b');
  const boxC = await settledBox(page, 'm-c');

  // 框选 A（全包）+ B（部分相交）：不按任何修饰键直接空白拖拽
  const start = { x: boxA.x - 30, y: boxA.y - 30 };
  const end = { x: boxB.x + 40, y: boxA.y + boxA.height + 30 };
  expect(end.x, '选框右缘不应触达 C').toBeLessThan(boxC.x);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await expect(node(page, 'm-a'), 'A 应被框选').toHaveClass(/selected/);
  await expect(node(page, 'm-b'), 'B 应被框选').toHaveClass(/selected/);
  await expect(node(page, 'm-c'), 'C 不应被框选').not.toHaveClass(/selected/);

  // 抓取 A 整组拖拽：A、B 应等量跟随（库内拖拽有启动阈值，位移以 A 的实际量为准）
  await dragNode(page, 'm-a', 120, 90);
  const movedA = await settledBox(page, 'm-a');
  const movedB = await settledBox(page, 'm-b');
  const deltaA = { x: Math.round(movedA.x - boxA.x), y: Math.round(movedA.y - boxA.y) };
  const deltaB = { x: Math.round(movedB.x - boxB.x), y: Math.round(movedB.y - boxB.y) };
  expect(deltaA.x, '整组拖拽后 A 应发生位移').toBeGreaterThan(50);
  expect(deltaA.y, '整组拖拽后 A 应发生位移').toBeGreaterThan(40);
  expect(deltaB, '整组拖拽后 B 应与 A 等量跟随').toEqual(deltaA);

  // 单击空白取消选中
  await page.mouse.click(start.x, start.y);
  await expect(node(page, 'm-a')).not.toHaveClass(/selected/);
  await expect(node(page, 'm-b')).not.toHaveClass(/selected/);

  // 再拖组外单卡 C (+50, +50)：A、B 均不得跳变（缺陷：B 被打回框选前旧坐标）
  await dragNode(page, 'm-c', 50, 50);
  const finalA = await settledBox(page, 'm-a');
  const finalB = await settledBox(page, 'm-b');
  expect(Math.round(finalA.x - movedA.x), '拖动 C 时 A 不得移动').toBe(0);
  expect(Math.round(finalA.y - movedA.y), '拖动 C 时 A 不得移动').toBe(0);
  expect(Math.round(finalB.x - movedB.x), '拖动 C 时 B 不得移动').toBe(0);
  expect(Math.round(finalB.y - movedB.y), '拖动 C 时 B 不得移动').toBe(0);

  expect(smokeFailures(tracking)).toEqual([]);
});
