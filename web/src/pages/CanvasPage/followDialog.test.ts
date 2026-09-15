import { describe, expect, it } from 'vitest';
import { enabledVideoFollowModes, firstEnabledVideoMode } from './followDialog';
import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';

/* IKFC1T 文生视频门控：判定输入为「实际成为当前目标参考」的媒体集合
   （连线 + 角色库 material + 到节点选择暂存合并后的 VideoMediaRefs）——
   无媒体 → prompt 可选且 all 保持可选（不自动切回）；有任一媒体 → prompt 不可选；
   图片数 ≥1 开图生视频、≥2 开首尾帧（帧按图片计）；invalid 不计入。 */

const ref = (id: string, mediaType: 'image' | 'video' | 'audio' = 'image', materialId?: string): VideoMediaRef => ({
  nodeId: id,
  url: `http://x/${id}`,
  name: id,
  assetId: id,
  mediaType,
  materialId,
});

const refsOf = (reference: VideoMediaRef[], frames?: { first?: VideoMediaRef; last?: VideoMediaRef }): VideoMediaRefs => ({
  reference,
  ...(frames?.first ? { first: frames.first } : {}),
  ...(frames?.last ? { last: frames.last } : {}),
});

describe('IKFC1T enabledVideoFollowModes（媒体参考集合口径）', () => {
  it('无任何媒体参考：文生视频与全能参考均可选（全能参考保持可选保证不自动切回）', () => {
    expect(enabledVideoFollowModes(refsOf([]))).toEqual(['prompt', 'all']);
  });

  it('仅文本附件（不属于媒体参考）：同无媒体判定', () => {
    // 文本附件由 textAttachmentsOf 单独推导，不在 VideoMediaRefs 内——口径上不参与门控
    expect(enabledVideoFollowModes(refsOf([]))).toEqual(['prompt', 'all']);
  });

  it('单个图片普通参考：文生视频不可选，图生视频可选', () => {
    expect(enabledVideoFollowModes(refsOf([ref('m1')]))).toEqual(['all', 'text2video']);
  });

  it('两个图片普通参考：首尾帧可选', () => {
    expect(enabledVideoFollowModes(refsOf([ref('m1'), ref('m2')]))).toEqual(['all', 'text2video', 'keyframe']);
  });

  it('视频或音频参考：文生视频与图生视频均不可选，仅全能参考', () => {
    expect(enabledVideoFollowModes(refsOf([ref('v1', 'video')]))).toEqual(['all']);
    expect(enabledVideoFollowModes(refsOf([ref('a1', 'audio')]))).toEqual(['all']);
  });

  it('首尾帧按图片计入，且已存在帧槽时 keyframe 恒可选（IKFJJT：去掉一帧不把模式踢走）', () => {
    // 存在首帧槽即保留 keyframe 可选（旧行为仅双帧可选，去掉一帧会被自动切走）
    expect(enabledVideoFollowModes(refsOf([], { first: ref('f1') }))).toEqual(['all', 'text2video', 'keyframe']);
    expect(
      enabledVideoFollowModes(refsOf([], { first: ref('f1'), last: ref('f2') })),
    ).toEqual(['all', 'text2video', 'keyframe']);
  });

  it('角色库 material 参考与连线参考同口径（图片 material 开图生视频，视频 material 仅全能参考）', () => {
    expect(
      enabledVideoFollowModes(refsOf([ref('asset-1', 'image', 'asset-1')])),
    ).toEqual(['all', 'text2video']);
    expect(
      enabledVideoFollowModes(refsOf([ref('asset-2', 'video', 'asset-2')])),
    ).toEqual(['all']);
  });

  it('失效参考不计入：invalid 项不触发门控变化', () => {
    const withInvalid: VideoMediaRefs = {
      reference: [],
      invalid: [{ nodeId: 'm1', name: 'm1', role: 'reference', reason: '生成失败的卡片不能作为参考' }],
    };
    expect(enabledVideoFollowModes(withInvalid)).toEqual(['prompt', 'all']);
  });
});

describe('firstEnabledVideoMode 兜底顺序', () => {
  it('按 prompt → all → text2video → keyframe 取首个可用；空集兜底 prompt', () => {
    expect(firstEnabledVideoMode(['all'])).toBe('all');
    expect(firstEnabledVideoMode(['prompt', 'all'])).toBe('prompt');
    expect(firstEnabledVideoMode([])).toBe('prompt');
  });
});
