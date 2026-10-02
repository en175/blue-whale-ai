// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { UploadCompleteData } from '@/api/assets';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { TOOL_SESSION_KINDS, type ToolSessionDeps } from './toolSessionCoordinator';
import { createCropSession, applyCropPreset } from './cropSession';

const deps: ToolSessionDeps = {
  activity: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, null])) as ToolSessionDeps['activity'],
  exits: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, () => {}])) as ToolSessionDeps['exits'],
  dismissGenPanels() {}, selectNode() {},
};
const source: Node = { id: 'i1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '5', src: 'http://img/i1.png', width: 1600, height: 900, mime: 'image/png' } };
const uploaded: UploadCompleteData = { asset_id: '901', status: 'ready', type: 'image', url: 'http://img/crop.png', width: 1200, height: 900, duration: null, mime: 'image/png', size: 100 };

it('裁切进入默认自由全幅；预设内接，解除比例不改框，关闭后重开完整重置', () => {
  const runtime = createToolSessionRuntime();
  const tool = runtime.register(createCropSession(() => ({
    getProjectId: () => 'p1', getSourceNode: () => source,
    uploadFile: async () => uploaded, handoff() {}, warn() {}, error() {},
  })));
  expect(tool.open('i1', deps)).toBe(true);
  expect(tool.getSnapshot().state?.preset).toBe('free');
  expect(tool.getSnapshot().state?.rect).toEqual({ x: 400, y: 22.5, width: 280 * 16 / 9, height: 280 });
  tool.edit((state) => applyCropPreset(state, source, '4:3'));
  const inner = tool.getSnapshot().state?.rect;
  expect(inner?.width).toBeCloseTo(280 * 4 / 3);
  expect(inner?.height).toBe(280);
  tool.edit((state) => applyCropPreset(state, source, 'free'));
  expect(tool.getSnapshot().state?.rect).toEqual(inner);
  tool.close();
  expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
  tool.open('i1', deps);
  expect(tool.getSnapshot().state?.preset).toBe('free');
  expect(tool.getSnapshot().state?.rect.width).toBeCloseTo(280 * 16 / 9);
});

it('统一源卡核对钳制旁路移动后的裁切框，删除源卡完整清理', () => {
  const runtime = createToolSessionRuntime();
  const moved = { ...source, position: { ...source.position } };
  const tool = runtime.register(createCropSession(() => ({
    getProjectId: () => 'p1', getSourceNode: () => moved,
    uploadFile: async () => uploaded, handoff() {}, warn() {}, error() {},
  })));
  tool.open('i1', deps);
  moved.position.x = 1000;
  runtime.reconcileSources(new Set(['i1']));
  expect(tool.getSnapshot().state?.rect.x).toBe(1000);
  runtime.reconcileSources(new Set());
  expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
});

it('100×100 源图选 9:16 仍保持自然短边 64 像素下限，解除比例保留合法框', () => {
  const smallSource = { ...source, data: { ...source.data, width: 100, height: 100 } };
  const runtime = createToolSessionRuntime();
  const tool = runtime.register(createCropSession(() => ({
    getProjectId: () => 'p1', getSourceNode: () => smallSource,
    uploadFile: async () => uploaded, handoff() {}, warn() {}, error() {},
  })));
  tool.open('i1', deps);
  tool.edit((state) => applyCropPreset(state, smallSource, '9:16'));
  const rect = tool.getSnapshot().state?.rect;
  expect(rect?.width).toBeCloseTo(179.2);
  expect(rect?.height).toBe(280);
  tool.edit((state) => applyCropPreset(state, smallSource, 'free'));
  expect(tool.getSnapshot().state?.rect).toEqual(rect);
});


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('本地编码前同步锁与冻结输入，普通上传后退出再交接成品，不需要后台任务标识', async () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  let encoded!: (blob: Blob | null) => void;
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => { encoded = callback; });
  vi.stubGlobal('Image', class {
    crossOrigin = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_src: string) { this.onload?.(); }
  });
  const runtime = createToolSessionRuntime();
  let projectId = 'p1';
  const mutableSource = { ...source, data: { ...source.data }, position: { ...source.position } };
  const uploads: Array<{ file: File; projectId: string | undefined }> = [];
  const results: Node[] = [];
  const tool = runtime.register(createCropSession(() => ({
    getProjectId: () => projectId, getSourceNode: () => mutableSource,
    uploadFile: async (file, projectId) => { uploads.push({ file, projectId }); return uploaded; },
    handoff: (input) => { expect(tool.getSnapshot().state).toBeNull(); expect(input.projectId).toBe('p1'); results.push(input.source); },
    warn() {}, error() {},
  })));
  tool.open('i1', deps);
  tool.edit((state) => applyCropPreset(state, mutableSource, '4:3'));
  expect(tool.send()).toBe(true);
  expect(tool.send()).toBe(false);
  expect(tool.getSnapshot().submitting).toBe(true);
  expect(uploads).toEqual([]);
  tool.edit((state) => ({ ...state, rect: { ...state.rect, width: 64 } }));
  projectId = 'p2'; mutableSource.position.x = 999; mutableSource.data.src = 'http://img/replaced.jpg';
  encoded(new Blob(['crop'], { type: 'image/png' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(drawImage.mock.calls[0].slice(1)).toEqual([200, 0, 1200, 900, 0, 0, 1200, 900]);
  expect(uploads[0].projectId).toBe('p1');
  expect(uploads[0].file.name).toBe('crop.png');
  expect(results[0].position.x).toBe(400);
  expect(results[0].data.src).toBe('http://img/i1.png');
});

it.each(['close', 'switch', 'project', 'delete'] as const)('%s 后旧上传成功继续交接；旧失败不干扰后来界面', async (change) => {
  for (const outcome of ['success', 'failure']) {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['crop'], { type: 'image/png' })));
    vi.stubGlobal('Image', class {
      crossOrigin = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_src: string) { this.onload?.(); }
    });
    const runtime = createToolSessionRuntime();
    runtime.setProject('p1');
    let projectId = 'p1';
    let accept!: (uploaded: UploadCompleteData) => void;
    let reject!: (error: Error) => void;
    const inputs: Array<string | undefined> = [];
    const results: Node[] = [];
    const errors: string[] = [];
    const tool = runtime.register(createCropSession(() => ({
      getProjectId: () => projectId, getSourceNode: () => source,
      uploadFile: (_file, projectId) => { inputs.push(projectId); return new Promise((resolve, fail) => { accept = resolve; reject = fail; }); },
      handoff: (input) => { expect(input.projectId).toBe('p1'); results.push(input.source); },
      warn() {}, error: (message) => { errors.push(message); },
    })));
    tool.open('i1', deps); tool.send();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (change === 'close') tool.close();
    if (change === 'switch') runtime.enterLegacy('audioTrim', deps, () => {});
    if (change === 'delete') runtime.reconcileSources(new Set());
    if (change === 'project') { projectId = 'p2'; runtime.setProject('p2'); tool.open('i1', deps); }
    const laterView = tool.getSnapshot();
    if (outcome === 'success') accept(uploaded); else reject(new Error('旧上传错误'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tool.getSnapshot()).toEqual(laterView);
    expect(errors).toEqual([]);
    expect(inputs).toEqual(['p1']);
    expect(results).toHaveLength(outcome === 'success' ? 1 : 0);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
