/* ============================================
 * media-node-layout 验收取证（IKDIDO）
 * 真实浏览器（Playwright Chromium）量测媒体节点新布局：
 * 统一尺度、外部标题、未知→已知回填、状态保形、工具栏/连接点交互、视频真实播放
 * 媒体字节在浏览器内生成（canvas 导出 PNG / MediaRecorder 录 WebM），不依赖二进制 fixture
 * ============================================ */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureForRequest, smokeFailures } from '../scripts/bugfix-smoke-support.mjs';

type Fixture = { status: number; body: unknown; headers?: Record<string, string> };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'media-node-layout.json'), 'utf8'),
) as Record<string, Fixture>;

const evidenceDir =
  process.env.MEDIA_LAYOUT_EVIDENCE_DIR ??
  join(import.meta.dirname, '..', 'test-results', 'media-node-layout');
mkdirSync(evidenceDir, { recursive: true });

interface GeneratedMedia {
  [name: string]: { dataUrl: string; contentType: string };
}

let mediaCache: GeneratedMedia | null = null;

/** 浏览器内生成真实媒体：精确尺寸 PNG + 一段约 0.9s 的 WebM（VP8，headless Chromium 可解码播放） */
async function ensureMedia(page: Page): Promise<GeneratedMedia> {
  if (mediaCache) return mediaCache;
  mediaCache = await page.evaluate(async () => {
    const out: Record<string, { dataUrl: string; contentType: string }> = {};
    const png = (w: number, h: number, color: string) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = color;
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#ffffff';
      x.font = `${Math.max(10, Math.floor(Math.min(w, h) / 6))}px sans-serif`;
      x.fillText(`${w}x${h}`, 8, Math.max(16, Math.floor(Math.min(w, h) / 5)));
      return c.toDataURL('image/png');
    };
    out['landscape.png'] = { dataUrl: png(1600, 900, '#2f5d62'), contentType: 'image/png' };
    out['portrait.png'] = { dataUrl: png(900, 1600, '#5d2f62'), contentType: 'image/png' };
    out['square.png'] = { dataUrl: png(800, 800, '#62522f'), contentType: 'image/png' };
    out['extreme-tall.png'] = { dataUrl: png(100, 1000, '#2f6262'), contentType: 'image/png' };
    out['extreme-wide.png'] = { dataUrl: png(1000, 100, '#623a2f'), contentType: 'image/png' };
    out['small.png'] = { dataUrl: png(50, 50, '#3a2f62'), contentType: 'image/png' };
    out['unknown.png'] = { dataUrl: png(1600, 900, '#2f3d62'), contentType: 'image/png' };

    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const x = c.getContext('2d')!;
    const stream = c.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.start(100);
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const draw = () => {
        const elapsed = performance.now() - t0;
        x.fillStyle = `hsl(${Math.round(elapsed / 10) % 360} 60% 50%)`;
        x.fillRect(0, 0, 640, 360);
        x.fillStyle = '#ffffff';
        x.font = '40px sans-serif';
        x.fillText(String(Math.round(elapsed)), 40, 90);
        if (elapsed < 900) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
    out['sample.webm'] = { dataUrl, contentType: 'video/webm' };
    return out;
  });
  return mediaCache;
}

interface Tracking {
  putBodies: string[];
  consoleErrors: string[];
  unexpectedRequests: string[];
  failedResponses: string[];
}

async function setupPage(page: Page): Promise<Tracking> {
  const media = await ensureMedia(page);
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

  // 画布文档动态化：PUT 记录请求体并更新内存态，GET 返回最新态（验证 拖动→保存→刷新 闭环）
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

  // release 构建下 PUT 直传预签名 URL（不经 /api），直接 200
  await page.route('https://tos.e2e.media/**', async (route) => {
    await route.fulfill({ status: 200, body: 'ok' });
  });

  await page.route('https://e2e.media/**', async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    const m = media[name];
    if (!m) {
      await route.fulfill({ status: 404, body: 'not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: m.contentType,
      body: Buffer.from(m.dataUrl.split(',')[1], 'base64'),
    });
  });

  return tracking;
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const card = (page: Page, id: string) => node(page, id).locator('[data-testid="media-content"]');
const title = (page: Page, id: string) => node(page, id).locator('[data-testid="media-title"]');

async function waitImagesLoaded(page: Page) {
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.react-flow__node img')] as HTMLImageElement[];
    return imgs.length >= 7 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  });
}

async function expectBox(
  page: Page,
  id: string,
  w: number,
  h: number,
  measurements: Record<string, unknown>,
) {
  const box = await card(page, id).boundingBox();
  expect(box, `${id} 内容主体缺失`).toBeTruthy();
  measurements[id] = { width: box!.width, height: box!.height, expected: `${w}×${h}` };
  expect(Math.abs(box!.width - w), `${id} 宽度应≈${w}`).toBeLessThanOrEqual(1.5);
  expect(Math.abs(box!.height - h), `${id} 高度应≈${h}`).toBeLessThanOrEqual(1.5);
}

test.use({ viewport: { width: 2100, height: 1750 } });

test('布局：统一尺度/外部标题/未知转已知/失败保形/位置不变', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await waitImagesLoaded(page);

  const measurements: Record<string, unknown> = {};
  await expectBox(page, 'n-landscape', 497.78, 280, measurements);
  await expectBox(page, 'n-portrait', 280, 497.78, measurements);
  await expectBox(page, 'n-square', 280, 280, measurements);
  await expectBox(page, 'n-extreme-tall', 84, 840, measurements);
  await expectBox(page, 'n-extreme-wide', 840, 84, measurements);
  await expectBox(page, 'n-small', 280, 280, measurements);
  // 未知尺寸节点：先 280×280 占位，浏览器实测回填后按真实 16:9 更新
  await expectBox(page, 'n-unknown', 497.78, 280, measurements);
  await expectBox(page, 'n-video', 497.78, 280, measurements);

  // 生成中按目标比例占位；轮询转失败后保形、真实错误文案与「重试」可达
  await expect(node(page, 'n-gen')).toContainText('账户余额不足，请充值后重试');
  await expect(node(page, 'n-gen').getByRole('button', { name: '重试' })).toBeVisible();
  await expectBox(page, 'n-gen', 497.78, 280, measurements);

  // 外部标题：真实分辨率/时长；文件大小不出现；目标比例不伪装为分辨率
  await expect(title(page, 'n-landscape')).toContainText('1600×900');
  await expect(title(page, 'n-landscape')).not.toContainText('MB');
  await expect(title(page, 'n-video')).toContainText('640×360');
  await expect(title(page, 'n-video')).toContainText('12s');
  await expect(title(page, 'n-video')).not.toContainText('MB');
  await expect(title(page, 'n-unknown')).toContainText('1600×900');
  await expect(title(page, 'n-gen')).not.toContainText('16:9');

  // 节点位置不被加载/尺寸变化改写（含未知→已知跳变后与密集邻居）
  expect(await node(page, 'n-unknown').evaluate((el) => (el as HTMLElement).style.transform)).toContain(
    'translate(1400px, 620px)',
  );
  expect(await node(page, 'n-extreme-wide').evaluate((el) => (el as HTMLElement).style.transform)).toContain(
    'translate(0px, 620px)',
  );

  // 浏览器实测尺寸经既有保存通路持久化（PUT body 是外层 JSON，nodes 为内嵌转义字符串）
  await expect
    .poll(
      () =>
        tracking.putBodies.some((raw) => {
          try {
            const parsed = JSON.parse(raw) as { nodes?: string };
            return (
              typeof parsed.nodes === 'string' &&
              parsed.nodes.includes('"id":"n-unknown"') &&
              parsed.nodes.includes('"width":1600') &&
              parsed.nodes.includes('"height":900')
            );
          } catch {
            return false;
          }
        }),
      { timeout: 10000 },
    )
    .toBe(true);

  await page.screenshot({ path: join(evidenceDir, 'layout.png') });
  writeFileSync(
    join(evidenceDir, 'layout-measurements.json'),
    `${JSON.stringify({ measurements, canvasPutCount: tracking.putBodies.length }, null, 2)}\n`,
  );
  expect(smokeFailures(tracking)).toEqual([]);
});

test('交互：工具栏不遮挡标题/连接点隐现与锚定/拉线/缩放标题不变', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await waitImagesLoaded(page);

  // 连接点平时隐藏（未悬停未选中）
  await page.mouse.move(2000, 1700);
  const squareSource = node(page, 'n-square').locator('.react-flow__handle-right');
  expect(await squareSource.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  // 悬停可见（opacity 有 150ms 过渡，轮询到终态）
  await card(page, 'n-square').hover();
  await expect
    .poll(() => squareSource.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1');

  // 连接点锚定内容区左右中点（标题存在时仍准确）
  const cardBox = (await card(page, 'n-portrait').boundingBox())!;
  const targetHandle = (await node(page, 'n-portrait').locator('.react-flow__handle-left').boundingBox())!;
  const sourceHandle = (await node(page, 'n-portrait').locator('.react-flow__handle-right').boundingBox())!;
  const midY = cardBox.y + cardBox.height / 2;
  expect(Math.abs(targetHandle.y + targetHandle.height / 2 - midY)).toBeLessThanOrEqual(2);
  expect(Math.abs(sourceHandle.y + sourceHandle.height / 2 - midY)).toBeLessThanOrEqual(2);
  expect(Math.abs(targetHandle.x + targetHandle.width / 2 - cardBox.x)).toBeLessThanOrEqual(6);
  expect(Math.abs(sourceHandle.x + sourceHandle.width / 2 - (cardBox.x + cardBox.width))).toBeLessThanOrEqual(6);

  // 选中：工具栏在外部标题上方，不遮挡标题或内容
  await title(page, 'n-portrait').click();
  const toolbarBtn = node(page, 'n-portrait').getByRole('button', { name: '重新编辑' });
  await expect(toolbarBtn).toBeVisible();
  const toolbarBox = (await toolbarBtn.locator('xpath=..').boundingBox())!;
  const titleBox = (await title(page, 'n-portrait').boundingBox())!;
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(titleBox.y + 1);
  // 选中态连接点保持可见
  await expect
    .poll(
      () =>
        node(page, 'n-portrait').locator('.react-flow__handle-left').evaluate((el) => getComputedStyle(el).opacity),
      { timeout: 3000 },
    )
    .toBe('1');

  // 拉线：n-square（source）→ n-extreme-tall（target）。
  // 注：产品当前隐藏连线渲染（显示连线按钮 display:none，showEdges 恒 false），
  // 命中证据以 RF 连接状态机的 valid/connectingto 标记为准——它与 onConnect 触发条件一致。
  const src = (await squareSource.boundingBox())!;
  const dstCard = (await card(page, 'n-extreme-tall').boundingBox())!;
  const dstPoint = { x: dstCard.x + 2, y: dstCard.y + dstCard.height / 2 };
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dstPoint.x, dstPoint.y, { steps: 12 });
  const dstValid = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.className.includes('valid') && el.className.includes('connectingto') : false;
  }, dstPoint);
  expect(dstValid, '落点连接点应被 RF 标记为有效连接目标').toBe(true);
  await page.mouse.up();
  await expect.poll(() => page.locator('.react-flow__connectionline').count(), { timeout: 3000 }).toBe(0);

  // 缩放：标题分辨率文案不变，内容屏幕尺寸随缩放变化（flow 尺寸不变）
  const titleTextBefore = await title(page, 'n-landscape').textContent();
  await page.mouse.move(2000, 1600);
  await page.mouse.wheel(0, 240);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(300);
  expect(await title(page, 'n-landscape').textContent()).toBe(titleTextBefore);
  const zoomed = await card(page, 'n-landscape').boundingBox();
  expect(zoomed!.width).toBeLessThan(497.78);

  await page.screenshot({ path: join(evidenceDir, 'interaction.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('视频：真实播放且控件可达', async ({ page }) => {  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  const video = node(page, 'n-video').locator('video');
  await expect(video).toBeVisible();
  expect(await video.getAttribute('controls')).not.toBeNull();

  await video.evaluate((v: HTMLVideoElement) => v.play());
  await page.waitForFunction(
    () => {
      const v = document.querySelector('.react-flow__node[data-id="n-video"] video') as HTMLVideoElement | null;
      return !!v && v.currentTime > 0.05;
    },
    undefined,
    { timeout: 8000 },
  );
  const playingAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await video.evaluate((v: HTMLVideoElement) => v.pause());

  await page.screenshot({ path: join(evidenceDir, 'video.png') });
  writeFileSync(join(evidenceDir, 'video-playback.json'), `${JSON.stringify({ playedTo: playingAt }, null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});

test('回归：拖动→保存→刷新生效 / 平移 / 删除 / 自由投放', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await waitImagesLoaded(page);

  const lastPutNodes = () => {
    const raw = tracking.putBodies[tracking.putBodies.length - 1] ?? '';
    try {
      return (JSON.parse(raw) as { nodes?: string }).nodes ?? '';
    } catch {
      return '';
    }
  };
  const nodeTranslate = (id: string) =>
    node(page, id).evaluate((el) => (el as HTMLElement).style.transform);
  // 等布局与回填保存全部落定，避免拖动与回填 PATCH 竞争
  await expect.poll(() => tracking.putBodies.length, { timeout: 10000 }).toBeGreaterThan(0);

  // 1) 拖动：标题行遵循原有拖动语义；以 DOM 实际落点为准，断言新坐标经自动保存落库
  const squareTitle = title(page, 'n-square');
  const t = (await squareTitle.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2 + 60, t.y + t.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => nodeTranslate('n-square'), { timeout: 5000 }).not.toBe('translate(1020px, 0px)');
  const dragged = /translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\)/.exec(
    await nodeTranslate('n-square'),
  );
  expect(dragged, '拖动后节点应有新坐标').toBeTruthy();
  const [, dragX, dragY] = dragged!;
  await expect
    .poll(
      () => {
        const nodes = lastPutNodes();
        return nodes.includes('"id":"n-square"') && nodes.includes(`"x":${Number(dragX)}`) && nodes.includes(`"y":${Number(dragY)}`);
      },
      { timeout: 10000 },
    )
    .toBe(true);

  // 2) 平移（按住 Space 滚轮）：视口 transform 变化
  const viewportTransform = () =>
    page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  const panBefore = await viewportTransform();
  await page.locator('.react-flow__pane').click({ position: { x: 1800, y: 1500 } });
  await page.keyboard.down(' ');
  await page.mouse.move(1000, 800);
  await page.mouse.wheel(0, 120);
  await page.keyboard.up(' ');
  await expect.poll(viewportTransform, { timeout: 3000 }).not.toBe(panBefore);

  // 3) 刷新：拖动后的位置从保存通路恢复（旧画布恢复位置）
  await page.reload();
  await expect(page.locator('.react-flow')).toBeVisible();
  await waitImagesLoaded(page);
  expect(await nodeTranslate('n-square')).toContain(`translate(${Number(dragX)}px, ${Number(dragY)}px)`);

  // 4) 删除：选中后 Delete 键移除节点，后续保存体不再含该节点
  await title(page, 'n-small').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'n-small')).toHaveCount(0);
  await expect
    .poll(
      () => {
        const nodes = lastPutNodes();
        return nodes.length > 0 && !nodes.includes('"id":"n-small"');
      },
      { timeout: 10000 },
    )
    .toBe(true);

  // 5) 自由投放：工具栏上传 PNG，浏览器实测尺寸回填标题并持久化
  const media = await ensureMedia(page);
  const dropPath = join(evidenceDir, 'drop-source.png');
  writeFileSync(dropPath, Buffer.from(media['landscape.png'].dataUrl.split(',')[1], 'base64'));
  await page.locator('input[accept="image/*,video/*"]').setInputFiles(dropPath);
  const dropped = page.locator('.react-flow__node', {
    has: page.locator('[data-testid="media-title"]', { hasText: 'drop-source.png' }),
  });
  await expect(dropped).toBeVisible();
  await expect(dropped.locator('[data-testid="media-title"]')).toContainText('1600×900');
  const dropBox = await dropped.locator('[data-testid="media-content"]').boundingBox();
  expect(Math.abs(dropBox!.width - 497.78)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(dropBox!.height - 280)).toBeLessThanOrEqual(1.5);
  await expect.poll(() => lastPutNodes().includes('drop-source.png'), { timeout: 10000 }).toBe(true);

  await page.screenshot({ path: join(evidenceDir, 'regression.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});
