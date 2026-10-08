/* IKJQ05：受理回执未保存时，真实任务与序列化占位经公开 recover/retry 接续可靠失败记录。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { canvasBindingSchema } from '@lib/contracts/canvas-recovery';
import { videoEnhanceInputSchema } from '@lib/contracts/video-enhance';
import { videoSubtitleEraseInputSchema } from '@lib/contracts/video-subtitle-erase';
import { mediaExtractInputSchema } from '@lib/contracts/media-extract';
import { audioTrimInputSchema } from '@lib/contracts/audio-trim';
import { audioSpeedInputSchema } from '@lib/contracts/audio-speed';
import { videoMattingInputSchema } from '@lib/contracts/video-matting';
import { videoFrameInterpolationInputSchema } from '@lib/contracts/video-frame-interpolation';
import { serializeNodes } from '@/api/canvas';
import { readJobFailText, type CreateJobPayload, type JobDetail } from '@/api/jobs';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { videoEnhanceErrorText } from '../videoEnhance';
import { createGenerationRuntime } from './runtime';
import { normalGenerationTask } from './normalGeneration';
import { videoToolsTask, type VideoToolPayload } from './videoTools';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';
import { silenceApiConsoleInfo } from '../testing/silenceApiLogs';

silenceApiConsoleInfo();

const SID = '12345678-0000-4000-8000-000000000001';
const RETRY_SID = '12345678-0000-4000-8000-000000000002';
const NODE_ID = 'target-1';
const SOURCE_ID = 'source-1';
const ERROR = { code: 1045, msg: '供应商超时' };
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

const VIDEO_CASES: Array<{
  taskType: string; identityKey: string; route: string; mediaType: 'video' | 'audio';
  payload: VideoToolPayload; identity: Record<string, unknown>; schema: { parse(input: unknown): unknown };
}> = [
  { taskType: 'video_subtitle_erase', identityKey: 'videoSubtitleErase', route: 'video-subtitle-erasures', mediaType: 'video',
    payload: { kind: 'subtitleErase', input: { source_asset_id: '11', target_node_id: NODE_ID, detect_mode: 'subtitle_smart', erase_boxes: [] } },
    identity: { lastInput: { source_asset_id: '11', target_node_id: NODE_ID, detect_mode: 'subtitle_smart', erase_boxes: [] } }, schema: videoSubtitleEraseInputSchema },
  { taskType: 'media_extract', identityKey: 'mediaExtract', route: 'media-extractions', mediaType: 'audio',
    payload: { kind: 'mediaExtract', input: { source_asset_id: '11', output_format: 'wav' } },
    identity: { lastInput: { source_asset_id: '11', output_format: 'wav' } }, schema: mediaExtractInputSchema },
  { taskType: 'audio_trim', identityKey: 'audioTrim', route: 'audio-trims', mediaType: 'audio',
    payload: { kind: 'audioTrim', input: { source_asset_id: '11', output_format: 'wav', start_time: 1, end_time: 4 } },
    identity: { lastInput: { source_asset_id: '11', output_format: 'wav', start_time: 1, end_time: 4 } }, schema: audioTrimInputSchema },
  { taskType: 'audio_speed', identityKey: 'audioSpeed', route: 'audio-speeds', mediaType: 'audio',
    payload: { kind: 'audioSpeed', input: { source_asset_id: '11', speed: 1.25 } },
    identity: { lastInput: { source_asset_id: '11', speed: 1.25 } }, schema: audioSpeedInputSchema },
  { taskType: 'video_matting', identityKey: 'smartMatting', route: 'video-mattings', mediaType: 'video',
    payload: { kind: 'smartMatting', input: { source_asset_id: '11', target_node_id: NODE_ID, mode: 'portrait', format: 'WEBM' } },
    identity: { lastInput: { source_asset_id: '11', target_node_id: NODE_ID, mode: 'portrait', format: 'WEBM' } }, schema: videoMattingInputSchema },
  { taskType: 'video_enhance', identityKey: 'videoEnhance', route: 'video-enhancements', mediaType: 'video',
    payload: { kind: 'videoEnhance', input: { source_asset_id: '11', target_node_id: NODE_ID, resolution: '2k' } },
    identity: { sourceAssetId: '11', lastParams: { resolution: '2k' } }, schema: videoEnhanceInputSchema },
  { taskType: 'video_frame_interpolation', identityKey: 'frameInterpolation', route: 'video-frame-interpolations', mediaType: 'video',
    payload: { kind: 'frameInterpolation', input: { source_asset_id: '11', target_node_id: NODE_ID, fps: 60 } },
    identity: { sourceAssetId: '11', lastParams: { fps: 120 }, frozenParams: { fps: 60 } }, schema: videoFrameInterpolationInputSchema },
];

function setup(taskType = 'image') {
  const videoCase = VIDEO_CASES.find((entry) => entry.taskType === taskType);
  const isVideoTool = videoCase != null;
  const nodes = new Map<string, Node>([
    [SOURCE_ID, { id: SOURCE_ID, type: 'mediaNode', position: { x: 0, y: 0 },
      data: { assetId: '11', src: 'https://assets/source.mp4', mediaType: 'video', fileName: '源视频' } }],
    [NODE_ID, { id: NODE_ID, type: 'mediaNode', position: { x: 20, y: 30 },
      data: { genStatus: 'generating', mediaType: videoCase?.mediaType ?? taskType,
        fileName: '用户改名', width: 420, height: 260,
        ...(videoCase ? { draft: true, [videoCase.identityKey]: structuredClone(videoCase.identity) } : {}) } }],
  ]);
  let edges = [{ source: SOURCE_ID, target: NODE_ID }];
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const warnings: string[] = [];
  const requests: Array<{ path: string; body: Record<string, unknown>; key: string | null }> = [];
  let records: GenerationRecoveryRecord[] = [];
  let epoch = {};
  let project = '1';
  let submissionId = SID;
  let releaseCreate!: () => void;
  let releaseStatus: (() => void) | undefined;
  let holdStatus = false;
  const heldCreate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout() {}, localStorage: { getItem: () => null } });
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const binding = canvasBindingSchema.parse(body.canvas_binding);
    const key = new Headers(init.headers).get('Idempotency-Key');
    requests.push({ path, body, key });
    if (videoCase?.payload.kind === 'smartMatting') expect(body.client_token).toBe(binding.submission_id);
    else expect(key).toBe(binding.submission_id);
    if (videoCase) {
      const { canvas_binding: _binding, client_token: _token, ...input } = body;
      videoCase.schema.parse(input);
    }
    if (binding.submission_id === SID) await heldCreate;
    const jobId = binding.submission_id === SID ? '501' : '502';
    return envelope({
      job_id: jobId, generation_job_id: jobId, status: 'queued', cursor: 1,
      canvas_binding: { protocol_version: 1, submission_id: binding.submission_id,
        target_node_id: NODE_ID, binding_revision: binding.submission_id === SID ? 1 : 2,
        job_id: jobId, is_current: true },
    });
  });
  const patch = (id: string, data: Record<string, unknown>) => {
    const node = nodes.get(id);
    if (node) nodes.set(id, { ...node, data: { ...node.data, ...data } });
  };
  const host: GenerationRuntimeHost = {
    getProjectId: () => project, getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()] as RuntimeNodeView[],
    findNode: (id) => nodes.get(id) as RuntimeNodeView | undefined ?? null,
    patchNode: patch, insertMediaNode: (node) => { nodes.set(node.id, { ...node, width: node.width ?? undefined, height: node.height ?? undefined }); },
    removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => edges,
    addEdge: (source, target) => {
      if (!edges.some((edge) => edge.source === source && edge.target === target)) edges.push({ source, target });
    },
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); },
    clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete() {}, isPendingDelete: () => false,
    applyTerminal: (id, _jobId, detail) => {
      patch(id, { genStatus: detail.status, errorText: nodes.get(id)?.data.videoEnhance
        ? videoEnhanceErrorText(detail.error) : readJobFailText(detail.error), errorCode: detail.error?.code });
      return 'terminal';
    },
    settleCancelled() {}, saveCanvas: async () => true,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 2, records, next_cursor: null }),
    toast: (_kind, message) => { warnings.push(message); },
    openRechargeForCreditsError: () => false, addAuthResume() {}, rememberAsset() {},
  };
  const runtime = createGenerationRuntime(host, {
    fetchJobStatus: async (jobId): Promise<JobDetail> => {
      if (holdStatus) await new Promise<void>((resolve) => { releaseStatus = resolve; });
      return String(jobId) === '501'
        ? records[0]?.job?.status === 'succeeded'
          ? { job_id: jobId, status: 'succeeded', progress: 100, asset: { id: '99', url: 'https://assets/result', type: 'video' } }
          : { job_id: jobId, status: 'failed', progress: 0, asset: null, error: ERROR }
        : { job_id: jobId, status: 'processing', progress: 20, asset: null };
    },
    newId: () => submissionId, setTimeout: () => 1, clearTimeout() {},
  });
  runtime.register(normalGenerationTask);
  runtime.register(videoToolsTask);

  const acceptAndReload = async (targetPresent = true) => {
    const target = { targetNodeId: NODE_ID, expectedBindingRevision: 0,
      seedTarget: { role: isVideoTool ? 'draft' as const : 'result-placeholder' as const,
        x: 20, y: 30, width: 420, height: 260, name: '用户改名' },
      seedSources: [{ node_id: SOURCE_ID, x: 0, y: 0, width: 320, height: 180, name: '源视频' }] };
    const normalPayload: CreateJobPayload = {
      type: taskType as CreateJobPayload['type'], expected_output_count: 1, target_node_id: NODE_ID,
      parameters: taskType === 'video'
        ? { prompt: '生成视频', model_id: '1', aspect_ratio: '16:9', resolution: '1080p', duration: 5 }
        : taskType === 'audio' ? { prompt: '生成音频', model_id: '1' }
          : { prompt: '生成图片', model_id: '1', aspect_ratio: '16:9', size: '2k' },
    };
    expect(videoCase ? runtime.submit(videoToolsTask, { target, payload: videoCase.payload })
      : runtime.submit(normalGenerationTask, { target, payload: normalPayload })).toBe(true);
    await flush();
    const binding: CanvasBinding = canvasBindingSchema.parse(requests[0].body.canvas_binding);
    const saved = JSON.parse(serializeNodes([...nodes.values()])) as Node[];
    runtime.reset();
    epoch = {};
    nodes.clear();
    saved.forEach((node) => { if (targetPresent || node.id !== NODE_ID) nodes.set(node.id, node); });
    if (!targetPresent) edges = [];
    records = [{
      submission_id: binding.submission_id, target_node_id: NODE_ID, job_id: '501', task_type: taskType,
      binding_revision: 1, is_current: true,
      job: { job_id: '501', type: taskType, status: 'failed', progress: 0,
        output_asset_ids: [], stored_error: ERROR, created_at: '2026-10-05T00:00:00Z' },
      recovery_seed: binding.recovery_seed, previous_target_snapshot: null,
      items: [{ recovery_item_id: `gcr:${SID}:$target`, output_key: '$target', node_id: NODE_ID,
        state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
    }];
    releaseCreate();
    await flush();
  };
  return {
    runtime, host, nodes, requests, warnings, owners, removed, acceptAndReload,
    edges: () => edges, patch,
    record: () => records[0],
    holdStatus: () => { holdStatus = true; },
    releaseStatus: () => { holdStatus = false; releaseStatus?.(); },
    nextSubmission: () => { submissionId = RETRY_SID; },
    switchProject: () => { project = '2'; epoch = {}; runtime.reset(); },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('普通生成与视频家族的可靠失败恢复（IKJQ05）', () => {
  it.each(['image', 'video_enhance'])('%s 有当前提交标记但缺受理 jobId 的失败占位仍补足可信身份', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload();
    ctx.patch(NODE_ID, { genStatus: 'failed', generationRecovery: { protocolVersion: 1, submissionId: SID, outputKey: '$target' } });
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ jobId: '501', genStatus: 'failed', errorText: '供应商超时' });
  });

  it.each(['image', 'video_enhance'])('%s 同一提交已收敛失败卡在重复扫描时保留终态与当前编辑', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload();
    await ctx.runtime.recover('1');
    await flush();
    ctx.patch(NODE_ID, { fileName: '失败后用户改名', width: 510, height: 290, errorText: '已保存失败信息' });
    const node = ctx.nodes.get(NODE_ID)!;
    ctx.nodes.set(NODE_ID, { ...node, position: { x: 50, y: 80 } });
    const saved = structuredClone(ctx.nodes.get(NODE_ID));
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(saved);
    expect(ctx.edges()).toEqual([{ source: SOURCE_ID, target: NODE_ID }]);
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.requests.map((request) => request.body.canvas_binding)).toHaveLength(1);
  });

  it.each(['image', 'video_enhance'])('%s 同一当前提交已保存的成品保持素材、标记与用户编辑', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload();
    const record = ctx.record();
    record.job!.status = 'succeeded';
    record.job!.output_asset_ids = ['99'];
    record.items[0].state = 'replaced';
    record.items.push({ recovery_item_id: `gcr:${SID}:primary`, output_key: 'primary', node_id: NODE_ID,
      state: 'present', revision: 1, node_binding_revision: 1, asset_id: '99', slot_id: null });
    ctx.patch(NODE_ID, { jobId: '501', genStatus: undefined, src: 'https://assets/result', assetId: '99',
      generationRecovery: { protocolVersion: 1, submissionId: SID, outputKey: 'primary' } });
    const saved = structuredClone(ctx.nodes.get(NODE_ID));
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(saved);
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.edges()).toEqual([{ source: SOURCE_ID, target: NODE_ID }]);
  });

  it.each(['image', 'video_enhance'])('%s 已删除目标不被可靠失败扫描复活', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload(false);
    ctx.removed.add(NODE_ID);
    ctx.record().items[0].state = 'removed';
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.has(NODE_ID)).toBe(false);
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.edges()).toEqual([]);
  });

  it.each(['image', 'video_enhance'])('%s 已移交当前归属的新提交不被旧失败记录抢回', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload();
    await ctx.runtime.recover('1');
    await flush();
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const accepted = structuredClone(ctx.nodes.get(NODE_ID));
    const state = ctx.runtime.statusOf(NODE_ID);
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(accepted);
    expect(ctx.runtime.statusOf(NODE_ID)).toEqual(state);
    expect(state).toMatchObject({ jobId: '502', submissionId: RETRY_SID });
    expect(ctx.owners.get(NODE_ID)).toBeDefined();
  });

  it.each(['image', 'video_enhance'])('%s 历史失败记录只有台账对账，不覆盖在场未确认卡', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload();
    ctx.record().is_current = false;
    const saved = structuredClone(ctx.nodes.get(NODE_ID));
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(saved);
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
  });

  it.each(['image', 'video_enhance'])('%s 恢复状态响应晚于项目切换时不写旧卡或清理新归属', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload();
    ctx.holdStatus();
    await ctx.runtime.recover('1');
    const saved = structuredClone(ctx.nodes.get(NODE_ID));
    ctx.switchProject();
    ctx.owners.set(NODE_ID, 'new-load-owner');
    ctx.releaseStatus();
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(saved);
    expect(ctx.owners.get(NODE_ID)).toBe('new-load-owner');
  });

  it('视频 HD：缺卡失败对照补卡与来源线，未知原输入保留失败卡并提示重新编辑', async () => {
    const ctx = setup('video_enhance');
    await ctx.acceptAndReload(false);
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ jobId: '501', genStatus: 'failed', errorText: '供应商超时', videoEnhance: {} });
    const restored = structuredClone(ctx.nodes.get(NODE_ID));
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(restored);
    expect(ctx.edges()).toEqual([{ source: SOURCE_ID, target: NODE_ID }]);
    expect([...ctx.nodes.keys()]).toEqual([SOURCE_ID, NODE_ID]);
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.requests.map((request) => request.path)).toEqual(['/api/projects/1/video-enhancements']);
    expect(ctx.warnings).toContain('原任务输入已不可信，请重新编辑后再发送');
    expect(ctx.nodes.get(NODE_ID)).toEqual(restored);
  });

  it.each(['video', 'audio'])('普通 %s 生成的同族在场占位沿可靠失败身份恢复与通用重试', async (taskType) => {
    const ctx = setup(taskType);
    await ctx.acceptAndReload();
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ jobId: '501', genStatus: 'failed', mediaType: taskType });
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.requests[1].path).toBe('/api/projects/1/generation-jobs/501/retry');
  });

  it.each(VIDEO_CASES.filter((entry) => entry.taskType !== 'video_enhance'))('$taskType 同族占位恢复失败并按真实 Schema 重发冻结参数', async (entry) => {
    const ctx = setup(entry.taskType);
    await ctx.acceptAndReload();
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({
      jobId: '501', genStatus: 'failed', [entry.identityKey]: entry.identity,
      generationRecovery: { protocolVersion: 1, submissionId: SID, outputKey: '$target' },
    });
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const retry = ctx.requests[1];
    const { canvas_binding: _binding, client_token: _token, ...input } = retry.body;
    expect(retry.path).toBe(`/api/projects/1/${entry.route}`);
    expect(entry.schema.parse(input)).toEqual(entry.payload.input);
    expect(canvasBindingSchema.parse(retry.body.canvas_binding).submission_id).toBe(RETRY_SID);
  });

  it('普通生成：缺卡失败对照继续补出唯一失败卡并保留原任务重试', async () => {
    const ctx = setup();
    await ctx.acceptAndReload(false);
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ jobId: '501', genStatus: 'failed', errorText: '供应商超时' });
    const restored = structuredClone(ctx.nodes.get(NODE_ID));
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(restored);
    expect([...ctx.nodes.keys()]).toEqual([SOURCE_ID, NODE_ID]);
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.requests[1].path).toBe('/api/projects/1/generation-jobs/501/retry');
  });

  it('视频 HD：已序列化无 jobId 草稿恢复失败并用可信 2k 原输入重试', async () => {
    const ctx = setup('video_enhance');
    await ctx.acceptAndReload();
    expect(ctx.nodes.get(NODE_ID)?.data.jobId).toBeUndefined();
    ctx.holdStatus();
    await ctx.runtime.recover('1');
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ jobId: '501', submissionId: SID });
    ctx.releaseStatus();
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({
      jobId: '501', genStatus: 'failed', errorText: '供应商超时', fileName: '用户改名', width: 420, height: 260,
      videoEnhance: { sourceAssetId: '11', lastParams: { resolution: '2k' } },
    });
    expect(ctx.nodes.get(NODE_ID)?.position).toEqual({ x: 20, y: 30 });
    expect(ctx.edges()).toEqual([{ source: SOURCE_ID, target: NODE_ID }]);
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const retry = ctx.requests[1];
    const { canvas_binding: _binding, ...input } = retry.body;
    expect(videoEnhanceInputSchema.parse(input)).toEqual({ source_asset_id: '11', target_node_id: NODE_ID, resolution: '2k' });
    expect(canvasBindingSchema.parse(retry.body.canvas_binding)).toMatchObject({ submission_id: RETRY_SID, expected_binding_revision: 1 });
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ jobId: '502', submissionId: RETRY_SID });
  });

  it('普通生成：已序列化无 jobId 占位在首次恢复收敛为可重试失败卡', async () => {
    const ctx = setup();
    await ctx.acceptAndReload();
    expect(ctx.nodes.get(NODE_ID)?.data.jobId).toBeUndefined();
    await ctx.runtime.recover('1');
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({
      jobId: '501', genStatus: 'failed', errorText: '供应商超时',
      generationRecovery: { protocolVersion: 1, submissionId: SID, outputKey: '$target' },
      fileName: '用户改名', width: 420, height: 260,
    });
    expect(ctx.nodes.get(NODE_ID)?.position).toEqual({ x: 20, y: 30 });
    expect(ctx.edges()).toEqual([{ source: SOURCE_ID, target: NODE_ID }]);
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const retry = ctx.requests[1];
    expect(retry.path).toBe('/api/projects/1/generation-jobs/501/retry');
    expect(canvasBindingSchema.parse(retry.body.canvas_binding)).toMatchObject({
      submission_id: RETRY_SID, expected_binding_revision: 1, target_node_id: NODE_ID,
    });
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ jobId: '502', submissionId: RETRY_SID });
  });
});
