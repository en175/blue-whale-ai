import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureForRequest, smokeFailures } from '../scripts/bugfix-smoke-support.mjs';

type Fixture = { status: number; body: unknown; headers?: Record<string, string> };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'text-node-layout.json'), 'utf8'),
) as Record<string, Fixture>;

const evidenceDir =
  process.env.TEXT_LAYOUT_EVIDENCE_DIR ??
  join(import.meta.dirname, '..', 'test-results', 'text-node-layout');
mkdirSync(evidenceDir, { recursive: true });

const CONTENT_WIDTH = 360;
const CONTENT_HEIGHT = 270;

interface Tracking {
  putBodies: string[];
  consoleErrors: string[];
  unexpectedRequests: string[];
  failedResponses: string[];
}

async function setupPage(page: Page): Promise<Tracking> {
  const tracking: Tracking = { putBodies: [], consoleErrors: [], unexpectedRequests: [], failedResponses: [] };

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

  const initialDoc = (
    fixture['GET /api/canvases?projectId=project-1'].body as { data: { viewport: string; nodes: string } }
  ).data;
  const canvasState = { nodes: initialDoc.nodes, viewport: initialDoc.viewport, version: 1 };
  await page.route('**/api/canvases**', async (route) => {
    if (route.request().method() === 'PUT') {
      const raw = route.request().postData() ?? '';
      tracking.putBodies.push(raw);
      try {
        const parsed = JSON.parse(raw) as { viewport?: string; nodes?: string };
        if (typeof parsed.viewport === 'string') canvasState.viewport = parsed.viewport;
        if (typeof parsed.nodes === 'string') canvasState.nodes = parsed.nodes;
      } catch {
      }
      canvasState.version += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 200,
        data: { id: 1, project_id: 1, version: canvasState.version, viewport: canvasState.viewport, nodes: canvasState.nodes },
      }),
    });
  });

  return tracking;
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const card = (page: Page, id: string) => node(page, id).locator('[data-testid="text-content"]');
const title = (page: Page, id: string) => node(page, id).locator('[data-testid="text-title"]');
const editor = (page: Page, id: string) => card(page, id).locator('[contenteditable]');

const WHEEL_ZOOM_FACTOR = process.platform === 'darwin' ? 10 : 1;

async function zoomWheel(page: Page, deltaY: number) {
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY / WHEEL_ZOOM_FACTOR);
  await page.keyboard.up('Control');
}

function lastPutNodes(tracking: Tracking): Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }> {
  const raw = tracking.putBodies[tracking.putBodies.length - 1] ?? '';
  try {
    const nodes = (JSON.parse(raw) as { nodes?: string }).nodes ?? '';
    return JSON.parse(nodes) as Array<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  } catch {
    return [];
  }
}

async function expectContentBox(
  page: Page,
  id: string,
  measurements: Record<string, unknown>,
) {
  const box = await card(page, id).boundingBox();
  expect(box, `${id} 正文容器缺失`).toBeTruthy();
  measurements[id] = { width: box!.width, height: box!.height, expected: `${CONTENT_WIDTH}×${CONTENT_HEIGHT}` };
  expect(Math.abs(box!.width - CONTENT_WIDTH), `${id} 正文宽度应为 ${CONTENT_WIDTH}`).toBeLessThanOrEqual(1.5);
  expect(Math.abs(box!.height - CONTENT_HEIGHT), `${id} 正文高度应为 ${CONTENT_HEIGHT}`).toBeLessThanOrEqual(1.5);
}

test.use({ viewport: { width: 1900, height: 1400 } });

test('布局：正文固定 360×270 / 标题常驻上方 / 长文本内部滚动 / 位置不变', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(node(page, 'n-long')).toBeVisible();

  const measurements: Record<string, unknown> = {};
  await expectContentBox(page, 'n-empty', measurements);
  await expectContentBox(page, 'n-short', measurements);
  await expectContentBox(page, 'n-long', measurements);
  await expectContentBox(page, 'n-edit', measurements);

  for (const id of ['n-empty', 'n-short', 'n-long', 'n-edit']) {
    const titleBox = (await title(page, id).boundingBox())!;
    const contentBox = (await card(page, id).boundingBox())!;
    expect(titleBox.y + titleBox.height, `${id} 标题应在正文上方`).toBeLessThanOrEqual(contentBox.y + 1);
    expect(Math.abs(titleBox.width - CONTENT_WIDTH), `${id} 标题应与正文同宽`).toBeLessThanOrEqual(1.5);
    const text = (await title(page, id).textContent()) ?? '';
    expect(text, `${id} 标题名称`).toContain('文本节点');
    expect(await node(page, id).getByText('文本节点').count()).toBe(1);
  }

  const longEditor = editor(page, 'n-long');
  const metrics = await longEditor.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
  }));
  (measurements['n-long-scroll'] as Record<string, unknown>) = metrics;
  expect(metrics.scrollHeight, '长文本应超出正文可视高度').toBeGreaterThan(metrics.clientHeight + 40);

  const transformBefore = await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  await longEditor.dblclick();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => longEditor.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBeGreaterThan(0);
  expect(
    await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform),
    '编辑态滚轮不应缩放或平移画布',
  ).toBe(transformBefore);

  await longEditor.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const scrolled = await longEditor.evaluate((el) => ({
    scrollTop: el.scrollTop,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }));
  expect(scrolled.scrollTop + scrolled.clientHeight).toBeGreaterThanOrEqual(scrolled.scrollHeight - 1.5);
  const lastPara = node(page, 'n-long').locator('p', { hasText: '结尾最后一句' });
  await expect(lastPara).toBeVisible();
  const lastBox = (await lastPara.boundingBox())!;
  const contentBox = (await card(page, 'n-long').boundingBox())!;
  expect(lastBox.y, '末段应滚入正文可视区').toBeGreaterThanOrEqual(contentBox.y - 1);
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(contentBox.y + contentBox.height + 1);
  await expectContentBox(page, 'n-long', measurements);

  expect(await node(page, 'n-long').evaluate((el) => (el as HTMLElement).style.transform)).toContain('translate(920px, 0px)');
  expect(await node(page, 'n-edit').evaluate((el) => (el as HTMLElement).style.transform)).toContain('translate(0px, 420px)');

  await page.screenshot({ path: join(evidenceDir, 'layout.png') });
  writeFileSync(
    join(evidenceDir, 'layout-measurements.json'),
    `${JSON.stringify({ measurements, canvasPutCount: tracking.putBodies.length }, null, 2)}\n`,
  );
  expect(smokeFailures(tracking)).toEqual([]);
});

test('交互：连接点隐现与锚定 / 操作条与格式工具栏同层不遮挡 / 缩放', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'n-long')).toBeVisible();

  await page.mouse.move(1800, 1300);
  const sourceHandle = node(page, 'n-long').locator('.react-flow__handle-right');
  const targetHandle = node(page, 'n-long').locator('.react-flow__handle-left');
  expect(await sourceHandle.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  expect(await targetHandle.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  await card(page, 'n-long').hover();
  await expect.poll(() => sourceHandle.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 }).toBe('1');

  const box = (await card(page, 'n-long').boundingBox())!;
  const left = (await targetHandle.boundingBox())!;
  const right = (await sourceHandle.boundingBox())!;
  const midY = box.y + box.height / 2;
  const wholeMidY = ((await title(page, 'n-long').boundingBox())!.y + box.y + box.height) / 2;
  expect(Math.abs(left.y + left.height / 2 - midY), '左连接点应在正文左边缘中点').toBeLessThanOrEqual(2);
  expect(Math.abs(right.y + right.height / 2 - midY), '右连接点应在正文右边缘中点').toBeLessThanOrEqual(2);
  expect(Math.abs(midY - wholeMidY), '标题在场时两种锚点应可区分').toBeGreaterThan(5);
  expect(Math.abs(left.x + left.width / 2 - box.x)).toBeLessThanOrEqual(6);
  expect(Math.abs(right.x + right.width / 2 - (box.x + box.width))).toBeLessThanOrEqual(6);

  await title(page, 'n-edit').click();
  const addToChat = page.getByRole('button', { name: '添加到对话' });
  await expect(addToChat).toBeVisible();
  const barBox = (await addToChat.boundingBox())!;
  const editTitleBox = (await title(page, 'n-edit').boundingBox())!;
  const editContentBox = (await card(page, 'n-edit').boundingBox())!;
  expect(barBox.y + barBox.height, '操作条应在标题上方').toBeLessThanOrEqual(editTitleBox.y + 1);
  expect(barBox.y, '操作条不应压到正文').toBeLessThan(editContentBox.y);
  await expect
    .poll(() => node(page, 'n-edit').locator('.react-flow__handle-right').evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1');

  const src = (await node(page, 'n-short').locator('.react-flow__handle-right').boundingBox())!;
  const dstPoint = { x: box.x + 2, y: box.y + box.height / 2 };
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dstPoint.x, dstPoint.y, { steps: 12 });
  await expect
    .poll(
      () =>
        page.evaluate(({ x, y }) => {
          const els = document.elementsFromPoint(x, y);
          return els.some((el) => String(el.className).includes('valid') && String(el.className).includes('connectingto'));
        }, dstPoint),
      { timeout: 3000 },
    )
    .toBe(true);
  await page.mouse.up();
  await expect.poll(() => page.locator('.react-flow__connectionline').count(), { timeout: 3000 }).toBe(0);

  await editor(page, 'n-edit').dblclick();
  await expect(editor(page, 'n-edit')).toHaveAttribute('contenteditable', 'true');
  const boldBtn = page.getByRole('button', { name: '加粗' });
  await expect(boldBtn).toBeVisible();
  const toolbarBox = (await boldBtn.boundingBox())!;
  const titleBoxNow = (await title(page, 'n-edit').boundingBox())!;
  expect(toolbarBox.y + toolbarBox.height, '格式工具栏应在标题上方').toBeLessThanOrEqual(titleBoxNow.y + 1);
  const addToChatInEdit = page.getByRole('button', { name: '添加到对话' });
  await expect(addToChatInEdit).toBeVisible();
  const chatBox = (await addToChatInEdit.boundingBox())!;
  expect(Math.abs(chatBox.y - toolbarBox.y), '格式工具栏与节点操作应同处一层').toBeLessThanOrEqual(4);
  expect(chatBox.y + chatBox.height, '操作不应压到标题').toBeLessThanOrEqual(titleBoxNow.y + 1);

  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await expect(editor(page, 'n-edit')).toHaveAttribute('contenteditable', 'false');
  await title(page, 'n-edit').click();
  await expect(page.getByRole('button', { name: '添加到对话' })).toBeVisible();

  await page.screenshot({ path: join(evidenceDir, 'interaction.png') });

  const titleTextBefore = await title(page, 'n-long').textContent();
  await page.mouse.move(1700, 1200);
  await zoomWheel(page, 240);
  await page.waitForTimeout(300);
  expect(await title(page, 'n-long').textContent()).toBe(titleTextBefore);
  const zoomed = (await card(page, 'n-long').boundingBox())!;
  expect(zoomed.width, '缩小后正文屏幕宽度应变化').toBeLessThan(CONTENT_WIDTH);
  expect(Math.abs(zoomed.width / zoomed.height - CONTENT_WIDTH / CONTENT_HEIGHT), '4:3 比例应保持').toBeLessThan(0.02);
  await zoomWheel(page, -480);
  await page.waitForTimeout(300);
  const enlarged = (await card(page, 'n-long').boundingBox())!;
  expect(enlarged.width, '放大后正文屏幕宽度应大于 100% 规格').toBeGreaterThan(CONTENT_WIDTH);
  expect(await title(page, 'n-long').textContent()).toBe(titleTextBefore);

  expect(smokeFailures(tracking)).toEqual([]);
});

test('编辑与回归：富文本生效并保存 / 拖动刷新恢复 / 删除', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'n-edit')).toBeVisible();

  await editor(page, 'n-edit').dblclick();
  await expect(editor(page, 'n-edit')).toHaveAttribute('contenteditable', 'true');
  await editor(page, 'n-edit').evaluate((el) => {
    const text = el.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '加粗' }).click();
  await expect(node(page, 'n-edit').locator('b, strong').first()).toBeVisible();
  const bolded = await editor(page, 'n-edit').evaluate((el) => el.innerHTML);
  expect(bolded).toMatch(/<(b|strong)>/);

  await expect
    .poll(
      () => lastPutNodes(tracking).some((n) => n.id === 'n-edit' && /\*\*/.test(String(n.data.text ?? '')) && n.data.html === undefined),
      { timeout: 10000 },
    )
    .toBe(true);

  const nodeTranslate = (id: string) => node(page, id).evaluate((el) => (el as HTMLElement).style.transform);
  const dragTitle = title(page, 'n-short');
  const t = (await dragTitle.boundingBox())!;
  const dragFromX = t.x + Math.min(t.width * 0.25, 80);
  await page.mouse.move(dragFromX, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragFromX + 60, t.y + t.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => nodeTranslate('n-short'), { timeout: 5000 }).not.toBe('translate(460px, 0px)');
  const dragged = /translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\)/.exec(await nodeTranslate('n-short'));
  expect(dragged, '拖动后节点应有新坐标').toBeTruthy();
  const [, dragX, dragY] = dragged!;
  await expect
    .poll(
      () => lastPutNodes(tracking).some((n) => n.id === 'n-short' && n.position.x === Number(dragX) && n.position.y === Number(dragY)),
      { timeout: 10000 },
    )
    .toBe(true);

  await page.reload();
  await expect(node(page, 'n-short')).toBeVisible();
  expect(await nodeTranslate('n-short')).toContain(`translate(${Number(dragX)}px, ${Number(dragY)}px)`);
  await expect(node(page, 'n-edit').locator('b, strong').first()).toBeVisible();
  const measurements: Record<string, unknown> = {};
  await expectContentBox(page, 'n-edit', measurements);

  await title(page, 'n-empty').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'n-empty')).toHaveCount(0);
  await expect
    .poll(
      () => tracking.putBodies.length > 0 && lastPutNodes(tracking).every((n) => n.id !== 'n-empty'),
      { timeout: 10000 },
    )
    .toBe(true);

  await page.screenshot({ path: join(evidenceDir, 'regression.png') });
  writeFileSync(
    join(evidenceDir, 'edit-regression.json'),
    `${JSON.stringify({ measurements, boldedHtml: bolded, draggedTo: { x: Number(dragX), y: Number(dragY) } }, null, 2)}\n`,
  );
  expect(smokeFailures(tracking)).toEqual([]);
});

test('统一编辑：四类来源一致体验 / HTML 卡升级 / Markdown 输入粘贴 / 刷新恢复', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'n-plain')).toBeVisible();
  await expect(node(page, 'n-agent')).toBeVisible();

  await expect
    .poll(
      () => {
        const nodes = lastPutNodes(tracking);
        return nodes.length > 0
          && nodes.some((n) => n.id === 'n-edit' && n.data.html === undefined && String(n.data.text ?? '').includes('用于拖动与富文本编辑的便签'))
          && nodes.some((n) => n.id === 'n-long' && n.data.html === undefined && String(n.data.text ?? '').startsWith('开篇第一句'));
      },
      { timeout: 10000 },
    )
    .toBe(true);
  const upgraded = lastPutNodes(tracking).find((n) => n.id === 'n-edit')!;
  expect(upgraded.position).toEqual({ x: 0, y: 420 });

  await editor(page, 'n-plain').dblclick();
  await expect(editor(page, 'n-plain')).toHaveAttribute('contenteditable', 'true');
  const plainBold = page.getByRole('button', { name: '加粗' });
  await expect(plainBold).toBeVisible();
  await expect(node(page, 'n-plain').getByRole('button', { name: '展开全文' })).toBeVisible();
  await page.keyboard.type('新增一段');
  await expect
    .poll(() => lastPutNodes(tracking).some((n) => n.id === 'n-plain' && String(n.data.text ?? '').includes('新增一段')), { timeout: 10000 })
    .toBe(true);

  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await editor(page, 'n-agent').dblclick();
  await expect(page.getByRole('button', { name: '加粗' })).toBeVisible();
  await page.keyboard.type('追加');
  await editor(page, 'n-agent').evaluate((el) => {
    const text = el.querySelector('p')?.firstChild ?? el.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, (text.textContent ?? '').length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '加粗' }).click();
  await expect(node(page, 'n-agent').locator('strong, b').first()).toBeVisible();
  await page.getByRole('button', { name: '斜体' }).click();
  await expect(node(page, 'n-agent').locator('strong b, strong i, b em, b i, strong em').first()).toBeVisible();
  await expect
    .poll(
      () => {
        const agent = lastPutNodes(tracking).find((n) => n.id === 'n-agent');
        return Boolean(agent && String(agent.data.text ?? '').includes('追加') && agent.data.promptSource !== undefined);
      },
      { timeout: 10000 },
    )
    .toBe(true);

  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await page.locator('[data-tooltip="添加文本"]').first().click();
  const created = page.locator('.react-flow__node[data-id^="text-"]');
  await expect(created.first()).toBeVisible();
  const createdEditor = created.first().locator('[contenteditable]');
  await createdEditor.dblclick();
  await expect(createdEditor.first()).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.type('# 新卡标题');
  await expect(created.first().locator('h1')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('## 二级');
  await expect(created.first().locator('h2')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('### 三级');
  await expect(created.first().locator('h3')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('- 无序项');
  await expect(created.first().locator('ul li')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. 有序项');
  await expect(created.first().locator('ol li')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('---');
  await expect(created.first().locator('hr')).toBeVisible();
  await expect
    .poll(
      () => {
        const fresh = lastPutNodes(tracking).find((n) => n.id.startsWith('text-'));
        const text = String(fresh?.data.text ?? '');
        return text.startsWith('# 新卡标题') && text.includes('## 二级') && text.includes('### 三级')
          && text.includes('- 无序项') && text.includes('1. 有序项') && text.includes('---');
      },
      { timeout: 10000 },
    )
    .toBe(true);

  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await editor(page, 'n-plain').dblclick();
  await editor(page, 'n-plain').evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '**粘贴粗体**');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(node(page, 'n-plain').locator('strong, b').first()).toBeVisible();
  await expect
    .poll(
      () => lastPutNodes(tracking).some((n) => n.id === 'n-plain' && String(n.data.text ?? '').includes('**粘贴粗体**')),
      { timeout: 10000 },
    )
    .toBe(true);

  await page.reload();
  await expect(node(page, 'n-agent')).toBeVisible();
  await expect(node(page, 'n-plain').getByText('粘贴粗体')).toBeVisible();
  await expect(node(page, 'n-plain').locator('strong, b').first()).toBeVisible();
  await expect(created.first().locator('h1')).toBeVisible();
  await expect(created.first().locator('h2')).toBeVisible();
  await expect(created.first().locator('h3')).toBeVisible();
  await expect(created.first().locator('ul li')).toBeVisible();
  await expect(created.first().locator('ol li')).toBeVisible();
  await expect(created.first().locator('hr')).toBeVisible();
  await expect(node(page, 'n-edit').locator('p').getByText('用于拖动与富文本编辑的便签')).toBeVisible();

  const sizeOf = async (id: string) => {
    const box = (await card(page, id).boundingBox())!;
    return `${Math.round(box.width)}x${Math.round(box.height)}`;
  };
  const sizes = {
    '历史 HTML（升级）': await sizeOf('n-edit'),
    '历史纯文本': await sizeOf('n-plain'),
    'Agent 应用': await sizeOf('n-agent'),
    '普通新增': await sizeOf((await created.first().getAttribute('data-id'))!),
  };
  expect(new Set(Object.values(sizes)).size, `四类来源正文容器应同规格：${JSON.stringify(sizes)}`).toBe(1);
  await page.screenshot({ path: join(evidenceDir, 'unified-four-sources.png') });
  const unifiedEvidence = {
    upgradedHtmlCard: { id: 'n-edit', text: upgraded.data.text, html: undefined },
    unifiedSizes: sizes,
    savedSources: lastPutNodes(tracking).map((n) => ({ id: n.id, hasText: typeof n.data.text === 'string', hasHtml: n.data.html !== undefined })),
  };
  writeFileSync(join(evidenceDir, 'unified-four-sources.json'), `${JSON.stringify(unifiedEvidence, null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});
