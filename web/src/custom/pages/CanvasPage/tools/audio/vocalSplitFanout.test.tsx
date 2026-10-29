// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { VOCAL_SPLIT_EDGE_ORIGIN, isVocalSplitNodeId } from './vocalSplit';
import type { GenerationModel } from '@/custom/api/generation';
import type { GenerationRecoveryPage } from '@/custom/api/canvasRecovery';

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('../../components/AgentPanel/index', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../../components/Canvas/index', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../../components/CanvasToolbar/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));
vi.mock('../../components/CanvasHeader/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));
vi.mock('../../components/ProjectSelector/index', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));
vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

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

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/custom/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/custom/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  createConversationQuote: vi.fn(),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));

vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createVocalSplit: apiMocks.createVocalSplit,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const recoveryMocks = vi.hoisted(() => ({
  fetchGenerationRecoveryPage: vi.fn(async (): Promise<GenerationRecoveryPage> => ({
    protocol_version: 1, canvas_version: null, records: [], next_cursor: null,
  })),
  resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1 as const, records: [] })),
  putCanvasDocWithRecovery: vi.fn(async (
    _projectId: string,
    _payload: { nodes: Array<{ id: string }> },
    _version: unknown,
    recovery: { commandId: string; recoveryChanges: Array<{ recoveryItemId: string; action: string; expectedRevision: number }> },
  ) => ({
    project_id: 'p1', version: 5,
    recoveryReceipt: {
      commandId: recovery.commandId, replayed: false,
      changes: recovery.recoveryChanges.map((change) => ({
        recoveryItemId: change.recoveryItemId,
        revision: change.expectedRevision + 1,
        nodeBindingRevision: 1,
        state: change.action === 'replaceTarget' ? 'replaced' as const : 'present' as const,
      })),
    },
  })),
}));
vi.mock('@/custom/api/canvasRecovery', () => ({
  fetchGenerationRecoveryPage: recoveryMocks.fetchGenerationRecoveryPage,
  resolveGenerationRecovery: recoveryMocks.resolveGenerationRecovery,
  putCanvasDocWithRecovery: recoveryMocks.putCanvasDocWithRecovery,
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  })),
}));

const VOCAL_SUBMISSION = 'vocal-sub-1';
const bindingView = (jobId: string, targetNodeId: string) => ({
  protocol_version: 1,
  submission_id: VOCAL_SUBMISSION,
  target_node_id: targetNodeId,
  binding_revision: 1,
  job_id: jobId,
  is_current: true,
});

function projectionPage(
  jobId: string,
  tracks: ReadonlyArray<{ track_type: string; asset_id: string }>,
): GenerationRecoveryPage {
  return {
    protocol_version: 1, canvas_version: null, next_cursor: null,
    records: [{
      submission_id: VOCAL_SUBMISSION, target_node_id: 'vocal-split-ph', job_id: jobId, task_type: 'vocal_split',
      binding_revision: 1, is_current: true, job: null, recovery_seed: null, previous_target_snapshot: null,
      items: [
        { recovery_item_id: `gcr:${VOCAL_SUBMISSION}:$target`, output_key: '$target', node_id: 'vocal-split-ph', state: 'pending' as const, revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        ...tracks.map((track) => ({
          recovery_item_id: `gcr:${VOCAL_SUBMISSION}:track:${track.track_type}`,
          output_key: `track:${track.track_type}`,
          node_id: `generation-result:${VOCAL_SUBMISSION}:track:${track.track_type}`,
          state: 'pending' as const, revision: 0, node_binding_revision: 0,
          asset_id: track.asset_id, slot_id: null,
        })),
      ],
    }],
  };
}

function mockCreateAccepted(jobId: string) {
  apiMocks.createVocalSplit.mockImplementation(async (_projectId: string, payload: { canvas_binding?: { target_node_id?: string } }) => ({
    job_id: jobId, status: 'queued',
    canvas_binding: bindingView(jobId, payload.canvas_binding?.target_node_id ?? 'vocal-split-ph'),
  }));
}

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

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

function pushTrackAssets(jobId: string) {
  const assets = canvasDocMock.current.assets as Record<string, unknown>;
  assets[`t-${jobId}-voice`] = { asset_id: `t-${jobId}-voice`, type: 'audio', access_url: `http://tos/${jobId}-voice.aac` };
  assets[`t-${jobId}-bg`] = { asset_id: `t-${jobId}-bg`, type: 'audio', access_url: `http://tos/${jobId}-bg.aac` };
}

function seedDocWithPlaceholder(jobId: string, outputFormat = 'aac') {
  seedDoc();
  pushTrackAssets(jobId);
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id: `vocal-split-${jobId}`,
    type: 'mediaNode',
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

async function sendVocal() {
  await click('vocal-split-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

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

type SavePayload = { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string; data?: Record<string, unknown> }> };
function fanoutSaveCall(): SavePayload | undefined {
  return (recoveryMocks.putCanvasDocWithRecovery.mock.calls as unknown as Array<[string, SavePayload, unknown, unknown]>)
    .map((call) => call[1])
    .find((payload) => payload.nodes.some((n) => n.id.startsWith('generation-result:')));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createVocalSplit.mockReset();
  apiMocks.createMediaExtraction.mockReset();
  recoveryMocks.fetchGenerationRecoveryPage.mockReset();
  recoveryMocks.fetchGenerationRecoveryPage.mockResolvedValue({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null });
  recoveryMocks.putCanvasDocWithRecovery.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHA30 成功扇出（发送→成功终态）', () => {
  it('两轨场景（通用/aac）：移除占位卡，按投影规范 node_id 扇出 源名(人声|背景音).aac 两张，各拉来源边，一笔原子保存', async () => {
    mockCreateAccepted('j701');
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j701', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await sendVocal();
    expect((flowProps.current.mediaNodes as Node[]).some((n) => isVocalSplitNodeId(n.id) && n.id !== 'v1')).toBe(true);
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j701', status: 'succeeded', progress: 100, asset: null, tracks: twoTracksOf('j701'),
      output_assets: twoTracksOf('j701').map((track) => ({
        id: track.asset_id, url: track.url, type: 'audio' as const, duration: track.duration,
      })),
    });
    recoveryMocks.fetchGenerationRecoveryPage.mockResolvedValue(projectionPage('j701', [
      { track_type: 'voice', asset_id: 't-j701-voice' },
      { track_type: 'background', asset_id: 't-j701-bg' },
    ]));
    await terminalTick();
    expect((flowProps.current.mediaNodes as Node[]).some((n) => isVocalSplitNodeId(n.id) && n.id !== 'v1')).toBe(false);
    const voice = nodeById(`generation-result:${VOCAL_SUBMISSION}:track:voice`)!;
    const bg = nodeById(`generation-result:${VOCAL_SUBMISSION}:track:background`)!;
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
    expect(voice.data.generationRecovery).toEqual({ protocolVersion: 1, submissionId: VOCAL_SUBMISSION, outputKey: 'track:voice' });
    expect(voice.position).toEqual({ x: 958, y: 0 });
    expect(bg.position).toEqual({ x: 958, y: 300 });
    const trackEdges = edges().filter((e) => e.target.startsWith('generation-result:'));
    expect(trackEdges.map((e) => `${e.source}->${e.target}`)).toEqual([
      `v1->generation-result:${VOCAL_SUBMISSION}:track:voice`,
      `v1->generation-result:${VOCAL_SUBMISSION}:track:background`,
    ]);
    for (const edge of trackEdges) expect(edge.data).toEqual({ origin: VOCAL_SPLIT_EDGE_ORIGIN });
    expect(edges().some((e) => e.target === 'vocal-split-j701')).toBe(false);
    const saved = fanoutSaveCall()!;
    expect(saved.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([`generation-result:${VOCAL_SUBMISSION}:track:voice`, `generation-result:${VOCAL_SUBMISSION}:track:background`]),
    );
    expect(saved.edges.some((e) => e.target === `generation-result:${VOCAL_SUBMISSION}:track:voice`)).toBe(true);
    expect(saved.edges.some((e) => e.target === `generation-result:${VOCAL_SUBMISSION}:track:background`)).toBe(true);
    const saveCall = (recoveryMocks.putCanvasDocWithRecovery.mock.calls as unknown as Array<[string, unknown, unknown, { recoveryChanges: Array<{ recoveryItemId: string; action: string }> }]>)
      .find(([ , payload ]) => (payload as { nodes: Array<{ id: string }> }).nodes.some((n) => n.id.startsWith('generation-result:')))!;
    const actions = saveCall[3].recoveryChanges.map((change) => `${change.action}:${change.recoveryItemId}`).sort();
    expect(actions).toEqual([
      `apply:gcr:${VOCAL_SUBMISSION}:track:background`,
      `apply:gcr:${VOCAL_SUBMISSION}:track:voice`,
      `replaceTarget:gcr:${VOCAL_SUBMISSION}:$target`,
    ]);
  }, 20000);

  it('三轨场景（短剧/flac）：扇出 人声/音乐/音效 三张，命名括号词随轨类型、后缀随格式', async () => {
    mockCreateAccepted('j702');
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
      output_assets: [
        { id: 't-j702-voice', url: 'http://tos/j702-voice.flac', type: 'audio' as const, duration: 8 },
        { id: 't-j702-music', url: 'http://tos/j702-music.flac', type: 'audio' as const, duration: 8 },
        { id: 't-j702-sfx', url: 'http://tos/j702-sfx.flac', type: 'audio' as const, duration: null },
      ],
    });
    recoveryMocks.fetchGenerationRecoveryPage.mockResolvedValue(projectionPage('j702', [
      { track_type: 'voice', asset_id: 't-j702-voice' },
      { track_type: 'music', asset_id: 't-j702-music' },
      { track_type: 'sfx', asset_id: 't-j702-sfx' },
    ]));
    await terminalTick();

    expect((flowProps.current.mediaNodes as Node[]).some((n) => isVocalSplitNodeId(n.id) && n.id !== 'v1')).toBe(false);
    const voice = nodeById(`generation-result:${VOCAL_SUBMISSION}:track:voice`)!;
    const music = nodeById(`generation-result:${VOCAL_SUBMISSION}:track:music`)!;
    const sfx = nodeById(`generation-result:${VOCAL_SUBMISSION}:track:sfx`)!;
    expect(voice.data.fileName).toBe('素材视频(人声).flac');
    expect(music.data.fileName).toBe('素材视频(音乐).flac');
    expect(sfx.data.fileName).toBe('素材视频(音效).flac');
    expect(voice.position).toEqual({ x: 958, y: 0 });
    expect(music.position).toEqual({ x: 958, y: 300 });
    expect(sfx.position).toEqual({ x: 958, y: 600 });
    expect('duration' in sfx.data).toBe(false);
    expect(music.data.src).toBe('http://tos/j702-music.flac');
    expect(edges().filter((e) => e.target.startsWith('generation-result:')).length).toBe(3);
  }, 20000);

  it('成功但投影缺失（契约上线前完成的旧任务/服务端歧义拒绝）：占位卡保留停成功态，不扇出不丢卡', async () => {
    mockCreateAccepted('j703');
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j703', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await sendVocal();
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j703', status: 'succeeded', progress: 100, asset: null });
    await terminalTick();
    const stale = (flowProps.current.mediaNodes as Node[]).find((n) => isVocalSplitNodeId(n.id) && n.id !== 'v1')!;
    expect(stale).toBeTruthy();
    expect(stale.data.genStatus).toBeUndefined();
    expect(stale.data.progress).toBe(100);
    expect((flowProps.current.mediaNodes as Node[]).some((n) => n.id.startsWith('generation-result:'))).toBe(false);
    expect(edges().some((e) => e.target.startsWith('generation-result:'))).toBe(false);
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
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j704');
  });

  it('已完成：水合首 tick 成功即直接扇出轨卡，无占位残留', async () => {
    seedDocWithPlaceholder('j705');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j705', status: 'succeeded', progress: 100, asset: null, tracks: twoTracksOf('j705'),
    });
    await renderPage();
    await settle();
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
