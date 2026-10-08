/* ============================================
 * videoPromptRefs 测试（IKFA1O）：视频面板有效标签映射——
 * 首尾帧按角色、普通参考按同类型编号、模式不兼容失效（C1/C2/C5）。
 * 与服务端 videoRefLabel 同口径（帧在前、reference 保序、同类型连续编号）。
 * ============================================ */
import { describe, expect, it } from 'vitest';
import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';
import { videoLabelMapOf } from './videoPromptRefs';

const ref = (id: string, mediaType: 'image' | 'video' | 'audio', overrides: Partial<VideoMediaRef> = {}): VideoMediaRef => ({
  nodeId: `node-${id}`,
  url: `https://x/${id}`,
  name: `素材${id}`,
  assetId: id,
  mediaType,
  ...overrides,
});

const ALL_REFS: VideoMediaRefs = {
  reference: [ref('101', 'image'), ref('301', 'video'), ref('102', 'image'), ref('401', 'audio'), ref('asset-x1', 'video', { materialId: 'asset-x1' })],
};

const KEYFRAME_REFS: VideoMediaRefs = {
  reference: [],
  first: ref('201', 'image'),
  last: ref('202', 'image'),
};

describe('videoLabelMapOf（全能参考模式 omni）', () => {
  it('普通参考按同类型顺序连续编号；素材库身份同样参与', () => {
    const { labelOf } = videoLabelMapOf(ALL_REFS, 'omni');
    expect(labelOf('101')).toBe('图片1');
    expect(labelOf('102')).toBe('图片2');
    expect(labelOf('301')).toBe('视频1');
    expect(labelOf('asset-x1')).toBe('视频2');
    expect(labelOf('401')).toBe('音频1');
  });

  it('不在集合的身份返回 null', () => {
    const { labelOf } = videoLabelMapOf(ALL_REFS, 'omni');
    expect(labelOf('999')).toBeNull();
  });

  it('refItems 帧在前、reference 保序（与服务端编译同序）', () => {
    const { refItems } = videoLabelMapOf(ALL_REFS, 'omni');
    expect(refItems.map((r) => r.id)).toEqual(['101', '301', '102', '401', 'asset-x1']);
    expect(refItems.every((r) => r.role === 'reference')).toBe(true);
  });
});

describe('videoLabelMapOf（首尾帧模式 first_last_frame）', () => {
  it('首帧/尾帧按角色显示', () => {
    const { labelOf } = videoLabelMapOf(KEYFRAME_REFS, 'first_last_frame');
    expect(labelOf('201')).toBe('首帧');
    expect(labelOf('202')).toBe('尾帧');
  });

  it('普通参考身份在集合但模式不接受 → null（C2 模式失效，保留原指向由 reconcile 承载）', () => {
    const mixed: VideoMediaRefs = { ...KEYFRAME_REFS, reference: [ref('101', 'image')] };
    const { labelOf } = videoLabelMapOf(mixed, 'first_last_frame');
    expect(labelOf('101')).toBeNull();
  });
});

describe('videoLabelMapOf（图片参考模式 image_reference）', () => {
  it('仅图片参考有效；视频/音频参考模式不接受 → null（C5：加回同身份仍不兼容不恢复）', () => {
    const { labelOf } = videoLabelMapOf(ALL_REFS, 'image_reference');
    expect(labelOf('101')).toBe('图片1');
    expect(labelOf('102')).toBe('图片2');
    expect(labelOf('301')).toBeNull();
    expect(labelOf('asset-x1')).toBeNull();
    expect(labelOf('401')).toBeNull();
  });

  it('首尾帧在非帧模式不接受（切模式后帧标签失效）', () => {
    const { labelOf } = videoLabelMapOf(KEYFRAME_REFS, 'omni');
    expect(labelOf('201')).toBeNull();
    expect(labelOf('202')).toBeNull();
  });
});

it('文生视频模式不接受媒体标签，切回全能参考恢复同一身份', () => {
  const refs = { ...KEYFRAME_REFS, reference: ALL_REFS.reference };
  const { labelOf, refItems } = videoLabelMapOf(refs, 'text2video');
  expect(refItems.every((item) => labelOf(item.id) === null)).toBe(true);
  expect(videoLabelMapOf(refs, 'omni').labelOf('101')).toBe('图片1');
});

describe('videoLabelMapOf numberMap（IKFCKQ 缩略图编号与标签同源）', () => {
  it('普通参考按类型连续编号；模式不接受与帧角色不在其中', () => {
    const all = videoLabelMapOf(ALL_REFS, 'omni');
    expect(all.numberMap.get('101')).toBe(1);
    expect(all.numberMap.get('102')).toBe(2);
    expect(all.numberMap.get('301')).toBe(1);
    expect(all.numberMap.get('401')).toBe(1);
    expect(all.numberMap.get('asset-x1')).toBe(2);

    const t2v = videoLabelMapOf(ALL_REFS, 'image_reference');
    expect(t2v.numberMap.get('101')).toBe(1);
    expect(t2v.numberMap.get('102')).toBe(2);
    expect(t2v.numberMap.has('301')).toBe(false);

    const kf = videoLabelMapOf({ ...KEYFRAME_REFS, reference: ALL_REFS.reference }, 'first_last_frame');
    expect(kf.numberMap.size).toBe(0);
  });
});

describe('videoLabelMapOf（文生视频模式 text2video，IKFC1T）', () => {
  it('任何媒体参考（普通参考与首尾帧）均不接受 → 全部 null；refItems 提交投影不受模式影响', () => {
    const { labelOf, refItems } = videoLabelMapOf(
      { ...ALL_REFS, first: KEYFRAME_REFS.first, last: KEYFRAME_REFS.last },
      'text2video',
    );
    expect(labelOf('101')).toBeNull();
    expect(labelOf('301')).toBeNull();
    expect(labelOf('401')).toBeNull();
    expect(labelOf('201')).toBeNull();
    expect(labelOf('202')).toBeNull();
    expect(refItems.length).toBeGreaterThan(0);
  });
});
