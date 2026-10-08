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
    out['narrow-10.png'] = { dataUrl: png(10, 1000, '#2f6262'), contentType: 'image/png' };
    out['narrow-1.png'] = { dataUrl: png(1, 1000, '#2f6262'), contentType: 'image/png' };
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

    const sampleRate = 48000;
    const seconds = 2.4;
    const frames = Math.floor(sampleRate * seconds);
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
  await expectBox(page, 'n-unknown', 497.78, 280, measurements);
  await expectBox(page, 'n-video', 497.78, 280, measurements);
  await expectBox(page, 'n-audio', 480, 240, measurements);
  await expectBox(page, 'n-audio-nodur', 480, 240, measurements);

  await expect(node(page, 'n-gen')).toContainText('账户余额不足，请充值后重试');
  await expect(node(page, 'n-gen').getByRole('button', { name: '重试' })).toBeVisible();
  await expectBox(page, 'n-gen', 497.78, 280, measurements);

  await expect(node(page, 'n-audio-gen')).toContainText('音频生成失败：模型超时');
  await expect(node(page, 'n-audio-gen').getByRole('button', { name: '重试' })).toBeVisible();
  await expectBox(page, 'n-audio-gen', 480, 240, measurements);
  await expect(node(page, 'n-audio-missing')).toContainText('素材已被删除');
  await expectBox(page, 'n-audio-missing', 480, 240, measurements);

  await expect(title(page, 'n-landscape')).toContainText('1600×900');
  await expect(title(page, 'n-landscape')).not.toContainText('MB');
  await expect(title(page, 'n-video')).toContainText('640×360');
  await expect(title(page, 'n-video')).toContainText('12s');
  await expect(title(page, 'n-video')).not.toContainText('MB');
  await expect(title(page, 'n-unknown')).toContainText('1600×900');
  await expect(title(page, 'n-gen')).not.toContainText('16:9');

  await expect(title(page, 'n-audio')).toContainText('配音成品.wav');
  await expect(title(page, 'n-audio')).toContainText('2s');
  await expect(title(page, 'n-audio')).not.toContainText('MB');
  await expect(title(page, 'n-audio')).not.toContainText('×');
  await expect(title(page, 'n-audio-nodur')).toContainText('历史音频缺时长.wav');
  await expect(title(page, 'n-audio-nodur')).not.toContainText('MB');

  expect(await node(page, 'n-unknown').evaluate((el) => (el as HTMLElement).style.transform)).toContain(
    'translate(1400px, 620px)',
  );
  expect(await node(page, 'n-extreme-wide').evaluate((el) => (el as HTMLElement).style.transform)).toContain(
    'translate(0px, 620px)',
  );
  expect(await node(page, 'n-audio').evaluate((el) => (el as HTMLElement).style.transform)).toContain(
    'translate(1200px, 1050px)',
  );

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

  await page.mouse.move(2000, 1700);
  const squareSource = node(page, 'n-square').locator('.react-flow__handle-right');
  expect(await squareSource.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  await card(page, 'n-square').hover();
  await expect
    .poll(() => squareSource.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1');

  const cardBox = (await card(page, 'n-portrait').boundingBox())!;
  const sourceHandle = (await node(page, 'n-portrait').locator('.react-flow__handle-right').boundingBox())!;
  const midY = cardBox.y + cardBox.height / 2;
  expect(Math.abs(sourceHandle.y + sourceHandle.height / 2 - midY)).toBeLessThanOrEqual(2);
  expect(Math.abs(sourceHandle.x + sourceHandle.width / 2 - (cardBox.x + cardBox.width) - 16)).toBeLessThanOrEqual(4);
  const genCardBox = (await card(page, 'n-gen').boundingBox())!;
  const targetHandle = (await node(page, 'n-gen').locator('.react-flow__handle-left').boundingBox())!;
  const genMidY = genCardBox.y + genCardBox.height / 2;
  expect(Math.abs(targetHandle.y + targetHandle.height / 2 - genMidY)).toBeLessThanOrEqual(2);
  expect(Math.abs(cardBox.x - (targetHandle.x + targetHandle.width / 2) - 16)).toBeLessThanOrEqual(4);

  await title(page, 'n-small').click();
  const toolbarBtn = page.getByRole('button', { name: '详情' });
  await expect(toolbarBtn).toBeVisible();
  const toolbarBox = (await toolbarBtn.locator('xpath=..').boundingBox())!;
  const titleBox = (await title(page, 'n-small').boundingBox())!;
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(titleBox.y + 1);
  await expect
    .poll(
      () =>
        node(page, 'n-small').locator('.react-flow__handle-right').evaluate((el) => getComputedStyle(el).opacity),
      { timeout: 3000 },
    )
    .toBe('1');

  const src = (await squareSource.boundingBox())!;
  const genHandleBox = (await node(page, 'n-gen').locator('.react-flow__handle-left').boundingBox())!;
  const dstPoint = { x: genHandleBox.x + genHandleBox.width / 2, y: genHandleBox.y + genHandleBox.height / 2 };
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dstPoint.x, dstPoint.y, { steps: 12 });
  const dstValid = await page.evaluate(() => {
    const el = document.querySelector('.react-flow__node[data-id="n-gen"] .react-flow__handle-left');
    const cls = el ? el.getAttribute('class') ?? '' : '';
    return cls.includes('valid') && cls.includes('connectingto');
  });
  expect(dstValid, '落点连接点应被 RF 标记为有效连接目标').toBe(true);
  await page.mouse.up();
  await expect.poll(() => page.locator('.react-flow__connectionline').count(), { timeout: 3000 }).toBe(0);

  const titleTextBefore = await title(page, 'n-landscape').textContent();
  await page.mouse.move(2000, 1600);
  await zoomWheel(page, 240);
  await zoomWheel(page, 240);
  await page.waitForTimeout(300);
  expect(await title(page, 'n-landscape').textContent()).toBe(titleTextBefore);
  const zoomed = await card(page, 'n-landscape').boundingBox();
  expect(zoomed!.width).toBeLessThan(497.78);

  await page.screenshot({ path: join(evidenceDir, 'interaction.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('视频：真实播放且控件可达', async ({ page }) => {  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await node(page, 'n-video').click();
  const video = node(page, 'n-video').locator('video');
  await expect(video).toBeVisible();
  expect(await video.getAttribute('controls')).toBeNull();
  const card = node(page, 'n-video');
  await expect(card.locator('button[aria-label="播放"]')).toBeVisible();
  await expect(card.locator('[data-testid="video-seek-track"]')).toBeVisible();

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

test('音频：方形内容区/连接点锚定/播放控件不被拖动吞掉/工具栏不遮挡', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await waitImagesLoaded(page);

  const measurements: Record<string, unknown> = {};
  const audioSource = node(page, 'n-audio').locator('.react-flow__handle-right');
  const audioTarget = node(page, 'n-audio-gen').locator('.react-flow__handle-left');

  await page.mouse.move(2000, 1700);
  expect(await audioSource.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  await card(page, 'n-audio').hover();
  await expect
    .poll(() => audioSource.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1');
  const box = (await card(page, 'n-audio').boundingBox())!;
  const targetBox = (await audioTarget.boundingBox())!;
  const sourceBox = (await audioSource.boundingBox())!;
  const midY = box.y + box.height / 2;
  const genBox = (await card(page, 'n-audio-gen').boundingBox())!;
  const genMidY = genBox.y + genBox.height / 2;
  measurements.contentBox = { x: box.x, y: box.y, width: box.width, height: box.height };
  measurements.handle = {
    targetMid: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 },
    sourceMid: { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 },
    contentMidY: midY,
    contentLeftX: box.x,
    contentRightX: box.x + box.width,
  };
  expect(Math.abs(targetBox.y + targetBox.height / 2 - genMidY)).toBeLessThanOrEqual(2);
  expect(Math.abs(sourceBox.y + sourceBox.height / 2 - midY)).toBeLessThanOrEqual(2);
  expect(Math.abs(genBox.x - (targetBox.x + targetBox.width / 2) - 16)).toBeLessThanOrEqual(4);
  expect(Math.abs(sourceBox.x + sourceBox.width / 2 - (box.x + box.width) - 16)).toBeLessThanOrEqual(4);

  const audio = node(page, 'n-audio').locator('audio');
  await expect(audio).toBeAttached();
  const translateBefore = await node(page, 'n-audio').evaluate((el) => (el as HTMLElement).style.transform);
  await node(page, 'n-audio').getByRole('button', { name: '播放' }).click();
  await page.waitForFunction(
    () => {
      const a = document.querySelector('.react-flow__node[data-id="n-audio"] audio') as HTMLAudioElement | null;
      return !!a && a.currentTime > 0.05;
    },
    undefined,
    { timeout: 8000 },
  );
  measurements.playedTo = await audio.evaluate((a: HTMLAudioElement) => a.currentTime);
  await node(page, 'n-audio').getByRole('button', { name: '暂停' }).click();
  expect(await node(page, 'n-audio').evaluate((el) => (el as HTMLElement).style.transform)).toBe(translateBefore);

  await title(page, 'n-audio').click();
  const toolBtn = page.getByRole('button', { name: '下载' });
  await expect(toolBtn).toBeVisible();
  const toolbarBox = (await toolBtn.locator('xpath=..').boundingBox())!;
  const titleBox = (await title(page, 'n-audio').boundingBox())!;
  measurements.toolbarBottom = toolbarBox.y + toolbarBox.height;
  measurements.titleTop = titleBox.y;
  expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(titleBox.y + 1);
  const playerTop = (await card(page, 'n-audio').boundingBox())!.y;
  measurements.playerTop = playerTop;
  expect(toolbarBox.y + toolbarBox.height, '工具栏不遮播放器内容区').toBeLessThanOrEqual(playerTop + 1);
  const toolLabels = await toolBtn.locator('xpath=..').evaluate((el) =>
    [...el.querySelectorAll('button')].map((b) => b.textContent?.trim() || b.getAttribute('title') || ''),
  );
  measurements.toolbarLabels = toolLabels;
  expect(toolLabels).toEqual(['截取', '调速', '混合', '音视频合成', '下载']);
  await expect
    .poll(() => audioSource.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1');
  await page.screenshot({ path: join(evidenceDir, 'audio.png') });

  await title(page, 'n-audio').click({ button: 'right' });
  await expect(page.getByRole('button', { name: '添加到聊天' })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建副本' })).toBeVisible();
  await page.mouse.click(2000, 1700);

  await node(page, 'n-audio').screenshot({ path: join(evidenceDir, 'audio-node.png') });

  const titleBefore = await title(page, 'n-audio').textContent();
  const widthBeforeZoom = (await card(page, 'n-audio').boundingBox())!.width;
  await page.mouse.move(2000, 1600);
  await zoomWheel(page, 240);
  await page.waitForTimeout(300);
  expect(await title(page, 'n-audio').textContent()).toBe(titleBefore);
  const zoomed = (await card(page, 'n-audio').boundingBox())!;
  measurements.zoomedWidth = zoomed.width;
  expect(zoomed.width).toBeLessThan(widthBeforeZoom);
  await zoomWheel(page, -240);
  await page.waitForTimeout(300);
  const zoomedBack = (await card(page, 'n-audio').boundingBox())!;
  measurements.zoomedBackWidth = zoomedBack.width;
  expect(Math.abs(zoomedBack.width - widthBeforeZoom)).toBeLessThanOrEqual(1.5);
  expect(await title(page, 'n-audio').textContent()).toBe(titleBefore);

  writeFileSync(join(evidenceDir, 'audio-layout.json'), `${JSON.stringify(measurements, null, 2)}\n`);
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
  await expect.poll(() => tracking.putBodies.length, { timeout: 10000 }).toBeGreaterThan(0);

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

  const audioTitle = title(page, 'n-audio');
  const audioTitleBox = (await audioTitle.boundingBox())!;
  await page.mouse.move(audioTitleBox.x + audioTitleBox.width / 2, audioTitleBox.y + audioTitleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    audioTitleBox.x + audioTitleBox.width / 2 + 50,
    audioTitleBox.y + audioTitleBox.height / 2 + 30,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect.poll(() => nodeTranslate('n-audio'), { timeout: 5000 }).not.toBe('translate(1200px, 1050px)');
  const audioDragged = /translate\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px\)/.exec(
    await nodeTranslate('n-audio'),
  );
  expect(audioDragged, '音频拖动后应有新坐标').toBeTruthy();
  const [, audioX, audioY] = audioDragged!;
  await expect
    .poll(
      () => {
        const nodes = lastPutNodes();
        return (
          nodes.includes('"id":"n-audio"') &&
          nodes.includes(`"x":${Number(audioX)}`) &&
          nodes.includes(`"y":${Number(audioY)}`)
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);

  const viewportTransform = () =>
    page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  const zoomOf = (transform: string) => /scale\(([^)]+)\)/.exec(transform)?.[1];
  const panBefore = await viewportTransform();
  await page.locator('.react-flow__pane').click({ position: { x: 1800, y: 1500 } });
  await page.mouse.move(1000, 800);
  await page.mouse.wheel(0, 120);
  await expect.poll(viewportTransform, { timeout: 3000 }).not.toBe(panBefore);
  expect(zoomOf(await viewportTransform()), '滚轮平移不应改变缩放').toBe(zoomOf(panBefore));

  await page.reload();
  await expect(page.locator('.react-flow')).toBeVisible();
  await waitImagesLoaded(page);
  expect(await nodeTranslate('n-square')).toContain(`translate(${Number(dragX)}px, ${Number(dragY)}px)`);
  expect(await nodeTranslate('n-audio')).toContain(`translate(${Number(audioX)}px, ${Number(audioY)}px)`);
  const audioAfterReload = (await card(page, 'n-audio').boundingBox())!;
  expect(Math.abs(audioAfterReload.width - 480)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(audioAfterReload.height - 240)).toBeLessThanOrEqual(1.5);

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

  const media = await ensureMedia(page);
  const dropPath = join(evidenceDir, 'drop-source.png');
  writeFileSync(dropPath, Buffer.from(media['landscape.png'].dataUrl.split(',')[1], 'base64'));
  await page.locator('input[accept="image/*,video/*,audio/*"]:not([hidden])').setInputFiles(dropPath);
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


async function titleMetrics(page: Page, id: string) {
  return node(page, id).evaluate((el) => {
    const viewport = document.querySelector('.react-flow__viewport')!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    const row = el.querySelector<HTMLElement>('[data-testid="media-title"]')!;
    const name = row.querySelector<HTMLElement>('[title]')!;
    const meta = row.lastElementChild as HTMLElement;
    const icon = row.querySelector('svg')!;
    const content = el.querySelector<HTMLElement>('[data-testid="media-content"]')!;
    return {
      zoom,
      name: parseFloat(getComputedStyle(name).fontSize) * zoom,
      meta: parseFloat(getComputedStyle(meta).fontSize) * zoom,
      icon: icon.getBoundingClientRect().width,
      contentOffset: (content.getBoundingClientRect().top - el.getBoundingClientRect().top) / zoom,
      position: (el as HTMLElement).style.transform,
      text: row.textContent,
    };
  });
}

const WHEEL_ZOOM_FACTOR = process.platform === 'darwin' ? 10 : 1;

async function zoomWheel(page: Page, deltaY: number) {
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY / WHEEL_ZOOM_FACTOR);
  await page.keyboard.up('Control');
}

async function zoomTo(page: Page, zoom: number) {
  const current = (await titleMetrics(page, 'n-landscape')).zoom;
  await page.mouse.move(1900, 1550);
  await zoomWheel(page, Math.log2(current / zoom) / 0.002);
  await expect.poll(async () => Math.abs((await titleMetrics(page, 'n-landscape')).zoom - zoom)).toBeLessThan(0.002);
}

test('标题分段缩放：三类媒体屏幕尺寸符合规格且内容锚点不移动', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await waitImagesLoaded(page);
  const ids = ['n-landscape', 'n-video', 'n-audio'];
  const baseline = await Promise.all(ids.map((id) => titleMetrics(page, id)));
  const evidence = [];
  for (const [zoom, name, meta, icon] of [
    [0.5, 8, 7.3333, 9.3333], [0.63, 10.08, 9.24, 11.76],
    [0.75, 12, 11, 14], [1, 12, 11, 14], [1.25, 15, 13.75, 17.5],
    [1.5, 16, 14, 18], [8, 16, 14, 18],
  ]) {
    await zoomTo(page, zoom);
    for (const [index, id] of ids.entries()) {
      const actual = await titleMetrics(page, id);
      evidence.push({ id, expectedZoom: zoom, ...actual });
      expect(Math.abs(actual.name - name), `${id} 名称 @ ${zoom}`).toBeLessThan(0.04);
      expect(Math.abs(actual.meta - meta), `${id} 元信息 @ ${zoom}`).toBeLessThan(0.04);
      expect(Math.abs(actual.icon - icon), `${id} 图标 @ ${zoom}`).toBeLessThan(0.04);
      expect(actual.contentOffset).toBeCloseTo(baseline[index].contentOffset, 2);
      expect(actual.position).toBe(baseline[index].position);
      expect(actual.text).toBe(baseline[index].text);
    }
  }
  writeFileSync(join(evidenceDir, 'title-scaling.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});


async function titleLayout(page: Page, id: string) {
  return node(page, id).evaluate((el) => {
    const row = el.querySelector<HTMLElement>('[data-testid="media-title"]')!;
    const name = row.querySelector<HTMLElement>('[title]')!;
    const meta = row.lastElementChild as HTMLElement;
    const content = el.querySelector('[data-testid="media-content"]')!.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    return {
      row: bounds.toJSON(), content: content.toJSON(),
      elements: [name, meta, row.querySelector('svg')!].map((item) => {
        const style = getComputedStyle(item);
        const range = document.createRange();
        range.selectNodeContents(item);
        return {
          box: item.getBoundingClientRect().toJSON(),
          glyphHeight: item.textContent ? range.getBoundingClientRect().height : 0,
          overflow: style.overflowX, ellipsis: style.textOverflow, whiteSpace: style.whiteSpace,
          truncated: item.scrollWidth > item.clientWidth,
        };
      }),
      text: meta.textContent,
      handleMidY: (() => {
        const h = el.querySelector('.react-flow__handle-right')!.getBoundingClientRect();
        return h.y + h.height / 2;
      })(),
    };
  });
}

for (const selectedId of ['n-landscape', 'n-video', 'n-audio']) {
test(`标题排版：${selectedId} 工具栏避让及窄卡片单行截断`, async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await waitImagesLoaded(page);
  const selected = [selectedId];
  await title(page, selectedId).click();
  const toolbarLocator = page.getByRole('button', { name: '下载' }).locator('xpath=..');
  const toolbar0 = (await toolbarLocator.boundingBox())!;
  const evidence = [];
  for (const zoom of [0.5, 0.63, 0.75, 1, 1.25, 1.5, 8]) {
    await zoomTo(page, zoom);
    const actualZoom = (await titleMetrics(page, 'n-landscape')).zoom;
    const toolbarBox = await toolbarLocator.boundingBox();
    for (const id of [...selected, 'n-extreme-tall', 'n-audio-nodur', 'n-gen']) {
      const layout = await titleLayout(page, id);
      evidence.push({ id, zoom: actualZoom, ...layout });
      expect(layout.row.width).toBeLessThanOrEqual(layout.content.width + 0.1);
      expect(layout.row.bottom).toBeLessThanOrEqual(layout.content.top + 0.1);
      for (const element of layout.elements) {
        expect(element.box.left).toBeGreaterThanOrEqual(layout.row.left - 0.1);
        expect(element.box.right).toBeLessThanOrEqual(layout.row.right + 0.1);
        expect(element.box.top).toBeGreaterThanOrEqual(layout.row.top - 0.1);
        expect(element.box.bottom).toBeLessThanOrEqual(layout.row.bottom + 0.1);
        expect(element.glyphHeight).toBeLessThanOrEqual(element.box.height + 0.1);
      }
      for (const element of layout.elements.slice(0, 2)) {
        expect(element.whiteSpace).toBe('nowrap');
        expect(element.overflow).toBe('hidden');
        expect(element.ellipsis).toBe('ellipsis');
      }
      expect(layout.elements[0].box.right).toBeLessThanOrEqual(layout.elements[1].box.left + 0.1);
      if (id === 'n-extreme-tall' && zoom <= 1) {
        expect(layout.elements.some((element) => element.truncated)).toBe(true);
      }
      if (id === 'n-audio-nodur') expect(['', '2s']).toContain(layout.text);
      if (id === 'n-gen') expect(layout.text).toBe('');
      expect(Math.abs(layout.handleMidY - (layout.content.y + layout.content.height / 2))).toBeLessThan(0.2);
      const index = selected.indexOf(id);
      if (index >= 0) {
        expect(toolbarBox).toBeTruthy();
        expect(Math.abs(toolbarBox!.width - toolbar0.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(toolbarBox!.height - toolbar0.height)).toBeLessThanOrEqual(1);
        if (toolbarBox!.y > 10 && zoom <= 2) {
          expect(toolbarBox!.y + toolbarBox!.height).toBeLessThan(layout.row.top + 8);
        }
      }
    }
    if (zoom === 0.63 || zoom === 1) await page.screenshot({ path: join(evidenceDir, `title-layout-${selectedId}-${zoom}.png`) });
  }
  writeFileSync(join(evidenceDir, `title-layout-${selectedId}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});
}

test('连续缩放：75%、100% 与三个独立封顶点两侧无尺寸跳变', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await waitImagesLoaded(page);
  const evidence = [];
  for (const boundary of [0.75, 1, 14 / 11, 18 / 14, 16 / 12]) {
    await zoomTo(page, boundary - 0.004);
    const before = await Promise.all(['n-landscape', 'n-video', 'n-audio'].map((id) => titleMetrics(page, id)));
    await zoomTo(page, boundary + 0.004);
    const after = await Promise.all(['n-landscape', 'n-video', 'n-audio'].map((id) => titleMetrics(page, id)));
    evidence.push({ boundary, before, after });
    for (let index = 0; index < before.length; index += 1) {
      for (const key of ['name', 'meta', 'icon'] as const) {
        expect(after[index][key]).toBeGreaterThanOrEqual(before[index][key] - 0.04);
        expect(after[index][key] - before[index][key]).toBeLessThan(0.15);
      }
    }
  }
  writeFileSync(join(evidenceDir, 'title-continuity.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});


for (const width of [10, 1]) {
  test(`极窄真实图片 ${width}×1000：标题可见区域不越过内容边界`, async ({ page }) => {
    const tracking = await setupPage(page);
    const snapshot = structuredClone(fixture['GET /api/projects/project-1/snapshot']);
    const body = snapshot.body as { data: { assets: Record<string, { width: number; access_url: string }> } };
    body.data.assets['a-extreme-tall'].width = width;
    body.data.assets['a-extreme-tall'].access_url = `https://e2e.media/narrow-${width}.png`;
    await page.route('**/api/projects/project-1/snapshot', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(body),
    }));
    await page.goto('/canvas?project=project-1');
    await waitImagesLoaded(page);
    const evidence = [];
    for (const zoom of [0.5, 0.63, 0.75, 1]) {
      await zoomTo(page, zoom);
      const result = await title(page, 'n-extreme-tall').evaluate((row) => {
        const bounds = row.getBoundingClientRect();
        const content = row.parentElement!.querySelector('[data-testid="media-content"]')!.getBoundingClientRect();
        const icon = row.querySelector('svg')!.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.right + 1, icon.top + icon.height / 2);
        return {
          rowWidth: bounds.width, contentWidth: content.width,
          overflowHit: hit !== null && row.contains(hit),
          visibleAtProbe: bounds.right > 0 && bounds.right + 1 < innerWidth && icon.top > 0 && icon.bottom < innerHeight,
        };
      });
      evidence.push({ zoom, ...result });
      expect(result.visibleAtProbe).toBe(true);
      expect(result.rowWidth).toBeLessThanOrEqual(result.contentWidth + 0.1);
      expect(result.overflowHit).toBe(false);
    }
    writeFileSync(join(evidenceDir, `title-narrow-${width}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    expect(smokeFailures(tracking)).toEqual([]);
  });
}


const textTitle = (page: Page) => node(page, 'n-text').locator('[data-testid="text-title"]');
const textContent = (page: Page) => node(page, 'n-text').locator('[data-testid="text-content"]');

async function textTitleMetrics(page: Page) {
  return node(page, 'n-text').evaluate((el) => {
    const viewport = document.querySelector('.react-flow__viewport')!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    const row = el.querySelector<HTMLElement>('[data-testid="text-title"]')!;
    const name = row.querySelector<HTMLElement>('span')!;
    const icon = row.querySelector('svg')!;
    const content = el.querySelector<HTMLElement>('[data-testid="text-content"]')!;
    return {
      zoom,
      name: parseFloat(getComputedStyle(name).fontSize) * zoom,
      icon: icon.getBoundingClientRect().width,
      contentOffset: (content.getBoundingClientRect().top - el.getBoundingClientRect().top) / zoom,
      position: (el as HTMLElement).style.transform,
      text: row.textContent,
    };
  });
}

test('文本标题分段缩放：屏幕尺寸符合父规格且与同倍率媒体标题一致', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await expect(page.locator('.react-flow')).toBeVisible();
  await waitImagesLoaded(page);

  const box = (await textContent(page).boundingBox())!;
  expect(Math.abs(box.width - 360), '正文宽度应≈360').toBeLessThanOrEqual(1.5);
  expect(Math.abs(box.height - 270), '正文高度应≈270').toBeLessThanOrEqual(1.5);

  const baseline = await textTitleMetrics(page);
  const evidence = [];
  for (const [zoom, name, icon] of [
    [0.5, 8, 9.3333], [0.63, 10.08, 11.76],
    [0.75, 12, 14], [1, 12, 14], [1.25, 15, 17.5],
    [1.5, 16, 18], [8, 16, 18],
  ]) {
    await zoomTo(page, zoom);
    const actual = await textTitleMetrics(page);
    const media = await Promise.all(['n-landscape', 'n-video', 'n-audio'].map((id) => titleMetrics(page, id)));
    evidence.push({ expectedZoom: zoom, text: actual, media });
    expect(Math.abs(actual.name - name), `文本名称 @ ${zoom}`).toBeLessThan(0.04);
    expect(Math.abs(actual.icon - icon), `文本图标 @ ${zoom}`).toBeLessThan(0.04);
    for (const item of media) {
      expect(Math.abs(actual.name - item.name), `文本与媒体名称一致 @ ${zoom}`).toBeLessThan(0.04);
      expect(Math.abs(actual.icon - item.icon), `文本与媒体图标一致 @ ${zoom}`).toBeLessThan(0.04);
    }
    expect(actual.contentOffset).toBeCloseTo(baseline.contentOffset, 2);
    expect(actual.position).toBe(baseline.position);
    expect(actual.text).toBe(baseline.text);
    if (zoom === 0.63 || zoom === 1) await page.screenshot({ path: join(evidenceDir, `text-title-${zoom}.png`) });
  }
  writeFileSync(join(evidenceDir, 'text-title-scaling.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});

test('文本标题排版：行不越界不裁切，操作条避让且大小策略不变', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await waitImagesLoaded(page);

  await textTitle(page).click();
  const evidence = [];
  const actionBar = page.getByRole('button', { name: '添加到对话' }).locator('xpath=..');
  const barBaseline = await actionBar.boundingBox();
  for (const zoom of [0.5, 0.63, 0.75, 1, 1.25, 1.5, 8]) {
    await zoomTo(page, zoom);
    const actualZoom = (await textTitleMetrics(page)).zoom;
    const layout = await node(page, 'n-text').evaluate((el) => {
      const row = el.querySelector<HTMLElement>('[data-testid="text-title"]')!;
      const name = row.querySelector<HTMLElement>('span')!;
      const icon = row.querySelector('svg')!;
      const content = el.querySelector('[data-testid="text-content"]')!.getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(name);
      const style = getComputedStyle(name);
      return {
        row: bounds.toJSON(),
        content: content.toJSON(),
        elements: [icon, name].map((item) => {
          const box = item.getBoundingClientRect();
          return { box: box.toJSON(), glyphHeight: item === name ? range.getBoundingClientRect().height : box.height };
        }),
        nameStyle: { overflow: style.overflowX, ellipsis: style.textOverflow, whiteSpace: style.whiteSpace },
        handleMidY: (() => {
          const h = el.querySelector('.react-flow__handle-right')!.getBoundingClientRect();
          return h.y + h.height / 2;
        })(),
      };
    });
    evidence.push({ zoom: actualZoom, ...layout });
    expect(layout.row.width).toBeLessThanOrEqual(layout.content.width + 0.1);
    expect(layout.row.bottom).toBeLessThanOrEqual(layout.content.top + 0.1);
    for (const element of layout.elements) {
      expect(element.box.left).toBeGreaterThanOrEqual(layout.row.left - 0.1);
      expect(element.box.right).toBeLessThanOrEqual(layout.row.right + 0.1);
      expect(element.box.top).toBeGreaterThanOrEqual(layout.row.top - 0.1);
      expect(element.box.bottom).toBeLessThanOrEqual(layout.row.bottom + 0.1);
      expect(element.glyphHeight).toBeLessThanOrEqual(element.box.height + 0.1);
    }
    expect(layout.elements[0].box.right).toBeLessThanOrEqual(layout.elements[1].box.left + 0.1);
    expect(layout.nameStyle.whiteSpace).toBe('nowrap');
    expect(layout.nameStyle.overflow).toBe('hidden');
    expect(layout.nameStyle.ellipsis).toBe('ellipsis');
    expect(Math.abs(layout.handleMidY - (layout.content.y + layout.content.height / 2))).toBeLessThan(0.2);
    const actionBarBox = await actionBar.boundingBox();
    expect(actionBarBox).toBeTruthy();
    expect(Math.abs(actionBarBox!.width - barBaseline!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(actionBarBox!.height - barBaseline!.height)).toBeLessThanOrEqual(1);
    if (actionBarBox!.y > 10 && zoom <= 2) {
      expect(actionBarBox!.y + actionBarBox!.height).toBeLessThan(layout.row.top + 8);
    }
  }
  writeFileSync(join(evidenceDir, 'text-title-layout.json'), `${JSON.stringify(evidence, null, 2)}\n`);

  await zoomTo(page, 1);
  await node(page, 'n-text').locator('[contenteditable]').dblclick();
  const formatBar = page.getByRole('button', { name: '加粗' }).locator('xpath=..');
  await expect(formatBar).toBeVisible();
  const formatBarBox = (await formatBar.boundingBox())!;
  const titleBox = (await textTitle(page).boundingBox())!;
  const contentBox = (await textContent(page).boundingBox())!;
  expect(formatBarBox.y + formatBarBox.height).toBeLessThanOrEqual(titleBox.y + 1);
  expect(formatBarBox.y + formatBarBox.height).toBeLessThanOrEqual(contentBox.y + 1);
  await page.screenshot({ path: join(evidenceDir, 'text-title-editing.png') });
  expect(smokeFailures(tracking)).toEqual([]);
});

test('文本正文回归：内部滚动/编辑保存/连接点不受标题缩放影响', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await waitImagesLoaded(page);

  await page.mouse.move(2000, 1700);
  const sourceHandle = node(page, 'n-text').locator('.react-flow__handle-right');
  expect(await sourceHandle.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await textContent(page).hover();
  await expect
    .poll(() => sourceHandle.evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 })
    .toBe('1');
  const contentBox = (await textContent(page).boundingBox())!;
  const sourceBox = (await sourceHandle.boundingBox())!;
  expect(Math.abs(sourceBox.y + sourceBox.height / 2 - (contentBox.y + contentBox.height / 2))).toBeLessThanOrEqual(2);
  expect(Math.abs(sourceBox.x + sourceBox.width / 2 - (contentBox.x + contentBox.width))).toBeLessThanOrEqual(6);

  const editor = node(page, 'n-text').locator('[contenteditable]');
  await editor.dblclick();
  const viewportTransform = () =>
    page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
  const zoomOfTransform = (t: string) => /scale\(([^)]+)\)/.exec(t)?.[1];
  const transformBefore = await viewportTransform();
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(200);
  expect(zoomOfTransform(await viewportTransform())).toBe(zoomOfTransform(transformBefore));
  const scrollTop = await editor.evaluate((el) => el.scrollTop);
  expect(scrollTop, '正文应真实滚动').toBeGreaterThan(0);

  await editor.pressSequentially('分段缩放后新增的一段');
  await page.locator('.react-flow__pane').click({ position: { x: 1900, y: 300 } });
  await expect
    .poll(
      () =>
        tracking.putBodies.some((raw) => {
          try {
            const parsed = JSON.parse(raw) as { nodes?: string };
            return (
              typeof parsed.nodes === 'string' &&
              parsed.nodes.includes('"id":"n-text"') &&
              parsed.nodes.includes('分段缩放后新增的一段')
            );
          } catch {
            return false;
          }
        }),
      { timeout: 10000 },
    )
    .toBe(true);

  await page.screenshot({ path: join(evidenceDir, 'text-body-regression.png') });
  writeFileSync(
    join(evidenceDir, 'text-body-regression.json'),
    `${JSON.stringify({ scrollTop, contentBox }, null, 2)}\n`,
  );
  expect(smokeFailures(tracking)).toEqual([]);
});

test('文本标题连续缩放：75%、100% 与名称、图标封顶倍率两侧无尺寸跳变', async ({ page }) => {
  const tracking = await setupPage(page);
  await page.goto('/canvas?project=project-1');
  await waitImagesLoaded(page);
  const evidence = [];
  for (const boundary of [0.75, 1, 18 / 14, 16 / 12]) {
    await zoomTo(page, boundary - 0.004);
    const before = await textTitleMetrics(page);
    await zoomTo(page, boundary + 0.004);
    const after = await textTitleMetrics(page);
    evidence.push({ boundary, before, after });
    for (const key of ['name', 'icon'] as const) {
      expect(after[key]).toBeGreaterThanOrEqual(before[key] - 0.04);
      expect(after[key] - before[key]).toBeLessThan(0.15);
    }
  }
  writeFileSync(join(evidenceDir, 'text-title-continuity.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  expect(smokeFailures(tracking)).toEqual([]);
});
