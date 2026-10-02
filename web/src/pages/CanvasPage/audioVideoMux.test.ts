import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
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
  audioVideoMuxResultName,
  audioVideoMuxSourceError,
  audioVideoMuxVideoError,
  buildAudioVideoMuxIdentity,
  buildAudioVideoMuxPlaceholderNode,
  isAudioVideoMuxAudioEdge,
  isAudioVideoMuxBindEdge,
  isAudioVideoMuxDraftNode,
} from './audioVideoMux';

/* IKIHPK 音视频合成纯逻辑：入口门槛（仅源音频 URL 缺失置灰）、拖线绑定源校验
   （已完成且关联资产的视频成品卡）、草稿卡身份判定与两类语义边识别。
   页面级链路（建卡/会话/分流/面板）见 audioVideoMuxEdit.test.tsx；
   运行时恢复规划（IKJJR4）见 generationRuntime/mixMuxTasks.test.ts。 */

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

/* IKIHP M 提交纯逻辑：结果卡命名与失败文案、恢复占位卡工厂（IKJJR4：节点 id 预分配 =
   canvas_binding.target_node_id，恢复规划经 generationRuntime/mixMuxTasks）。
   页面级链路（提交、占位回填、失败重试）见 audioVideoMuxSend.test.tsx。 */
describe('音视频合成结果卡命名与恢复占位卡', () => {
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

  it('恢复占位卡按目标节点 id 构建（视频型、不可播放、记住合成身份与 jobId）', () => {
    const card = buildAudioVideoMuxPlaceholderNode(
      'm1', buildAudioVideoMuxIdentity('a1', '8'), '73', { x: 600, y: 0 });
    expect(card).toMatchObject({
      id: 'm1', position: { x: 600, y: 0 },
      data: {
        src: '', fileName: AUDIO_VIDEO_MUX_TITLE, mediaType: 'video',
        genStatus: 'generating', draft: true, jobId: '73',
      },
    });
    expect(audioVideoMuxIdentityOf(card)?.sourceNodeId).toBe('a1');
  });
});
