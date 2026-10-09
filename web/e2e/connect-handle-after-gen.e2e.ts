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

  let savedCanvas: { viewport?: string; nodes?: string; edges?: string } | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PUT' && url.pathname === '/api/canvases/project-1') {
      savedCanvas = JSON.parse(request.postData() ?? '{}') as NonNullable<typeof savedCanvas>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, data: { id: 1, project_id: 1, version: 2 } }),
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === '/api/canvases' && savedCanvas) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 200,
          data: { id: 1, project_id: 1, version: 2, viewport: savedCanvas.viewport, nodes: savedCanvas.nodes, edges: savedCanvas.edges },
        }),
      });
      return;
    }
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
const generatingNode = (page: Page) =>
  page.locator('.react-flow__node', { has: page.getByRole('button', { name: '取消生成' }) });
const finishedNode = (page: Page) =>
  page.locator('.react-flow__node', { has: page.locator('img[src*="new-cat"]') });

async function dragHandle(
  page: Page,
  handle: ReturnType<Page['locator']>,
  dx: number,
  dy: number,
): Promise<boolean> {
  const box = (await handle.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  const appeared = await connectionLine(page).isVisible().catch(() => false);
  await page.mouse.up();
  return appeared;
}

async function createDraftAndSend(page: Page): Promise<void> {
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'm-source')).toBeVisible();
  await dragHandle(page, node(page, 'm-source').locator('.react-flow__handle.source'), 250, -100);
  await page.getByRole('button', { name: '图片生成' }).click();
  await page.getByRole('textbox').click();
  await page.keyboard.type('一只猫');
  const sendBtn = page.locator('button[title="发送"]');
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();
  await expect(generatingNode(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('button[title="发送"]')).toHaveCount(0);
}

test.use({ viewport: { width: 1900, height: 1400 } });

test('同会话生成中卡：右侧 + 拖出预览线（draft→generating 手柄注册）', async ({ page }) => {
  const tracking = await setupPage(page);
  await createDraftAndSend(page);

  const sameSession = await dragHandle(page, generatingNode(page).locator('.react-flow__handle.source'), 150, 0);
  expect(sameSession, '同会话内生成卡右 + 拖不出预览线（手柄未注册）').toBe(true);

  await page.waitForRequest((req) => req.method() === 'PUT' && req.url().includes('/api/canvases/project-1'));
  await page.reload();
  await expect(generatingNode(page)).toBeVisible();
  const afterReload = await dragHandle(page, generatingNode(page).locator('.react-flow__handle.source'), 150, 0);
  expect(afterReload, '刷新后生成卡右 + 应能拖出预览线').toBe(true);

  expect(smokeFailures(tracking)).toEqual([]);
});

test('同会话成品卡：右侧 + 拖出预览线且卡片可拖动（generating→succeeded 手柄保持注册）', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.route('**/api/jobs/job-new-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 200,
        data: {
          job_id: 'job-new-1',
          status: 'succeeded',
          progress: 100,
          asset: { id: 'a-new-1', url: 'https://e2e.media/new-cat.png', type: 'image', width: 1776, height: 2368, duration: null },
          text_input_signature: null,
          error: null,
        },
      }),
    });
  });
  await createDraftAndSend(page);
  await expect(finishedNode(page)).toBeVisible();

  const connectable = await dragHandle(page, finishedNode(page).locator('.react-flow__handle.source'), 150, 0);
  expect(connectable, '同会话内成品卡右 + 拖不出预览线（手柄未注册）').toBe(true);

  const before = (await finishedNode(page).boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 90, before.y + before.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  const after = (await finishedNode(page).boundingBox())!;
  expect(Math.round(after.x - before.x), '成品卡应可拖动').toBeGreaterThan(40);

  expect(smokeFailures(tracking)).toEqual([]);
});
