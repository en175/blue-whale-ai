/* ============================================
 * 视频处理任务家族契约测试（IKJJR3）：七类身份识别（排除其它家族）、冻结输入
 * （lastInput / lastParams / frozenParams，缺输入 null 阻止）、创建协议（各自端点 +
 * canvas_binding 进 body + Idempotency-Key = submission_id；抠像 client_token = submission_id）、
 * 冻结输入重试、通用取消、恢复落卡规划（补卡 + 来源线 + 续轮询收敛）。
 * ============================================ */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createVideoSubtitleErase: vi.fn(async () => ({ job_id: 'j-sub', status: 'queued' })),
  createMediaExtraction: vi.fn(async () => ({ job_id: 'j-ext', status: 'queued' })),
  createAudioTrim: vi.fn(async () => ({ job_id: 'j-trim', status: 'queued' })),
  createAudioSpeed: vi.fn(async () => ({ job_id: 'j-speed', status: 'queued' })),
  createVideoMatting: vi.fn(async () => ({ job_id: 'j-mat', status: 'queued' })),
  createVideoEnhancement: vi.fn(async () => ({ job_id: 'j-hd', status: 'queued' })),
  createFrameInterpolation: vi.fn(async () => ({ job_id: 'j-frame', status: 'queued' })),
  cancelGenerationJob: vi.fn(async () => null),
  readJobFailText: vi.fn(() => ''),
}));

vi.mock('@/api/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/jobs')>();
  return {
    ...actual,
    createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
    createMediaExtraction: apiMocks.createMediaExtraction,
    createAudioTrim: apiMocks.createAudioTrim,
    createAudioSpeed: apiMocks.createAudioSpeed,
    createVideoMatting: apiMocks.createVideoMatting,
    createVideoEnhancement: apiMocks.createVideoEnhancement,
    createFrameInterpolation: apiMocks.createFrameInterpolation,
    cancelGenerationJob: apiMocks.cancelGenerationJob,
    readJobFailText: apiMocks.readJobFailText,
  };
});

import {
  videoToolsTask, videoToolSpecOf, videoToolFrozenPayload, buildVideoToolRecoveryNode,
} from './videoTools';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

const BINDING = {
  protocol_version: 1 as const,
  submission_id: '11111111-1111-4111-8111-111111111111',
  target_node_id: 'n1',
  expected_binding_revision: 2,
  recovery_seed: {
    target: { role: 'result-placeholder' as const, x: 1, y: 2, width: 320, height: 320, name: '卡' },
    sources: [],
  },
};

describe('视频处理家族：身份识别', () => {
  it('七类身份键 → 本家族', () => {
    for (const key of ['videoSubtitleErase', 'mediaExtract', 'audioTrim', 'audioSpeed', 'smartMatting', 'videoEnhance', 'frameInterpolation']) {
      expect(videoToolsTask.identify('n1', { jobId: 'j1', [key]: {} })).toBe(true);
    }
  });

  it('分离/截取/调速的节点 id 前缀 → 本家族（历史卡无身份标记兜底）', () => {
    expect(videoToolsTask.identify('media-extract-9', { jobId: '9' })).toBe(true);
    expect(videoToolsTask.identify('audio-trim-9', { jobId: '9' })).toBe(true);
    expect(videoToolsTask.identify('audio-speed-9', { jobId: '9' })).toBe(true);
  });

  it('其它家族与普通卡 → 不归本家族（claims 分派不误接）', () => {
    for (const key of ['imageEnhance', 'imageErase', 'imageCutout', 'imageOutpaint', 'vocalSplit', 'sceneSplit', 'audioVideoMux']) {
      expect(videoToolsTask.identify('n1', { jobId: 'j1', [key]: { last: true } })).toBe(false);
    }
    expect(videoToolsTask.identify('n1', { jobId: 'j1' })).toBe(false);
    expect(videoToolsTask.identify('audio-mix-9', { jobId: '9' })).toBe(false);
    expect(videoToolsTask.identify('vocal-split-9', { jobId: '9' })).toBe(false);
  });

  it('taskTypes 覆盖七值（恢复记录分派键）', () => {
    expect(videoToolsTask.taskTypes).toEqual([
      'video_subtitle_erase', 'media_extract', 'audio_trim', 'audio_speed',
      'video_matting', 'video_enhance', 'video_frame_interpolation',
    ]);
  });
});

describe('视频处理家族：冻结输入（失败卡重试原样重发的权威来源）', () => {
  it('lastInput 家族：identity.lastInput 原样返回', () => {
    const lastInput = { source_asset_id: '5', output_format: 'wav' };
    expect(videoToolFrozenPayload('media-extract-x', { mediaExtract: { sourceAssetId: '5', lastInput } }))
      .toEqual({ kind: 'mediaExtract', input: lastInput });
    const trimInput = { source_asset_id: '5', start_time: 1.2, end_time: 8.4, output_format: 'wav' };
    expect(videoToolFrozenPayload('n1', { audioTrim: { sourceAssetId: '5', lastInput: trimInput } }))
      .toEqual({ kind: 'audioTrim', input: trimInput });
  });

  it('HD：lastParams 分辨率 + 身份 sourceAssetId 组契约三键（target_node_id = 本卡）', () => {
    expect(videoToolFrozenPayload('hd1', { videoEnhance: { sourceAssetId: '7', lastParams: { resolution: '2k' } } }))
      .toEqual({ kind: 'videoEnhance', input: { source_asset_id: '7', target_node_id: 'hd1', resolution: '2k' } });
    // lastParams 缺失回落契约默认档 1080p（面板值可恢复）
    expect(videoToolFrozenPayload('hd1', { videoEnhance: { sourceAssetId: '7' } }))
      .toEqual({ kind: 'videoEnhance', input: { source_asset_id: '7', target_node_id: 'hd1', resolution: '1080p' } });
  });

  it('插帧：受理冻结 frozenParams 优先于面板编辑 lastParams（IKHSFH：60 任务失败后面板改 120，重试仍发 60）', () => {
    expect(videoToolFrozenPayload('fr1', {
      frameInterpolation: { sourceAssetId: '7', lastParams: { fps: 120 }, frozenParams: { fps: 60 } },
    })).toEqual({ kind: 'frameInterpolation', input: { source_asset_id: '7', target_node_id: 'fr1', fps: 60 } });
    // 旧持久化卡无 frozenParams → 回落 lastParams 尽力兼容
    expect(videoToolFrozenPayload('fr1', {
      frameInterpolation: { sourceAssetId: '7', lastParams: { fps: 120 } },
    })).toEqual({ kind: 'frameInterpolation', input: { source_asset_id: '7', target_node_id: 'fr1', fps: 120 } });
  });

  it('身份缺失/字段不可信 → null（运行时保留失败卡并提示重新编辑，A.6 不猜参数）', () => {
    expect(videoToolFrozenPayload('n1', {})).toBeNull();
    expect(videoToolFrozenPayload('media-extract-9', { jobId: '9' })).toBeNull(); // 前缀家族但无身份
    expect(videoToolFrozenPayload('n1', { mediaExtract: { sourceAssetId: '5' } })).toBeNull(); // 无 lastInput
    expect(videoToolFrozenPayload('hd1', { videoEnhance: {} })).toBeNull(); // 无 sourceAssetId
  });
});

describe('视频处理家族：创建/重试/取消协议', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('创建：各自端点 + canvas_binding 进 body + Idempotency-Key 头承载 submission_id（十入口口径）', async () => {
    const view = { protocol_version: 1, submission_id: BINDING.submission_id, target_node_id: 'n1', binding_revision: 3, job_id: 'j-hd', is_current: true };
    apiMocks.createVideoEnhancement.mockResolvedValueOnce({ job_id: 'j-hd', status: 'queued', canvas_binding: view } as never);
    const outcome = await videoToolsTask.create('p1', { payload: { kind: 'videoEnhance', input: { source_asset_id: '7', target_node_id: 'n1', resolution: '2k' } } }, BINDING, 'key-hd');
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledWith(
      'p1',
      { source_asset_id: '7', target_node_id: 'n1', resolution: '2k' },
      { silent: true, canvasBinding: BINDING, idempotencyKey: 'key-hd' },
    );
    expect(outcome).toEqual({ jobId: 'j-hd', canvasBinding: view });
  });

  it('创建（抠像）：幂等承载为 body client_token = submission_id（无 Idempotency-Key 头）', async () => {
    const mattingInput = { source_asset_id: '7', target_node_id: 'n1', mode: 'portrait', format: 'WEBM' } as const;
    await videoToolsTask.create('p1', { payload: { kind: 'smartMatting', input: mattingInput } }, BINDING, 'key-mat');
    expect(apiMocks.createVideoMatting).toHaveBeenCalledWith(
      'p1',
      { ...mattingInput, client_token: 'key-mat' },
      { silent: true, canvasBinding: BINDING }, // 无 idempotencyKey
    );
  });

  it('创建（其余五类）：分派到各自端点并透传 binding/key', async () => {
    await videoToolsTask.create('p1', { payload: { kind: 'subtitleErase', input: { source_asset_id: '7', target_node_id: 'n1', detect_mode: 'subtitle_smart', erase_boxes: [] } } }, BINDING, 'k1');
    expect(apiMocks.createVideoSubtitleErase).toHaveBeenCalled();
    await videoToolsTask.create('p1', { payload: { kind: 'mediaExtract', input: { source_asset_id: '7', output_format: 'wav' } } }, BINDING, 'k2');
    expect(apiMocks.createMediaExtraction).toHaveBeenCalled();
    await videoToolsTask.create('p1', { payload: { kind: 'audioTrim', input: { source_asset_id: '7', output_format: 'wav' } } }, BINDING, 'k3');
    expect(apiMocks.createAudioTrim).toHaveBeenCalled();
    await videoToolsTask.create('p1', { payload: { kind: 'audioSpeed', input: { source_asset_id: '7', speed: 1.35 } } }, BINDING, 'k4');
    expect(apiMocks.createAudioSpeed).toHaveBeenCalled();
    await videoToolsTask.create('p1', { payload: { kind: 'frameInterpolation', input: { source_asset_id: '7', target_node_id: 'n1', fps: 60 } } }, BINDING, 'k5');
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalled();
  });

  it('重试：冻结输入原样重发创建端点（新 submission_id 独立提交身份）', async () => {
    const trimInput = { source_asset_id: '5', start_time: 1.2, end_time: 8.4, output_format: 'wav' };
    await videoToolsTask.retry!('p1', 'j-old', {
      nodeId: 'audio-trim-x',
      nodeData: { audioTrim: { sourceAssetId: '5', lastInput: trimInput } },
    }, BINDING, 'key-retry');
    expect(apiMocks.createAudioTrim).toHaveBeenCalledWith(
      'p1', trimInput, { silent: true, canvasBinding: BINDING, idempotencyKey: 'key-retry' },
    );
  });

  it('取消：走 generation-jobs 通用 cancel 端点', async () => {
    await videoToolsTask.cancel!('p1', 'j9');
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j9');
  });
});

describe('视频处理家族：恢复落卡规划（受理回执丢失补卡 + 续轮询收敛）', () => {
  const hostOf = (nodes: RuntimeNodeView[] = []): GenerationRuntimeHost & { inserted: RuntimeNodeView[]; edges: Array<{ source: string; target: string; marker?: unknown }> } => {
    const inserted: RuntimeNodeView[] = [];
    const edges: Array<{ source: string; target: string; marker?: unknown }> = [];
    return {
      getProjectId: () => 'p1',
      getLoadEpoch: () => ({}),
      getMediaNodes: () => nodes,
      findNode: (id: string) => nodes.find((n) => n.id === id) ?? null,
      patchNode: () => {},
      insertMediaNode: (node: RuntimeNodeView) => { inserted.push(node); nodes.push(node); },
      removeMediaNode: () => {},
      getEdges: () => [],
      addEdge: (source: string, target: string, _role: unknown, marker?: Record<string, unknown>) => { edges.push({ source, target, marker }); },
      getActiveJob: () => undefined,
      setActiveJob: () => {},
      clearActiveJob: () => {},
      isLocallyRemoved: () => false,
      markLocallyRemoved: () => {},
      registerPendingDelete: () => {},
      isPendingDelete: () => false,
      applyTerminal: () => 'terminal',
      settleCancelled: () => {},
      saveCanvas: async () => true,
      toast: () => {},
      openRechargeForCreditsError: () => false,
      addAuthResume: () => {},
      rememberAsset: () => {},
      inserted, edges,
    };
  };

  const recordOf = (over: Partial<GenerationRecoveryRecord>): GenerationRecoveryRecord => ({
    submission_id: 'sub-1',
    target_node_id: 'media-extract-uuid1',
    job_id: 'j1',
    task_type: 'media_extract',
    binding_revision: 1,
    is_current: true,
    job: { job_id: 'j1', type: 'media_extract', status: 'processing', progress: 40, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: {
      target: { role: 'result-placeholder', x: 11, y: 22, width: 280, height: 320, name: '测试视频(audio).wav' },
      sources: [{ node_id: 'src1', x: 0, y: 0, width: 498, height: 320, name: '源视频' }],
    },
    previous_target_snapshot: null,
    items: [],
    ...over,
  });

  it('进行中且卡缺：按恢复种子补卡 + 来源线（origin = 家族标记），返回续轮询', () => {
    const host = hostOf([{ id: 'src1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} }]);
    const plan = videoToolsTask.planRecovery!(recordOf({}), host);
    expect(plan).toEqual({ kind: 'resume-polling' });
    expect(host.inserted).toHaveLength(1);
    const node = host.inserted[0];
    expect(node.id).toBe('media-extract-uuid1');
    expect(node.data).toMatchObject({ genStatus: 'generating', jobId: 'j1', mediaType: 'audio', fileName: '测试视频(audio).wav', mediaExtract: {} });
    expect(node.position).toEqual({ x: 11, y: 22 });
    expect(host.edges).toEqual([{ source: 'src1', target: 'media-extract-uuid1', marker: { origin: 'media-extract' } }]);
  });

  it('卡已在：不重复建卡，直接续轮询', () => {
    const host = hostOf([
      { id: 'src1', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} },
      { id: 'media-extract-uuid1', type: 'mediaNode', position: { x: 11, y: 22 }, data: { jobId: 'j1', genStatus: 'generating' } },
    ]);
    expect(videoToolsTask.planRecovery!(recordOf({}), host)).toEqual({ kind: 'resume-polling' });
    expect(host.inserted).toHaveLength(0);
  });

  it('已成功且 primary 已应用 → 无画布动作（不重复收敛成品卡）', () => {
    const host = hostOf([
      { id: 'media-extract-uuid1', type: 'mediaNode', position: { x: 11, y: 22 }, data: { jobId: 'j1', src: 'https://a/1.wav' } },
    ]);
    const record = recordOf({
      job: { job_id: 'j1', type: 'media_extract', status: 'succeeded', progress: 100, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: 'gcr:sub-1:$target', output_key: '$target', node_id: 'media-extract-uuid1', state: 'replaced', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
        { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'media-extract-uuid1', state: 'present', revision: 1, node_binding_revision: 1, asset_id: '88', slot_id: null },
      ],
    });
    expect(videoToolsTask.planRecovery!(record, host)).toEqual({ kind: 'none' });
  });

  it('已成功且 primary 未应用（完成未落卡）→ 补卡后续轮询收敛', () => {
    const host = hostOf();
    const record = recordOf({
      job: { job_id: 'j1', type: 'media_extract', status: 'succeeded', progress: 100, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [
        { recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'media-extract-uuid1', state: 'pending', revision: 0, node_binding_revision: 0, asset_id: null, slot_id: null },
      ],
    });
    expect(videoToolsTask.planRecovery!(record, host)).toEqual({ kind: 'resume-polling' });
    expect(host.inserted).toHaveLength(1);
  });

  it('已失败且卡缺 → 补失败卡（errorText + 失败态，身份占位冻结输入缺失阻止重试）', () => {
    const node = buildVideoToolRecoveryNode(recordOf({
      job: { job_id: 'j1', type: 'media_extract', status: 'failed', progress: 0, output_asset_ids: null, stored_error: { code: 'media_extract_failed', msg: '' }, created_at: '2026-10-01T00:00:00Z' },
    }), videoToolSpecOf('media-extract-uuid1', {})!);
    expect(node.data).toMatchObject({ genStatus: 'failed', jobId: 'j1', mediaExtract: {} });
    expect(typeof node.data.errorText).toBe('string');
  });

  it('已取消 → 不猜卡（无画布动作）', () => {
    const host = hostOf();
    const record = recordOf({
      job: { job_id: 'j1', type: 'media_extract', status: 'cancelled', progress: 0, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    });
    expect(videoToolsTask.planRecovery!(record, host)).toEqual({ kind: 'none' });
    expect(host.inserted).toHaveLength(0);
  });
});
