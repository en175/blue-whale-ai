/* ============================================
 * text-node-layout 验收取证（IKDIDU）
 * 真实浏览器（Playwright Chromium）量测文本节点新布局：
 * 固定 360×270 正文容器、外置常驻标题、长文本内部滚动（滚轮不缩放画布）、
 * 富文本编辑生效并经自动保存落库、工具栏同层不遮挡、连接点隐现与锚定、拖动刷新恢复
 * ============================================ */
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

/** 100% 缩放下的正文容器规格（4:3，含内边距与边框；标题与工具栏另算） */
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

  // 画布文档动态化：PUT 记录请求体并更新内存态，GET 返回最新态（验证 编辑/拖动→保存→刷新 闭环）
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
        /* 保持旧态 */
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

/** 画布缩放需带修饰键（IKDKH1 后滚轮默认平移）。Ctrl+滚轮走捏合缩放路径，
 * macOS 上该路径灵敏度高 10 倍，按平台归一使同一 deltaY 得到相同缩放倍率。 */
const WHEEL_ZOOM_FACTOR = process.platform === 'darwin' ? 10 : 1;

async function zoomWheel(page: Page, deltaY: number) {
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY / WHEEL_ZOOM_FACTOR);
  await page.keyboard.up('Control');
}

/** 最后一次保存下来的节点数组（PUT body 是外层 JSON，nodes 为内嵌转义字符串） */
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
  // 空文本、短文本、长文本、编辑用节点：外形一致，不因内容撑大
  await expectContentBox(page, 'n-empty', measurements);
  await expectContentBox(page, 'n-short', measurements);
  await expectContentBox(page, 'n-long', measurements);
  await expectContentBox(page, 'n-edit', measurements);

  // 标题常驻正文上方，左侧图标 + 现有名称，右侧留空（无占位数字/元信息）
  for (const id of ['n-empty', 'n-short', 'n-long', 'n-edit']) {
    const titleBox = (await title(page, id).boundingBox())!;
    const contentBox = (await card(page, id).boundingBox())!;
    expect(titleBox.y + titleBox.height, `${id} 标题应在正文上方`).toBeLessThanOrEqual(contentBox.y + 1);
    expect(Math.abs(titleBox.width - CONTENT_WIDTH), `${id} 标题应与正文同宽`).toBeLessThanOrEqual(1.5);
    const text = (await title(page, id).textContent()) ?? '';
    expect(text, `${id} 标题名称`).toContain('文本节点');
    // 名称只呈现一次：原卡片内部标题已去掉
    expect(await node(page, id).getByText('文本节点').count()).toBe(1);
  }

  // 长文本超出可视区：内部可滚动，滚轮遵循内部阅读语义而不缩放画布
  const longEditor = editor(page, 'n-long');
  const metrics = await longEditor.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    scrollTop: el.scrollTop,
  }));
  (measurements['n-long-scroll'] as Record<string, unknown>) = metrics;
  expect(metrics.scrollHeight, '长文本应超出正文可视高度').toBeGreaterThan(metrics.clientHeight + 40);

  const zoomBefore = await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  await card(page, 'n-long').hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => longEditor.evaluate((el) => el.scrollTop), { timeout: 3000 }).toBeGreaterThan(0);
  const zoomAfter = await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  expect(zoomAfter, '正文内滚轮不应缩放画布').toBe(zoomBefore);

  // 滚动至末尾：末段进入正文可视区，且外形未变
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

  // 节点位置保持用户原有编排（加载与滚动都不改写坐标）
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

  // 连接点平时隐藏（未悬停未选中）
  await page.mouse.move(1800, 1300);
  const sourceHandle = node(page, 'n-long').locator('.react-flow__handle-right');
  const targetHandle = node(page, 'n-long').locator('.react-flow__handle-left');
  expect(await sourceHandle.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  expect(await targetHandle.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  // 悬停可见（opacity 有 150ms 过渡，轮询到终态）
  await card(page, 'n-long').hover();
  await expect.poll(() => sourceHandle.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 }).toBe('1');

  // 连接点锚定正文容器左右中点，不以「标题 + 正文」整体高度定位
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

  // 选中：节点操作条位于标题上方，不遮挡标题与正文
  await title(page, 'n-edit').click();
  const addToChat = node(page, 'n-edit').getByRole('button', { name: '添加到对话' });
  await expect(addToChat).toBeVisible();
  const barBox = (await addToChat.boundingBox())!;
  const editTitleBox = (await title(page, 'n-edit').boundingBox())!;
  const editContentBox = (await card(page, 'n-edit').boundingBox())!;
  expect(barBox.y + barBox.height, '操作条应在标题上方').toBeLessThanOrEqual(editTitleBox.y + 1);
  expect(barBox.y, '操作条不应压到正文').toBeLessThan(editContentBox.y);
  // 选中态连接点保持可见
  await expect
    .poll(() => node(page, 'n-edit').locator('.react-flow__handle-right').evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1');

  // 拉线：n-short（source）→ n-long（target）。
  // 注：产品当前隐藏连线渲染（showEdges 恒 false），命中证据以 React Flow 的 valid/connectingto 标记为准。
  const src = (await node(page, 'n-short').locator('.react-flow__handle-right').boundingBox())!;
  const dstPoint = { x: box.x + 2, y: box.y + box.height / 2 };
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dstPoint.x, dstPoint.y, { steps: 12 });
  // 连接指示类由 React Flow 在 mousemove 处理后补充，轮询到终态；
  // 拖线预览的 SVG path 会盖住落点，用 elementsFromPoint 穿透判断
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

  // 编辑：格式工具栏占据同一层操作位置，节点操作条不并存、不叠成多行
  await editor(page, 'n-edit').dblclick();
  await expect(editor(page, 'n-edit')).toHaveAttribute('contenteditable', 'true');
  const boldBtn = node(page, 'n-edit').getByRole('button', { name: '加粗' });
  await expect(boldBtn).toBeVisible();
  const toolbarBox = (await boldBtn.boundingBox())!;
  const titleBoxNow = (await title(page, 'n-edit').boundingBox())!;
  expect(toolbarBox.y + toolbarBox.height, '格式工具栏应在标题上方').toBeLessThanOrEqual(titleBoxNow.y + 1);
  // 编辑时「添加到对话」并入同一层操作位置：同水平带、不叠成多行、保持可达
  const addToChatInEdit = node(page, 'n-edit').getByRole('button', { name: '添加到对话' });
  await expect(addToChatInEdit).toBeVisible();
  const chatBox = (await addToChatInEdit.boundingBox())!;
  expect(Math.abs(chatBox.y - toolbarBox.y), '格式工具栏与节点操作应同处一层').toBeLessThanOrEqual(4);
  expect(chatBox.y + chatBox.height, '操作不应压到标题').toBeLessThanOrEqual(titleBoxNow.y + 1);

  // 退出编辑：操作条回到同一层位置（统一后首期格式固定八类，无颜色入口）
  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await expect(editor(page, 'n-edit')).toHaveAttribute('contenteditable', 'false');
  await title(page, 'n-edit').click();
  await expect(node(page, 'n-edit').getByRole('button', { name: '添加到对话' })).toBeVisible();

  // 证据截图放在缩放段之前：缩放会把节点推出视口
  await page.screenshot({ path: join(evidenceDir, 'interaction.png') });

  // 缩放：正文按画布缩放呈现，flow 尺寸规格不变，标题名称不变
  const titleTextBefore = await title(page, 'n-long').textContent();
  await page.mouse.move(1700, 1200);
  await zoomWheel(page, 240);
  await page.waitForTimeout(300);
  expect(await title(page, 'n-long').textContent()).toBe(titleTextBefore);
  const zoomed = (await card(page, 'n-long').boundingBox())!;
  expect(zoomed.width, '缩小后正文屏幕宽度应变化').toBeLessThan(CONTENT_WIDTH);
  expect(Math.abs(zoomed.width / zoomed.height - CONTENT_WIDTH / CONTENT_HEIGHT), '4:3 比例应保持').toBeLessThan(0.02);
  // 放大档：正文屏幕尺寸随之变大，标题名称不变
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

  // 1) 富文本：选中文字加粗，编辑器内出现加粗标记并经自动保存落库
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
  await node(page, 'n-edit').getByRole('button', { name: '加粗' }).click();
  await expect(node(page, 'n-edit').locator('b, strong').first()).toBeVisible();
  const bolded = await editor(page, 'n-edit').evaluate((el) => el.innerHTML);
  expect(bolded).toMatch(/<(b|strong)>/);

  // 统一正文契约 v1：序列化为 Markdown 源落盘（data.text 含 **），html 通道关闭
  await expect
    .poll(
      () => lastPutNodes(tracking).some((n) => n.id === 'n-edit' && /\*\*/.test(String(n.data.text ?? '')) && n.data.html === undefined),
      { timeout: 10000 },
    )
    .toBe(true);

  // 2) 拖动：标题行遵循原有拖动语义，新坐标经自动保存落库
  const nodeTranslate = (id: string) => node(page, id).evaluate((el) => (el as HTMLElement).style.transform);
  const dragTitle = title(page, 'n-short');
  const t = (await dragTitle.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2 + 60, t.y + t.height / 2 + 40, { steps: 10 });
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

  // 3) 刷新：拖动位置与加粗内容都从保存通路恢复，外形仍为 360×270
  await page.reload();
  await expect(node(page, 'n-short')).toBeVisible();
  expect(await nodeTranslate('n-short')).toContain(`translate(${Number(dragX)}px, ${Number(dragY)}px)`);
  await expect(node(page, 'n-edit').locator('b, strong').first()).toBeVisible();
  const measurements: Record<string, unknown> = {};
  await expectContentBox(page, 'n-edit', measurements);

  // 4) 删除：选中后 Delete 键移除节点，后续保存体不再含该节点
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

/* ============================================
 * 统一文本卡编辑与历史升级（IKFM3L）
 * 四类来源（普通新增、Agent 应用、历史纯文本、历史 HTML）：
 * 打开即升级落盘、同一格式工具栏、Markdown 语法输入与粘贴、刷新恢复、统一样式截图
 * ============================================ */
test('统一编辑：四类来源一致体验 / HTML 卡升级 / Markdown 输入粘贴 / 刷新恢复', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'n-plain')).toBeVisible();
  await expect(node(page, 'n-agent')).toBeVisible();

  // 1) 历史 HTML 卡打开即升级：保存体里 html 消失，text 为 Markdown 源（身份/位置不动）
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

  // 2) 历史纯文本卡：双击出现统一格式工具栏，编辑正文经保存通路写 Markdown 源
  await editor(page, 'n-plain').dblclick();
  await expect(editor(page, 'n-plain')).toHaveAttribute('contenteditable', 'true');
  const plainBold = node(page, 'n-plain').getByRole('button', { name: '加粗' });
  await expect(plainBold).toBeVisible();
  // 统一交互：所有卡都有「展开全文」入口
  await expect(node(page, 'n-plain').getByRole('button', { name: '展开全文' })).toBeVisible();
  await page.keyboard.type('新增一段');
  await expect
    .poll(() => lastPutNodes(tracking).some((n) => n.id === 'n-plain' && String(n.data.text ?? '').includes('新增一段')), { timeout: 10000 })
    .toBe(true);

  // 3) Agent 应用卡：同一工具栏可编辑（不因来源保留纯文本编辑分支），绑定身份保留；
  //    工具栏矩阵：选中文本依次加粗、斜体（行内组合）
  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await editor(page, 'n-agent').dblclick();
  await expect(node(page, 'n-agent').getByRole('button', { name: '加粗' })).toBeVisible();
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
  await node(page, 'n-agent').getByRole('button', { name: '加粗' }).click();
  await expect(node(page, 'n-agent').locator('strong, b').first()).toBeVisible();
  await node(page, 'n-agent').getByRole('button', { name: '斜体' }).click();
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

  // 4) 普通新增：工具栏建卡即 v1 形态，Markdown 行首语法输入即时转格式（八类矩阵）
  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await page.locator('[data-tooltip="添加文本"]').first().click();
  const created = page.locator('.react-flow__node[data-id^="text-"]');
  await expect(created.first()).toBeVisible();
  const createdEditor = created.first().locator('[contenteditable]');
  await createdEditor.dblclick();
  await expect(createdEditor.first()).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.type('# 新卡标题');
  await expect(created.first().locator('h1')).toBeVisible();
  // H2/H3、无序/有序列表、分隔线的 Markdown 行首语法矩阵（每行转换后回车续写）
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
  await page.keyboard.press('Enter'); // 空列表项回车退出列表，回到段落
  await page.keyboard.type('1. 有序项');
  await expect(created.first().locator('ol li')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // 退出有序列表
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

  // 5) 粘贴 Markdown 文本得到对应格式（历史纯文本卡上粘贴粗体）
  await page.locator('.react-flow__pane').click({ position: { x: 1700, y: 1200 } });
  await editor(page, 'n-plain').dblclick();
  await editor(page, 'n-plain').evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', '**粘贴粗体**');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(node(page, 'n-plain').locator('strong, b').first()).toBeVisible();
  // 等粘贴内容落盘后再刷新（防抖 800ms）
  await expect
    .poll(
      () => lastPutNodes(tracking).some((n) => n.id === 'n-plain' && String(n.data.text ?? '').includes('**粘贴粗体**')),
      { timeout: 10000 },
    )
    .toBe(true);

  // 6) 刷新：升级后的 Markdown、新建卡八类格式、粘贴格式、Agent 正文与组合格式全部恢复
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

  // 7) 统一样式：四类来源正文容器同规格（360×270），同屏截图对比
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
