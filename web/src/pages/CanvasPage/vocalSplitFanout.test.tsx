// @vitest-environment jsdom
/* IKHA30 人声背景分离完成轨卡扇出与状态恢复（页面级 mock 终态驱动）。
   锁定：成功终态移除占位卡、按 tracks 扇出普通音频成品卡（两轨=人声+背景音、三轨=人声+音乐+音效）、
   轨卡命名（括号词随轨类型、后缀随所选格式）、各轨卡对源卡拉来源边（origin=vocal-split）、
   扇出后立刻落库；刷新恢复三态——生成中续轮询（IKHA2W 既有）、失败可重试（IKHA2W 既有测试
   vocalSplitEdit.test.tsx 锁定）、已完成水合首 tick 直接扇出无占位残留；重复水合按轨卡
   确定性 id 判重不重复建卡。真实端到端在 worker/网关就绪后联调补验，本文件不阻塞。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { VOCAL_SPLIT_EDGE_ORIGIN } from './vocalSplit';
import type { GenerationModel } from '@/api/generation';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点/连线与触发画布回调 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));
vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));
vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));
vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createVocalSplit: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));

vi.mock('@/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => Promise.resolve({ items: [] }),
    retry: false,
  }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));

vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createVocalSplit: apiMocks.createVocalSplit,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：一个就绪视频节点 v1（1920×1080，assetId 5；无连线） */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '素材视频',
            assetId: '5',
            width: 1920,
            height: 1080,
            duration: 30,
          },
        },
      ],
      edges: [],
    },
    assets: { 5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 追加轨产物资产字典条目（恢复态轨卡水合按 assetId 解析 src 用） */
function pushTrackAssets(jobId: string) {
  const assets = canvasDocMock.current.assets as Record<string, unknown>;
  assets[`t-${jobId}-voice`] = { asset_id: `t-${jobId}-voice`, type: 'audio', access_url: `http://tos/${jobId}-voice.aac` };
  assets[`t-${jobId}-bg`] = { asset_id: `t-${jobId}-bg`, type: 'audio', access_url: `http://tos/${jobId}-bg.aac` };
}

/** 快照直接含生成中占位卡（模拟「IKHA2W 期间发送后刷新」的落库现场：占位卡与来源边同落库） */
function seedDocWithPlaceholder(jobId: string, outputFormat = 'aac') {
  seedDoc();
  pushTrackAssets(jobId);
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id: `vocal-split-${jobId}`,
    type: 'mediaNode',
    // 占位卡位置 = 源卡 400 + 源内容宽 497.78 + 60 ≈ 958（round 后 958）
    position: { x: 958, y: 0 },
    data: {
      src: '',
      fileName: '素材视频(人声背景分离)',
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId,
      vocalSplit: {
        sourceAssetId: '5',
        lastInput: { source_asset_id: '5', scene: 'audio', output_format: outputFormat },
      },
    },
  });
  (canvasDocMock.current.doc as { edges: Array<Record<string, unknown>> }).edges.push({
    id: `e-v1-vocal-split-${jobId}`,
    source: 'v1',
    target: `vocal-split-${jobId}`,
    data: { origin: VOCAL_SPLIT_EDGE_ORIGIN },
  });
}

const twoTracksOf = (jobId: string) => [
  { track_type: 'voice', asset_id: `t-${jobId}-voice`, url: `http://tos/${jobId}-voice.aac`, duration: 15.5 },
  { track_type: 'background', asset_id: `t-${jobId}-bg`, url: `http://tos/${jobId}-bg.aac`, duration: 15.5 },
];

let root: Root;
let container: HTMLDivElement;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

/** 进入人声背景分离编辑态（源视频卡工具条回调挂点） */
async function enterVocal() {
  const video = (flowProps.current.mediaNodes as Array<Record<string, any>>).find((n) => n.id === 'v1')!;
  await act(async () => {
    video.data.onVocalBackgroundSplit('v1');
  });
}

async function click(testId: string) {
  await act(async () => {
    document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 编辑态内点发送（startVocalSplitJob 含 await 创建，等 60ms 让建卡、轮询首 tick 与扇出落库发起） */
async function sendVocal() {
  await click('vocal-split-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

/** 水合后等一轮（轮询首 tick mock 立即 resolve，60ms 足够扇出 + flush 发起） */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

/** 等过轮询 tick 间隔（pollJob 间 2500ms），驱动下一轮 tick 返回新 mock 的终态 */
async function terminalTick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2600));
  });
}

function nodeById(id: string): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id);
}

function edges(): Array<{ source: string; target: string; data?: Record<string, unknown> }> {
  return flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>;
}

/** 落库调用中含轨卡的那一次（扇出 flush；与发送建占位卡的 flush 区分） */
type SavePayload = { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string; data?: Record<string, unknown> }> };
function fanoutSaveCall(): SavePayload | undefined {
  return (apiMocks.saveCanvasDoc.mock.calls as unknown as Array<[string, SavePayload, unknown]>)
    .map((call) => call[1])
    .find((payload) => payload.nodes.some((n) => n.id.startsWith('vocal-track-')));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createVocalSplit.mockReset();
  apiMocks.createMediaExtraction.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHA30 成功扇出（发送→成功终态）', () => {
  it('两轨场景（通用/aac）：移除占位卡，扇出 源名(人声|背景音).aac 两张普通音频卡，各拉来源边，落库同一次 PUT', async () => {
    apiMocks.createVocalSplit.mockResolvedValue({ job_id: 'j701', status: 'queued' });
    // 首轮 tick 返回进行中：真实轮询建卡与成功扇出相隔数秒、分属两轮提交——拆开批次
    // 才能让占位卡先进级联清理登记，「占位卡来源边随移除被清理」按既有机制真实发生
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j701', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await sendVocal();
    expect(nodeById('vocal-split-j701')).toBeTruthy();
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j701', status: 'succeeded', progress: 100, asset: null, tracks: twoTracksOf('j701'),
    });
    await terminalTick();

    // 占位卡移除，无残留
    expect(nodeById('vocal-split-j701')).toBeUndefined();
    // 两张轨卡：普通音频成品卡形态（src/assetId/duration 回填，无 genStatus——水合不再为其开轮询）
    const voice = nodeById('vocal-track-j701-voice')!;
    const bg = nodeById('vocal-track-j701-background')!;
    expect(voice.data.fileName).toBe('素材视频(人声).aac');
    expect(bg.data.fileName).toBe('素材视频(背景音).aac');
    for (const card of [voice, bg]) {
      expect(card.data.mediaType).toBe('audio');
      expect(card.data.genStatus).toBeUndefined();
      expect(card.data.progress).toBe(100);
      expect(card.data.jobId).toBeUndefined();
    }
    expect(voice.data.src).toBe('http://tos/j701-voice.aac');
    expect(voice.data.assetId).toBe('t-j701-voice');
    expect(voice.data.duration).toBe(15.5);
    // 轨序：voice 首轨在上，纵向步长 = 内容区高 240 + 间距 60；横向顶替占位卡列位（958）
    expect(voice.position).toEqual({ x: 958, y: 0 });
    expect(bg.position).toEqual({ x: 958, y: 300 });
    // 各拉来源边（origin=vocal-split，参考推导跳过）
    const trackEdges = edges().filter((e) => e.target.startsWith('vocal-track-'));
    expect(trackEdges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'v1->vocal-track-j701-voice',
      'v1->vocal-track-j701-background',
    ]);
    for (const edge of trackEdges) expect(edge.data).toEqual({ origin: VOCAL_SPLIT_EDGE_ORIGIN });
    // 占位卡旧来源边随占位卡移除级联清理
    expect(edges().some((e) => e.target === 'vocal-split-j701')).toBe(false);
    // 扇出立刻落库：占位移除 + 轨卡 + 来源边同一次 PUT
    const saved = fanoutSaveCall()!;
    expect(saved.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['v1', 'vocal-track-j701-voice', 'vocal-track-j701-background']),
    );
    expect(saved.nodes.some((n) => n.id === 'vocal-split-j701')).toBe(false);
    expect(saved.edges.some((e) => e.target === 'vocal-track-j701-voice')).toBe(true);
    expect(saved.edges.some((e) => e.target === 'vocal-track-j701-background')).toBe(true);
  }, 20000);

  it('三轨场景（短剧/flac）：扇出 人声/音乐/音效 三张，命名括号词随轨类型、后缀随格式', async () => {
    apiMocks.createVocalSplit.mockResolvedValue({ job_id: 'j702', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j702', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await click('vocal-split-scene-trigger');
    await click('vocal-split-scene-item-drama');
    await click('vocal-split-format-trigger');
    await click('vocal-split-format-item-flac');
    await sendVocal();
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j702',
      status: 'succeeded',
      progress: 100,
      asset: null,
      tracks: [
        { track_type: 'voice', asset_id: 't-j702-voice', url: 'http://tos/j702-voice.flac', duration: 8 },
        { track_type: 'music', asset_id: 't-j702-music', url: 'http://tos/j702-music.flac', duration: 8 },
        { track_type: 'sfx', asset_id: 't-j702-sfx', url: 'http://tos/j702-sfx.flac', duration: null },
      ],
    });
    await terminalTick();

    expect(nodeById('vocal-split-j702')).toBeUndefined();
    const voice = nodeById('vocal-track-j702-voice')!;
    const music = nodeById('vocal-track-j702-music')!;
    const sfx = nodeById('vocal-track-j702-sfx')!;
    expect(voice.data.fileName).toBe('素材视频(人声).flac');
    expect(music.data.fileName).toBe('素材视频(音乐).flac');
    expect(sfx.data.fileName).toBe('素材视频(音效).flac');
    // 三轨纵向排布；duration 为 null 的轨不写时长字段（浏览器实测兜底）
    expect(voice.position).toEqual({ x: 958, y: 0 });
    expect(music.position).toEqual({ x: 958, y: 300 });
    expect(sfx.position).toEqual({ x: 958, y: 600 });
    expect('duration' in sfx.data).toBe(false);
    expect(music.data.src).toBe('http://tos/j702-music.flac');
    // 三条来源边
    expect(edges().filter((e) => e.target.startsWith('vocal-track-j702-')).length).toBe(3);
  }, 20000);

  it('成功但无 tracks（契约上线前完成的旧任务）：占位卡保留停生成中，不扇出不丢卡', async () => {
    apiMocks.createVocalSplit.mockResolvedValue({ job_id: 'j703', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j703', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await sendVocal();
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j703', status: 'succeeded', progress: 100, asset: null });
    await terminalTick();
    const stale = nodeById('vocal-split-j703')!;
    expect(stale).toBeTruthy();
    expect(stale.data.genStatus).toBeUndefined();
    expect(stale.data.progress).toBe(100);
    expect(nodeById('vocal-track-j703-voice')).toBeUndefined();
    expect(edges().some((e) => e.target.startsWith('vocal-track-'))).toBe(false);
  }, 20000);
});

describe('IKHA30 刷新恢复三态', () => {
  it('生成中：水合续轮询（占位卡保留在生成中，任务状态继续推进）', async () => {
    seedDocWithPlaceholder('j704');
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j704', status: 'processing', progress: 40, asset: null });
    await renderPage();
    await settle();
    const placeholder = nodeById('vocal-split-j704')!;
    expect(placeholder).toBeTruthy();
    expect(placeholder.data.genStatus).toBe('generating');
    expect(placeholder.data.progress).toBe(40);
    expect(nodeById('vocal-track-j704-voice')).toBeUndefined();
    // 水合恢复轮询确实发生
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j704');
  });

  it('已完成：水合首 tick 成功即直接扇出轨卡，无占位残留', async () => {
    seedDocWithPlaceholder('j705');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j705', status: 'succeeded', progress: 100, asset: null, tracks: twoTracksOf('j705'),
    });
    await renderPage();
    await settle();
    // 直接呈现轨卡，无占位残留
    expect(nodeById('vocal-split-j705')).toBeUndefined();
    const voice = nodeById('vocal-track-j705-voice')!;
    expect(voice.data.fileName).toBe('素材视频(人声).aac');
    expect(voice.data.mediaType).toBe('audio');
    expect(nodeById('vocal-track-j705-background')).toBeTruthy();
    expect(edges().filter((e) => e.target.startsWith('vocal-track-j705-')).length).toBe(2);
  });

  it('已完成恢复幂等（关页重开重复水合）：轨卡 id 确定性，两次水合扇出同一组 id 各一张', async () => {
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j706', status: 'succeeded', progress: 100, asset: null, tracks: twoTracksOf('j706'),
    });
    seedDocWithPlaceholder('j706');
    await renderPage();
    await settle();
    expect(nodeById('vocal-track-j706-voice')).toBeTruthy();
    expect(nodeById('vocal-split-j706')).toBeUndefined();
    const firstVoicePosition = nodeById('vocal-track-j706-voice')!.position;

    // 关页重开（新页面实例，内存收敛登记清零），服务端快照仍是含占位卡的旧 doc——
    // 确定性 id（vocal-track-{jobId}-{track}）让重复扇出落回同一组卡，不产生第二套
    await act(async () => {
      root.unmount();
    });
    container.remove();
    seedDocWithPlaceholder('j706');
    await renderPage();
    await settle();

    const secondVoice = nodeById('vocal-track-j706-voice')!;
    expect(secondVoice).toBeTruthy();
    expect(secondVoice.position).toEqual(firstVoicePosition);
    const voiceCards = (flowProps.current.mediaNodes as Node[]).filter((n) => n.id === 'vocal-track-j706-voice');
    expect(voiceCards.length).toBe(1);
    expect(nodeById('vocal-track-j706-background')).toBeTruthy();
    expect(nodeById('vocal-split-j706')).toBeUndefined();
    expect(edges().filter((e) => e.target === 'vocal-track-j706-voice').length).toBe(1);
  }, 20000);
});
