import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@/api/jobs';
import {
  AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON,
  AUDIO_VIDEO_MUX_EDGE_ORIGIN,
  AUDIO_VIDEO_MUX_FAIL_TEXT,
  AUDIO_VIDEO_MUX_TITLE,
  AUDIO_VIDEO_MUX_UNAVAILABLE_REASON,
  AUDIO_VIDEO_MUX_UNSUPPORTED_REASON,
  AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON,
  AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON,
  audioVideoMuxErrorText,
  audioVideoMuxIdentityOf,
  audioVideoMuxNodeId,
  audioVideoMuxResultName,
  audioVideoMuxSourceError,
  audioVideoMuxVideoError,
  buildAudioVideoMuxIdentity,
  buildAudioVideoMuxPlaceholderNode,
  frozenAudioVideoMuxInput,
  isAudioVideoMuxAudioEdge,
  isAudioVideoMuxBindEdge,
  isAudioVideoMuxDraftNode,
  planAudioVideoMuxRecovery,
} from './audioVideoMux';

/* IKIHPK 音视频合成纯逻辑：入口门槛（仅源音频 URL 缺失置灰）、拖线绑定源校验
   （已完成且关联资产的视频成品卡）、草稿卡身份判定与两类语义边识别。
   页面级链路（建卡/会话/分流/面板）见 audioVideoMuxEdit.test.tsx。 */

function mediaNode(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data };
}

function edge(id: string, source: string, target: string, data?: Record<string, unknown>): Edge {
  return { id, source, target, ...(data ? { data } : {}) };
}

const readyAudio = (id: string, extra: Record<string, unknown> = {}) =>
  mediaNode(id, { src: `http://aud/${id}.mp3`, mediaType: 'audio', fileName: `音${id}`, assetId: `a-${id}`, ...extra });

/** 入口门槛按媒体 data 判定（工具条持 data，不伪造 Node；同 audioSpeedGateReason 口径） */
const dataOf = (node: Node) => node.data as Record<string, unknown>;

const readyVideo = (id: string, extra: Record<string, unknown> = {}) =>
  mediaNode(id, { src: `http://vid/${id}.mp4`, mediaType: 'video', fileName: `视${id}`, assetId: `v-${id}`, ...extra });

/** 音视频合成草稿卡（未发送：身份 + draft 态） */
const muxDraft = (id: string, extra: Record<string, unknown> = {}) =>
  mediaNode(id, {
    src: '',
    mediaType: 'video',
    fileName: AUDIO_VIDEO_MUX_TITLE,
    genStatus: 'draft',
    draft: true,
    audioVideoMux: { sourceNodeId: 'a1', reserveAudio: true, sync: 'none' },
    ...extra,
  });

describe('audioVideoMuxSourceError 入口门槛（仅源音频 URL 缺失置灰）', () => {
  it('就绪音频成品卡可进入（无 genStatus 视为成品；时长等元数据缺失不拦）', () => {
    expect(audioVideoMuxSourceError(dataOf(readyAudio('a1')))).toBeNull();
    expect(audioVideoMuxSourceError(dataOf(readyAudio('a2', { duration: undefined, width: undefined })))).toBeNull();
  });

  it('URL 缺失（undefined/null/空串）与上传中 blob 置灰：悬停唯一原因', () => {
    expect(audioVideoMuxSourceError(dataOf(readyAudio('a1', { src: undefined })))).toBe(AUDIO_VIDEO_MUX_UNAVAILABLE_REASON);
    expect(audioVideoMuxSourceError(dataOf(readyAudio('a1', { src: null })))).toBe(AUDIO_VIDEO_MUX_UNAVAILABLE_REASON);
    expect(audioVideoMuxSourceError(dataOf(readyAudio('a1', { src: '' })))).toBe(AUDIO_VIDEO_MUX_UNAVAILABLE_REASON);
    expect(audioVideoMuxSourceError(dataOf(readyAudio('a1', { src: 'blob:preview' })))).toBe(AUDIO_VIDEO_MUX_UNAVAILABLE_REASON);
  });

  it('非成品卡（草稿/生成中/失败/已取消）置灰：仅支持已完成的音频卡', () => {
    for (const genStatus of ['draft', 'generating', 'failed', 'cancelled']) {
      expect(audioVideoMuxSourceError(dataOf(readyAudio('a1', { genStatus })))).toBe(AUDIO_VIDEO_MUX_UNSUPPORTED_REASON);
    }
  });

  it('非音频卡与空 data 置灰：仅支持已完成的音频卡', () => {
    expect(audioVideoMuxSourceError({ mediaType: 'video', src: 'http://vid/v1.mp4' })).toBe(AUDIO_VIDEO_MUX_UNSUPPORTED_REASON);
    expect(audioVideoMuxSourceError({ mediaType: 'image', src: 'http://img/i1.png' })).toBe(AUDIO_VIDEO_MUX_UNSUPPORTED_REASON);
    expect(audioVideoMuxSourceError(undefined)).toBe(AUDIO_VIDEO_MUX_UNSUPPORTED_REASON);
  });
});

describe('audioVideoMuxVideoError 拖线绑定源校验（已完成且关联资产的视频成品卡）', () => {
  it('就绪视频成品卡可绑定（无 genStatus 视为成品；时长缺失不拦）', () => {
    expect(audioVideoMuxVideoError(readyVideo('v1'))).toBeNull();
    expect(audioVideoMuxVideoError(readyVideo('v2', { duration: undefined }))).toBeNull();
  });

  it('非视频卡与不存在节点：仅支持绑定视频卡', () => {
    expect(audioVideoMuxVideoError(readyAudio('a1'))).toBe(AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON);
    expect(audioVideoMuxVideoError(mediaNode('i1', { src: 'http://img/i1.png', mediaType: 'image', assetId: 'i-1' })))
      .toBe(AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON);
    expect(audioVideoMuxVideoError(undefined)).toBe(AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON);
  });

  it('非成品视频卡（草稿/生成中/失败）拒绝绑定', () => {
    for (const genStatus of ['draft', 'generating', 'failed']) {
      expect(audioVideoMuxVideoError(readyVideo('v1', { genStatus })))
        .toBe(AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON);
    }
  });

  it('素材不可用（URL 缺失 / 上传中 / 未关联资产）拒绝绑定', () => {
    expect(audioVideoMuxVideoError(readyVideo('v1', { src: '' }))).toBe(AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON);
    expect(audioVideoMuxVideoError(readyVideo('v1', { src: 'blob:preview' }))).toBe(AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON);
    expect(audioVideoMuxVideoError(readyVideo('v1', { assetId: undefined }))).toBe(AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON);
  });
});

describe('buildAudioVideoMuxIdentity 默认参数与身份判定', () => {
  it('默认「保留原声 + 保持原长」，冻结固定音频源身份', () => {
    expect(buildAudioVideoMuxIdentity('a1', 'a-asset')).toEqual({
      sourceNodeId: 'a1',
      sourceAssetId: 'a-asset',
      reserveAudio: true,
      sync: 'none',
    });
    expect(buildAudioVideoMuxIdentity('a1')).toEqual({
      sourceNodeId: 'a1',
      sourceAssetId: undefined,
      reserveAudio: true,
      sync: 'none',
    });
  });

  it('未发送草稿卡（身份 + draft 态）才算合成草稿卡；已发送占位卡与普通视频草稿卡不算', () => {
    const draft = muxDraft('m1');
    expect(isAudioVideoMuxDraftNode(draft)).toBe(true);
    expect(audioVideoMuxIdentityOf(draft)?.sourceNodeId).toBe('a1');
    // 已发送（生成中占位卡）：不再是绑定目标
    expect(isAudioVideoMuxDraftNode(muxDraft('m2', { genStatus: 'generating', draft: false }))).toBe(false);
    // 普通视频生成草稿卡：无合成身份
    expect(isAudioVideoMuxDraftNode(mediaNode('d1', { mediaType: 'video', genStatus: 'draft', draft: true }))).toBe(false);
    expect(isAudioVideoMuxDraftNode(undefined)).toBe(false);
  });
});

describe('合成语义边识别（固定音频输入线与视频绑定线）', () => {
  const draft = muxDraft('m1');

  it('原声输入线（source=固定音频源卡）与绑定线（source=视频卡）按来源分流', () => {
    const audioEdge = edge('e1', 'a1', 'm1', { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN });
    const bindEdge = edge('e2', 'v1', 'm1', { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN });
    expect(isAudioVideoMuxAudioEdge(audioEdge, draft)).toBe(true);
    expect(isAudioVideoMuxAudioEdge(bindEdge, draft)).toBe(false);
    expect(isAudioVideoMuxBindEdge(bindEdge, draft)).toBe(true);
    expect(isAudioVideoMuxBindEdge(audioEdge, draft)).toBe(false);
  });

  it('其他来源边与其他目标不受影响', () => {
    expect(isAudioVideoMuxAudioEdge(edge('e1', 'a1', 'm1', { origin: 'audio-mix' }), draft)).toBe(false);
    expect(isAudioVideoMuxAudioEdge(edge('e1', 'a1', 'm1'), draft)).toBe(false);
    expect(isAudioVideoMuxBindEdge(edge('e2', 'v1', 'other', { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN }), draft)).toBe(false);
    expect(isAudioVideoMuxAudioEdge(edge('e1', 'a1', 'm1', { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN }), undefined)).toBe(false);
  });

  it('固定音频线删除拦截文案用户可读', () => {
    expect(AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON).toContain('不可移除');
  });
});

/* IKIHP M 提交与恢复纯逻辑：冻结快照解析、结果卡命名与失败文案、恢复规划
   （进行中补占位卡 / 来源线按冻结输入补画 / 终态补轮询 / 已删卡不复活）。
   页面级链路（提交、占位回填、失败重试）见 audioVideoMuxSend.test.tsx 与
   audioVideoMuxRecovery.test.tsx。 */
describe('音视频合成冻结快照与结果卡命名', () => {
  it('冻结快照四键齐全才可用：缺键/畸形/非法 sync 与 assetId 一律拒绝', () => {
    const valid = {
      audio: { assetId: '8', nodeId: 'a1', url: 'https://tos/aud.mp3' },
      video: { assetId: '5', nodeId: 'v1', url: 'https://tos/vid.mp4' },
      is_audio_reserve: true,
      sync: 'none',
    };
    expect(frozenAudioVideoMuxInput(job({ input: valid }))).toEqual({
      audio: { assetId: '8', nodeId: 'a1' },
      video: { assetId: '5', nodeId: 'v1' },
      is_audio_reserve: true,
      sync: 'none',
    });
    // 素材库视频输入没有 nodeId：合法
    expect(frozenAudioVideoMuxInput(job({
      input: { ...valid, video: { assetId: '5' } },
    }))?.video).toEqual({ assetId: '5' });
    expect(frozenAudioVideoMuxInput(job({ input: null }))).toBeNull();
    expect(frozenAudioVideoMuxInput(job({ input: { ...valid, sync: 'trim' } }))).toBeNull();
    expect(frozenAudioVideoMuxInput(job({ input: { ...valid, is_audio_reserve: 'yes' } }))).toBeNull();
    expect(frozenAudioVideoMuxInput(job({ input: { ...valid, audio: { assetId: '08', nodeId: 'a1' } } }))).toBeNull();
    expect(frozenAudioVideoMuxInput(job({ input: { ...valid, audio: { assetId: '8' } } }))).toBeNull();
    expect(frozenAudioVideoMuxInput(job({ input: { ...valid, video: { assetId: '5', nodeId: '' } } }))).toBeNull();
  });

  it('结果卡名 = 源视频名去扩展名 + (音视频合成).mp4（与 worker 同款；空名回落「视频」）', () => {
    expect(audioVideoMuxResultName('城市夜景.mp4')).toBe('城市夜景(音视频合成).mp4');
    expect(audioVideoMuxResultName('产品开箱')).toBe('产品开箱(音视频合成).mp4');
    expect(audioVideoMuxResultName(' 海浪.mov ')).toBe('海浪(音视频合成).mp4');
    expect(audioVideoMuxResultName(undefined)).toBe('视频(音视频合成).mp4');
    expect(audioVideoMuxResultName('   ')).toBe('视频(音视频合成).mp4');
  });

  it('失败文案透传服务端 msg，缺失落 1053 兜底', () => {
    expect(audioVideoMuxErrorText({ msg: '音视频合成失败，请重试' })).toBe('音视频合成失败，请重试');
    expect(audioVideoMuxErrorText({ message: '资产不可用' })).toBe('资产不可用');
    expect(audioVideoMuxErrorText(null)).toBe(AUDIO_VIDEO_MUX_FAIL_TEXT);
    expect(audioVideoMuxErrorText({ msg: '  ' })).toBe(AUDIO_VIDEO_MUX_FAIL_TEXT);
  });

  it('占位卡恢复 id 由 jobId 确定性派生，视频型且不可播放', () => {
    expect(audioVideoMuxNodeId('73')).toBe('audio-video-mux-73');
    const card = buildAudioVideoMuxPlaceholderNode('73',
      buildAudioVideoMuxIdentity('a1', '8'), { x: 600, y: 0 });
    expect(card).toMatchObject({
      id: 'audio-video-mux-73', position: { x: 600, y: 0 },
      data: { src: '', fileName: AUDIO_VIDEO_MUX_TITLE, mediaType: 'video', genStatus: 'generating', jobId: '73' },
    });
  });
});

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    job_id: '73', type: 'audio_video_mux', status: 'queued', progress: 0,
    input: null, created_at: '2026-09-24T00:00:00Z', output_assets: [], error: null,
    ...overrides,
  };
}

const frozenInput = {
  audio: { assetId: '8', nodeId: 'a1', url: 'https://tos/aud.mp3' },
  video: { assetId: '5', nodeId: 'v1', url: 'https://tos/vid.mp4' },
  is_audio_reserve: true,
  sync: 'none',
};

describe('planAudioVideoMuxRecovery 恢复规划', () => {
  const pending = job({ input: frozenInput });

  it('受理后尚未落盘的任务补视频型占位卡与现存两条冻结来源线，多次恢复不复制', () => {
    const initial = [readyAudio('a1'), readyVideo('v1')];
    const first = planAudioVideoMuxRecovery(initial, [], [pending]);
    expect(first.nodes.map((node) => node.id)).toEqual(['a1', 'v1', 'audio-video-mux-73']);
    const card = first.nodes.find((node) => node.id === 'audio-video-mux-73')!;
    expect((card.data as Record<string, unknown>).mediaType).toBe('video');
    expect(audioVideoMuxIdentityOf(card)).toEqual({
      sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: true, sync: 'none',
      video: {
        assetId: '5', nodeId: 'v1', name: '视v1', duration: null, width: null, height: null,
        // IKIHMX 审查修复 2：恢复身份从画布视频卡现值取缩略图 src（素材库无卡场景省略回落图标）
        src: 'http://vid/v1.mp4',
      },
    });
    expect(first.edges.map((edge) => [edge.source, edge.target, edge.data?.origin])).toEqual([
      ['a1', 'audio-video-mux-73', AUDIO_VIDEO_MUX_EDGE_ORIGIN],
      ['v1', 'audio-video-mux-73', AUDIO_VIDEO_MUX_EDGE_ORIGIN],
    ]);
    expect(first.polls).toEqual([{ jobId: '73', cardId: 'audio-video-mux-73' }]);
    const again = planAudioVideoMuxRecovery(first.nodes, first.edges, [pending]);
    expect(again.nodes).toHaveLength(3);
    expect(again.edges).toHaveLength(2);
  });

  it('素材库视频输入（无 nodeId）只补固定音频线，不建悬空线', () => {
    const initial = [readyAudio('a1')];
    const result = planAudioVideoMuxRecovery(initial, [], [job({
      input: { ...frozenInput, video: { assetId: '5' } },
    })]);
    expect(result.edges.map((edge) => edge.source)).toEqual(['a1']);
    // IKIHMX 审查修复 2：无画布卡可查，恢复身份不带缩略图 src（面板回落图标占位）
    const libCard = result.nodes.find((node) => node.id === 'audio-video-mux-73')!;
    expect(audioVideoMuxIdentityOf(libCard)!.video).not.toHaveProperty('src');
  });

  it('输入卡已删除时不复活、不创建悬空线；已产出成品卡不在恢复中重建', () => {
    const result = planAudioVideoMuxRecovery([readyAudio('a1')], [], [pending]);
    expect(result.edges.map((edge) => edge.source)).toEqual(['a1']);
    // 视频输入卡已删：只剩固定音频线
    const noVideo = planAudioVideoMuxRecovery([], [], [job({ input: { ...frozenInput, video: { assetId: '5' } } })]);
    expect(noVideo.edges).toEqual([]);
  });

  it('画布上的卡按任务态续轮询：失败卡转生成中清旧错误，终态任务补轮询', () => {
    const card = buildAudioVideoMuxPlaceholderNode('73',
      buildAudioVideoMuxIdentity('a1', '8'), { x: 600, y: 0 });
    const failed = { ...card, data: { ...card.data, genStatus: 'failed', errorText: '供应商失败' } };
    const requeued = planAudioVideoMuxRecovery([readyAudio('a1'), failed], [], [pending]);
    expect(requeued.nodes.find((node) => node.id === 'audio-video-mux-73')?.data).toMatchObject({
      jobId: '73', genStatus: 'generating', errorText: undefined,
    });
    expect(requeued.polls).toEqual([{ jobId: '73', cardId: 'audio-video-mux-73' }]);
    // 任务已终态：不补状态（终态由轮询回填），只补轮询
    const succeededJob = job({ status: 'succeeded', input: frozenInput });
    const settled = planAudioVideoMuxRecovery([readyAudio('a1'), failed], [], [succeededJob]);
    expect(settled.polls).toEqual([{ jobId: '73', cardId: 'audio-video-mux-73' }]);
    expect(settled.nodes.find((node) => node.id === 'audio-video-mux-73')?.data.genStatus).toBe('failed');
  });

  it('重试排队后刷新：已持久化的失败草稿卡按原卡 id 续轮询，不补虚拟占位卡（IKILVG）', () => {
    const failed = muxDraft('mux-draft-1', {
      genStatus: 'failed', jobId: '73', errorText: '上次失败：供应商超时',
    });
    const result = planAudioVideoMuxRecovery([readyAudio('a1'), failed], [], [pending]);
    // 原卡原地转生成中：不补 audio-video-mux-73 占位卡、不复制卡
    expect(result.nodes.map((node) => node.id)).toEqual(['a1', 'mux-draft-1']);
    expect(result.nodes.find((node) => node.id === 'mux-draft-1')?.data).toMatchObject({
      genStatus: 'generating', errorText: undefined,
    });
    // 轮询配对挂原卡 id（画布上确实无卡时才用 audioVideoMuxNodeId(jobId)）
    expect(result.polls).toEqual([{ jobId: '73', cardId: 'mux-draft-1' }]);
  });

  it('重试刷新前已再次失败：失败卡同步服务端最新错误文案，不再轮询（IKILVG）', () => {
    const failedJob = job({ status: 'failed', input: frozenInput, error: { msg: '重试后最新失败原因' } });
    const failed = muxDraft('mux-draft-1', {
      genStatus: 'failed', jobId: '73', errorText: '上次失败：供应商超时',
    });
    const result = planAudioVideoMuxRecovery([readyAudio('a1'), failed], [], [failedJob]);
    expect(result.nodes.find((node) => node.id === 'mux-draft-1')?.data).toMatchObject({
      genStatus: 'failed', errorText: '重试后最新失败原因',
    });
    expect(result.polls).toEqual([]);
    // 同步后幂等：再次规划不再改动
    const again = planAudioVideoMuxRecovery(result.nodes, result.edges, [failedJob]);
    expect(again.nodes).toBe(result.nodes);
    expect(again.nodes.find((node) => node.id === 'mux-draft-1')?.data.errorText).toBe('重试后最新失败原因');
  });

  it('卡已落盘的任务不重复补卡与来源线（幂等），畸形任务跳过', () => {
    const present = job({ input: frozenInput, canvas_card_state: 'present' });
    const card = buildAudioVideoMuxPlaceholderNode('73',
      buildAudioVideoMuxIdentity('a1', '8'), { x: 600, y: 0 });
    const existing = [
      readyAudio('a1'), readyVideo('v1'), { ...card, data: { ...card.data, genStatus: 'generating' } },
    ];
    const edges = [
      edge('e1', 'a1', 'audio-video-mux-73', { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN }),
      edge('e2', 'v1', 'audio-video-mux-73', { origin: AUDIO_VIDEO_MUX_EDGE_ORIGIN }),
    ];
    const result = planAudioVideoMuxRecovery(existing, edges, [present, job({ job_id: '74', input: { sync: 'trim' } })]);
    expect(result.nodes.map((node) => node.id)).toEqual(['a1', 'v1', 'audio-video-mux-73']);
    expect(result.edges).toHaveLength(2);
    expect(result.polls).toEqual([]);
  });
});
