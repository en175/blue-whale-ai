/* ============================================
 * text-node-media-index 验收取证（IKFM3Q）
 * 真实浏览器（Playwright Chromium）验证正文媒体索引契约 v1：
 * @ 插入三类媒体、编号复用与重排、删部分/最后标签与关系线联动、
 * 删线/删源节点置失效（不自动补回）、重新绑定修复、悬停预览、点击定位、刷新恢复。
 * 业务 API 侧核对 PUT body 的 nodes+edges；数据库侧由 backend 集成测试覆盖。
 * ============================================ */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureForRequest, smokeFailures } from '../scripts/bugfix-smoke-support.mjs';

type Fixture = { status: number; body: unknown; headers?: Record<string, string> };

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'text-node-media-index.json'), 'utf8'),
) as Record<string, Fixture>;

const evidenceDir =
  process.env.MEDIA_INDEX_EVIDENCE_DIR ??
  join(import.meta.dirname, '..', 'test-results', 'text-node-media-index');
mkdirSync(evidenceDir, { recursive: true });

interface Tracking {
  putBodies: string[];
  consoleErrors: string[];
  unexpectedRequests: string[];
  failedResponses: string[];
}

interface GeneratedMedia {
  [name: string]: { dataUrl: string; contentType: string };
}

let mediaCache: GeneratedMedia | null = null;

/** 生成验收用媒体：两图（cat/dog）、一段视频（sample.webm）、一段音频（tone.wav） */
async function ensureMedia(page: Page): Promise<GeneratedMedia> {
  if (mediaCache) return mediaCache;
  mediaCache = await page.evaluate(async () => {
    const out: Record<string, { dataUrl: string; contentType: string }> = {};
    const png = (w: number, h: number, color: string, text: string) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = color;
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#ffffff';
      x.font = '48px sans-serif';
      x.fillText(text, 40, Math.floor(h / 2));
      return c.toDataURL('image/png');
    };
    out['cat.png'] = { dataUrl: png(800, 600, '#2f5d62', 'cat'), contentType: 'image/png' };
    out['dog.png'] = { dataUrl: png(800, 600, '#62522f', 'dog'), contentType: 'image/png' };

    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const x = c.getContext('2d')!;
    const stream = c.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
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
        if (elapsed < 600) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    out['sample.webm'] = {
      dataUrl: await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(blob);
      }),
      contentType: 'video/webm',
    };

    // 音频：手写编码 1.2s 440Hz 单声道 16bit PCM WAV
    const sampleRate = 48000;
    const frames = Math.floor(sampleRate * 1.2);
    const wav = new DataView(new ArrayBuffer(44 + frames * 2));
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i += 1) wav.setUint8(offset + i, text.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    wav.setUint32(4, 36 + frames * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, sampleRate, true);
    wav.setUint32(28, sampleRate * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    ascii(36, 'data');
    wav.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i += 1) {
      wav.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), true);
    }
    const wavBytes = new Uint8Array(wav.buffer);
    let binary = '';
    for (let i = 0; i < wavBytes.length; i += 0x8000) {
      binary += String.fromCharCode(...Array.from(wavBytes.subarray(i, i + 0x8000)));
    }
    out['tone.wav'] = { dataUrl: `data:audio/wav;base64,${btoa(binary)}`, contentType: 'audio/wav' };
    return out;
  });
  return mediaCache;
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

  // 画布文档动态化：PUT 记录请求体并更新内存态（含 edges），GET 返回最新态（验证 编辑→保存→刷新 闭环）
  const initialDoc = (
    fixture['GET /api/canvases?projectId=project-1'].body as { data: { viewport: string; nodes: string; edges?: string } }
  ).data;
  const canvasState = { nodes: initialDoc.nodes, viewport: initialDoc.viewport, edges: initialDoc.edges ?? '[]', version: 1 };
  await page.route('**/api/canvases**', async (route) => {
    if (route.request().method() === 'PUT') {
      const raw = route.request().postData() ?? '';
      tracking.putBodies.push(raw);
      try {
        const parsed = JSON.parse(raw) as { viewport?: string; nodes?: string; edges?: string };
        if (typeof parsed.viewport === 'string') canvasState.viewport = parsed.viewport;
        if (typeof parsed.nodes === 'string') canvasState.nodes = parsed.nodes;
        if (typeof parsed.edges === 'string') canvasState.edges = parsed.edges;
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
        data: { id: 1, project_id: 1, version: canvasState.version, viewport: canvasState.viewport, nodes: canvasState.nodes, edges: canvasState.edges },
      }),
    });
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
const editor = (page: Page, id: string) => node(page, id).locator('[data-placeholder]');
const mediaChip = (page: Page, textId: string, mediaId: string) =>
  node(page, textId).locator(`[data-media-node="${mediaId}"]`);

/** 光标置于编辑器末尾（@ 触发与插入都需要确定的光标位置） */
async function placeCaretAtEnd(loc: Locator) {
  await loc.evaluate((el) => {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

/** @ 菜单选素材：搜索框（autoFocus）输入名称过滤，点选面板内匹配项（避开 flyout 悬停桥接） */
async function pickFromMentionMenu(page: Page, name: string) {
  const menu = page.locator('[data-testid="mention-menu"]');
  await expect(menu).toBeVisible();
  await page.keyboard.type(name);
  await menu.locator('[data-testid="at-mention-canvas-item"]', { hasText: name }).first().click();
  await expect(menu).toHaveCount(0);
}

interface PutDoc {
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
}

/** 解析一次 PUT body 的 nodes/edges */
function parsePut(raw: string): PutDoc {
  const parsed = JSON.parse(raw) as { nodes?: string; edges?: string };
  return {
    nodes: JSON.parse(parsed.nodes ?? '[]') as PutDoc['nodes'],
    edges: JSON.parse(parsed.edges ?? '[]') as PutDoc['edges'],
  };
}

function lastPut(tracking: Tracking): PutDoc {
  return parsePut(tracking.putBodies[tracking.putBodies.length - 1] ?? '{}');
}

/** 等到出现一次满足条件的 PUT（自动保存 800ms 防抖，轮询放宽到 6s） */
async function waitPut(tracking: Tracking, predicate: (doc: PutDoc) => boolean, label: string) {
  await expect
    .poll(
      () => tracking.putBodies.map(parsePut).filter(predicate).length,
      { timeout: 6000, intervals: [200, 400, 800, 1200] },
    )
    .toBeGreaterThan(0);
}

const hasEdge = (doc: PutDoc, source: string, target: string) =>
  doc.edges.some(e => e.source === source && e.target === target && (e.data as Record<string, unknown> | undefined)?.textIndex === true);

async function insertMedia(page: Page, textId: string, name: string) {
  await placeCaretAtEnd(editor(page, textId));
  await page.keyboard.type('@');
  await pickFromMentionMenu(page, name);
}

test.use({ viewport: { width: 1900, height: 1400 } });

test('@ 插入三类媒体：分类型编号、PUT 携带区间/refs/textIndex 关系线、刷新恢复', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'media-img-1')).toBeVisible();

  await editor(page, 'text-1').dblclick();
  await page.keyboard.type('参考 ');
  await insertMedia(page, 'text-1', '猫咪.png');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '图片1');
  await insertMedia(page, 'text-1', '片段.webm');
  await expect(mediaChip(page, 'text-1', 'media-vid-1')).toHaveAttribute('data-media-label', '视频1');
  await insertMedia(page, 'text-1', '配乐.wav');
  await expect(mediaChip(page, 'text-1', 'media-aud-1')).toHaveAttribute('data-media-label', '音频1');

  // PUT 契约：正文含派生标签；区间锚定三类身份；refs 快照；三条 textIndex 关系线
  await waitPut(tracking, doc => hasEdge(doc, 'media-aud-1', 'text-1'), '三类关系线落盘');
  const doc = lastPut(tracking);
  const text = doc.nodes.find(n => n.id === 'text-1')!;
  expect(text.data.text).toBe('参考 图片1视频1音频1');
  expect(text.data.mediaMentions).toEqual([
    { start: 3, end: 6, nodeId: 'media-img-1', assetId: '9001' },
    { start: 6, end: 9, nodeId: 'media-vid-1', assetId: '9003' },
    { start: 9, end: 12, nodeId: 'media-aud-1', assetId: '9004' },
  ]);
  expect(text.data.mediaRefs).toEqual([
    { nodeId: 'media-img-1', assetId: '9001', mediaType: 'image', name: '猫咪.png', url: 'https://e2e.media/cat.png' },
    { nodeId: 'media-vid-1', assetId: '9003', mediaType: 'video', name: '片段.webm', url: 'https://e2e.media/sample.webm' },
    { nodeId: 'media-aud-1', assetId: '9004', mediaType: 'audio', name: '配乐.wav', url: 'https://e2e.media/tone.wav' },
  ]);
  for (const source of ['media-img-1', 'media-vid-1', 'media-aud-1']) {
    expect(hasEdge(doc, source, 'text-1'), `${source} 关系线`).toBe(true);
  }

  // 刷新恢复：编号与关系线原样（不得只有正文或只有连线的半恢复）
  await page.reload();
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '图片1');
  await expect(mediaChip(page, 'text-1', 'media-vid-1')).toHaveAttribute('data-media-label', '视频1');
  await expect(mediaChip(page, 'text-1', 'media-aud-1')).toHaveAttribute('data-media-label', '音频1');
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);

  await page.screenshot({ path: join(evidenceDir, 'insert-three-kinds.png') });
  writeFileSync(join(evidenceDir, 'insert-three-kinds.json'), `${JSON.stringify(lastPut(tracking), null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});

test('重复索引复用编号；删部分保留索引与关系线；删最后一个解除', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'media-img-1')).toBeVisible();

  await editor(page, 'text-1').dblclick();
  await page.keyboard.type('参考 ');
  await insertMedia(page, 'text-1', '猫咪.png');
  await insertMedia(page, 'text-1', '猫咪.png');
  // 同素材重复标签复用编号；关系线仍一条
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveCount(2);
  for (const chip of await mediaChip(page, 'text-1', 'media-img-1').all()) {
    await expect(chip).toHaveAttribute('data-media-label', '图片1');
  }
  await waitPut(tracking, doc => hasEdge(doc, 'media-img-1', 'text-1'), '首次索引关系线落盘');
  expect(lastPut(tracking).edges.filter(e => e.source === 'media-img-1' && e.target === 'text-1')).toHaveLength(1);

  // 删部分重复标签：索引与关系线保留，编号不变
  await mediaChip(page, 'text-1', 'media-img-1').first().click();
  await page.locator('[data-testid="media-chip-menu"] button', { hasText: '删除标签' }).click();
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveCount(1);
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '图片1');
  await waitPut(tracking, doc => (doc.nodes.find(n => n.id === 'text-1')!.data.mediaMentions as unknown[]).length === 1, '删部分标签落盘');
  expect(hasEdge(lastPut(tracking), 'media-img-1', 'text-1')).toBe(true);

  // 删最后一个标签：索引解除、关系线删除
  await mediaChip(page, 'text-1', 'media-img-1').click();
  await page.locator('[data-testid="media-chip-menu"] button', { hasText: '删除标签' }).click();
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveCount(0);
  await waitPut(tracking, doc => doc.edges.every(e => !(e.source === 'media-img-1' && e.target === 'text-1')), '最后标签删线落盘');
  const doc = lastPut(tracking);
  expect(doc.edges.some(e => e.source === 'media-img-1' && e.target === 'text-1')).toBe(false);
  expect((doc.nodes.find(n => n.id === 'text-1')!.data.mediaMentions as unknown[])).toHaveLength(0);

  await page.screenshot({ path: join(evidenceDir, 'repeat-and-delete.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('直接删关系线：标签置失效不自动补回；重新绑定到新素材修复', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'media-img-1')).toBeVisible();

  await editor(page, 'text-1').dblclick();
  await page.keyboard.type('参考 ');
  await insertMedia(page, 'text-1', '猫咪.png');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '图片1');
  await waitPut(tracking, doc => hasEdge(doc, 'media-img-1', 'text-1'), '关系线落盘');
  // 退出编辑态，避免删线被编辑器内状态干扰
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 700 } });

  // 剪刀删除媒体→文本卡关系线：标签保留为已失效：原素材名
  // （剪刀默认隐藏且跟随指针：先悬停命中路径让剪刀滑到指针下，再于当前位置点击）
  const hitPath = page.locator('.react-flow__edge [class*="hitPath"]').first();
  const hitBox = (await hitPath.boundingBox())!;
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '已失效：猫咪.png');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-invalid', '1');

  // 编辑正文后保存：失效身份快照保留，关系线不自动补回
  await editor(page, 'text-1').dblclick();
  await placeCaretAtEnd(editor(page, 'text-1'));
  await page.keyboard.type('改');
  await waitPut(tracking, doc => (doc.nodes.find(n => n.id === 'text-1')!.data.text as string).includes('改'), '编辑落盘');
  const afterEdit = lastPut(tracking);
  expect(afterEdit.edges.some(e => e.source === 'media-img-1' && e.target === 'text-1')).toBe(false);
  expect(afterEdit.nodes.find(n => n.id === 'text-1')!.data.mediaRefs).toEqual([
    { nodeId: 'media-img-1', assetId: '9001', mediaType: 'image', name: '猫咪.png', url: 'https://e2e.media/cat.png' },
  ]);
  await page.screenshot({ path: join(evidenceDir, 'edge-cut-invalid.png') });

  // 重新绑定：失效标签点击 → 重新绑定 → 选狗狗.png → 有效索引 + 新关系线
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 700 } });
  await mediaChip(page, 'text-1', 'media-img-1').click();
  await page.locator('[data-testid="media-chip-menu"] button', { hasText: '重新绑定' }).click();
  await pickFromMentionMenu(page, '狗狗.png');
  await expect(mediaChip(page, 'text-1', 'media-img-2')).toHaveAttribute('data-media-label', '图片1');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveCount(0);
  await waitPut(tracking, doc => hasEdge(doc, 'media-img-2', 'text-1'), '重绑定关系线落盘');
  const rebound = lastPut(tracking);
  expect(rebound.nodes.find(n => n.id === 'text-1')!.data.mediaRefs).toEqual([
    { nodeId: 'media-img-2', assetId: '9002', mediaType: 'image', name: '狗狗.png', url: 'https://e2e.media/dog.png' },
  ]);
  await page.screenshot({ path: join(evidenceDir, 'rebind-valid.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('直接删关系线：重新绑定同一素材补回关系线', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'media-img-1')).toBeVisible();

  await editor(page, 'text-1').dblclick();
  await page.keyboard.type('参考 ');
  await insertMedia(page, 'text-1', '猫咪.png');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '图片1');
  await waitPut(tracking, doc => hasEdge(doc, 'media-img-1', 'text-1'), '关系线落盘');
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 700 } });

  const hitPath = page.locator('.react-flow__edge [class*="hitPath"]').first();
  const hitBox = (await hitPath.boundingBox())!;
  await page.mouse.move(hitBox.x + hitBox.width / 2, hitBox.y + hitBox.height / 2);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-invalid', '1');

  await mediaChip(page, 'text-1', 'media-img-1').click();
  await page.locator('[data-testid="media-chip-menu"] button', { hasText: '重新绑定' }).click();
  await pickFromMentionMenu(page, '猫咪.png');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '图片1');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).not.toHaveAttribute('data-media-invalid', '1');
  await waitPut(tracking, doc => hasEdge(doc, 'media-img-1', 'text-1'), '同来源重绑定补线落盘');
  const rebound = lastPut(tracking);
  expect(rebound.nodes.find(n => n.id === 'text-1')!.data.mediaRefs).toEqual([
    { nodeId: 'media-img-1', assetId: '9001', mediaType: 'image', name: '猫咪.png', url: 'https://e2e.media/cat.png' },
  ]);
  await page.screenshot({ path: join(evidenceDir, 'rebind-same-source.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('删除来源媒体节点：标签置失效；刷新后失效态与无连线一致恢复', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'media-img-1')).toBeVisible();

  await editor(page, 'text-1').dblclick();
  await page.keyboard.type('参考 ');
  await insertMedia(page, 'text-1', '猫咪.png');
  await waitPut(tracking, doc => hasEdge(doc, 'media-img-1', 'text-1'), '关系线落盘');
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 700 } });

  // 删除来源媒体节点（连线随节点级联删除，标签置失效）
  await node(page, 'media-img-1').click();
  await page.keyboard.press('Backspace');
  await expect(node(page, 'media-img-1')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '已失效：猫咪.png');
  await waitPut(tracking, doc => doc.nodes.every(n => n.id !== 'media-img-1'), '节点删除落盘');

  // 刷新恢复：失效标签、身份快照与「无连线」一致恢复（只有正文或只有连线的半恢复不允许）
  await page.reload();
  await expect(node(page, 'media-img-1')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-label', '已失效：猫咪.png');
  await expect(mediaChip(page, 'text-1', 'media-img-1')).toHaveAttribute('data-media-invalid', '1');
  await page.screenshot({ path: join(evidenceDir, 'source-deleted-invalid.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('删除身份后有效编号紧凑重排；视频/音频悬停预览', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'media-img-1')).toBeVisible();

  await editor(page, 'text-1').dblclick();
  await page.keyboard.type('参考 ');
  await insertMedia(page, 'text-1', '猫咪.png');
  await insertMedia(page, 'text-1', '狗狗.png');
  await insertMedia(page, 'text-1', '片段.webm');
  await insertMedia(page, 'text-1', '配乐.wav');
  await expect(mediaChip(page, 'text-1', 'media-img-2')).toHaveAttribute('data-media-label', '图片2');
  await expect(mediaChip(page, 'text-1', 'media-vid-1')).toHaveAttribute('data-media-label', '视频1');
  await expect(mediaChip(page, 'text-1', 'media-aud-1')).toHaveAttribute('data-media-label', '音频1');

  // 删除「猫咪」（图片1）身份：狗狗 重排为 图片1，写回 PUT 正文与区间
  await mediaChip(page, 'text-1', 'media-img-1').click();
  await page.locator('[data-testid="media-chip-menu"] button', { hasText: '删除标签' }).click();
  await expect(mediaChip(page, 'text-1', 'media-img-2')).toHaveAttribute('data-media-label', '图片1');
  await waitPut(tracking, doc => (doc.nodes.find(n => n.id === 'text-1')!.data.text as string) === '参考 图片1视频1音频1', '编号重排落盘');
  const doc = lastPut(tracking);
  expect(doc.nodes.find(n => n.id === 'text-1')!.data.mediaMentions).toEqual([
    { start: 3, end: 6, nodeId: 'media-img-2', assetId: '9002' },
    { start: 6, end: 9, nodeId: 'media-vid-1', assetId: '9003' },
    { start: 9, end: 12, nodeId: 'media-aud-1', assetId: '9004' },
  ]);
  expect(hasEdge(doc, 'media-img-1', 'text-1')).toBe(false);
  expect(hasEdge(doc, 'media-img-2', 'text-1')).toBe(true);

  // 视频悬停预览：video 元素；音频悬停预览：类型标识与名称
  await mediaChip(page, 'text-1', 'media-vid-1').hover();
  const videoPreview = page.locator('[data-testid="media-chip-preview"]');
  await expect(videoPreview).toBeVisible();
  await expect(videoPreview.locator('video')).toBeVisible();
  await expect(videoPreview.locator('video')).toHaveAttribute('src', 'https://e2e.media/sample.webm');
  await mediaChip(page, 'text-1', 'media-aud-1').hover();
  const audioPreview = page.locator('[data-testid="media-chip-preview"]');
  await expect(audioPreview).toBeVisible();
  await expect(audioPreview).toContainText('音频');
  await expect(audioPreview).toContainText('配乐.wav');
  await page.screenshot({ path: join(evidenceDir, 'renumber-and-previews.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('悬停预览素材；点击有效标签定位来源节点', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(node(page, 'media-img-1')).toBeVisible();

  await editor(page, 'text-1').dblclick();
  await page.keyboard.type('参考 ');
  await insertMedia(page, 'text-1', '猫咪.png');
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 700 } });

  // 悬停标签：约 150ms 后出图片预览
  await mediaChip(page, 'text-1', 'media-img-1').hover();
  const preview = page.locator('[data-testid="media-chip-preview"]');
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toBeVisible();
  await expect(preview.locator('img')).toHaveAttribute('src', 'https://e2e.media/cat.png');
  await page.screenshot({ path: join(evidenceDir, 'hover-preview.png') });
  await page.locator('.react-flow__pane').hover({ position: { x: 900, y: 700 } });
  await expect(preview).toHaveCount(0);

  // 点击有效标签：画布平移定位到来源节点（视口 transform 变化）
  const before = await page.locator('.react-flow__viewport').evaluate(el => (el as HTMLElement).style.transform);
  await mediaChip(page, 'text-1', 'media-img-1').click();
  await expect
    .poll(() => page.locator('.react-flow__viewport').evaluate(el => (el as HTMLElement).style.transform), { timeout: 3000 })
    .not.toBe(before);
  // 来源节点进入视口中央区域（等 300ms 平移动画结束）
  await page.waitForTimeout(600);
  const box = await node(page, 'media-img-1').boundingBox();
  expect(box).toBeTruthy();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  expect(Math.abs(cx - 950)).toBeLessThan(260);
  expect(Math.abs(cy - 700)).toBeLessThan(220);
  await page.screenshot({ path: join(evidenceDir, 'locate-source.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});
