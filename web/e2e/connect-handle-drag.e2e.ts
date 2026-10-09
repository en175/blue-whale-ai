import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureForRequest, smokeFailures } from '../scripts/bugfix-smoke-support.mjs';

type Fixture = { status: number; body: unknown; headers?: Record<string, string> };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'connect-handle-drag.json'), 'utf8'),
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
const connectionLine = (page: Page) => page.locator('svg.react-flow__connectionline');
const edges = (page: Page) => page.locator('.react-flow__edge');

async function gotoCanvas(page: Page): Promise<void> {
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'm-gen')).toBeVisible();
  await expect(edges(page)).toHaveCount(1);
}

function handleBox(page: Page, nodeId: string, kind: 'source' | 'target') {
  return node(page, nodeId).locator(`.react-flow__handle.${kind}`).boundingBox();
}

async function closeMenuByOutsideClick(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '图片生成' })).toBeVisible();
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await page.mouse.click(pane.x + pane.width - 60, pane.y + pane.height - 60);
  await expect(page.getByRole('button', { name: '图片生成' }), '点菜单外空白应关闭连线类型菜单').toHaveCount(0);
}

test.use({ viewport: { width: 1900, height: 1400 } });

test('对照组：左右 + 都能拖出连线预览（带既有入边）', async ({ page }) => {
  const tracking = await setupPage(page);
  await gotoCanvas(page);

  for (const [kind, dx] of [['source', 150], ['target', -150]] as const) {
    const box = (await handleBox(page, 'm-gen', kind))!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 });
    await expect(connectionLine(page), `${kind === 'source' ? '右' : '左'} + 应拖出预览线`).toBeVisible();
    await page.mouse.up();
    await closeMenuByOutsideClick(page);
  }
  expect(smokeFailures(tracking)).toEqual([]);
});

test('右侧 + 落到空白：弹出连线类型菜单', async ({ page }) => {
  const tracking = await setupPage(page);
  await gotoCanvas(page);

  const box = (await handleBox(page, 'm-gen', 'source'))!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 100, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '图片生成' }), '落空白应弹类型菜单').toBeVisible();
  expect(smokeFailures(tracking)).toEqual([]);
});

test('右侧 + 落到目标卡左 +：成功建边', async ({ page }) => {
  const tracking = await setupPage(page);
  await gotoCanvas(page);

  const from = (await handleBox(page, 'm-gen', 'source'))!;
  const to = (await handleBox(page, 'm-target', 'target'))!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(edges(page), '落到目标卡应新增一条边').toHaveCount(2);
  expect(smokeFailures(tracking)).toEqual([]);
});

test('选中态（框选）下右侧 + 拖出预览线', async ({ page }) => {
  const tracking = await setupPage(page);
  await gotoCanvas(page);

  const card = (await node(page, 'm-gen').boundingBox())!;
  await page.mouse.move(card.x - 30, card.y - 30);
  await page.mouse.down();
  await page.mouse.move(card.x + card.width + 30, card.y + card.height + 30, { steps: 10 });
  await page.mouse.up();
  await expect(node(page, 'm-gen')).toHaveClass(/selected/);

  const box = (await handleBox(page, 'm-gen', 'source'))!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 8 });
  await expect(connectionLine(page), '选中态右侧 + 应拖出预览线').toBeVisible();
  await page.mouse.up();
  expect(smokeFailures(tracking)).toEqual([]);
});

test('二次拖线：先拖左侧弹菜单点外关闭，右侧仍能拖出预览线', async ({ page }) => {
  const tracking = await setupPage(page);
  await gotoCanvas(page);

  const left = (await handleBox(page, 'm-gen', 'target'))!;
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await page.mouse.down();
  await page.mouse.move(left.x + left.width / 2 - 200, left.y + left.height / 2 + 100, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '图片生成' })).toBeVisible();
  await closeMenuByOutsideClick(page);

  const right = (await handleBox(page, 'm-gen', 'source'))!;
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await page.mouse.down();
  await page.mouse.move(right.x + right.width / 2 + 150, right.y + right.height / 2, { steps: 8 });
  await expect(connectionLine(page), '二次拖右侧 + 应出预览线').toBeVisible();
  await page.mouse.up();
  expect(smokeFailures(tracking)).toEqual([]);
});
