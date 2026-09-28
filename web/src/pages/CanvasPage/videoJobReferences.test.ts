import { describe, expect, it } from 'vitest';

import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';
import { buildVideoJobReferences } from './videoJobReferences';

function ref(partial: Partial<VideoMediaRef> & Pick<VideoMediaRef, 'assetId' | 'mediaType'>): VideoMediaRef {
  return {
    nodeId: `n-${partial.assetId}`,
    url: `https://tos.test/${partial.assetId}`,
    name: partial.assetId,
    ...partial,
  };
}

describe('buildVideoJobReferences —— 视频参考时长要带上', () => {
  it('★ 视频参考带上 duration：视频按 token 计费，官方公式含视频输入时要加输入时长', () => {
    // 不带时长 → 服务端对素材库引用（material_id，本地零表）就量不到输入时长 →
    // billing 判「含视频输入却量不到」→ 拒绝提交。带上是划算得到价的前提。
    const refs: VideoMediaRefs = {
      reference: [ref({ assetId: '12', mediaType: 'video', duration: 5 })],
    };

    expect(buildVideoJobReferences(refs)).toEqual([
      { role: 'reference', type: 'video', asset_id: '12', duration: 5 },
    ]);
  });

  it('素材库视频参考（material_id）同样带时长', () => {
    const refs: VideoMediaRefs = {
      reference: [
        ref({ assetId: 'asset-20260915-abc', mediaType: 'video', materialId: 'asset-20260915-abc', duration: 8 }),
      ],
    };

    expect(buildVideoJobReferences(refs)).toEqual([
      { role: 'reference', type: 'video', material_id: 'asset-20260915-abc', duration: 8 },
    ]);
  });

  it('图片/音频参考不带时长 —— 服务端口径只统计 type == video', () => {
    const refs: VideoMediaRefs = {
      reference: [
        ref({ assetId: '11', mediaType: 'image', duration: 5 }),
        ref({ assetId: '13', mediaType: 'audio', duration: 5 }),
      ],
    };

    expect(buildVideoJobReferences(refs)).toEqual([
      { role: 'reference', type: 'image', asset_id: '11' },
      { role: 'reference', type: 'audio', asset_id: '13' },
    ]);
  });

  it('时长缺失或非正 → 不带这个字段（服务端据此走「量不到」，不按 0 估）', () => {
    const refs: VideoMediaRefs = {
      reference: [
        ref({ assetId: '12', mediaType: 'video' }),
        ref({ assetId: '14', mediaType: 'video', duration: 0 }),
      ],
    };

    expect(buildVideoJobReferences(refs)).toEqual([
      { role: 'reference', type: 'video', asset_id: '12' },
      { role: 'reference', type: 'video', asset_id: '14' },
    ]);
  });

  it('首尾帧顺序不变：首帧 / 尾帧 / 普通参考', () => {
    const refs: VideoMediaRefs = {
      first: ref({ assetId: '1', mediaType: 'image' }),
      last: ref({ assetId: '2', mediaType: 'image' }),
      reference: [ref({ assetId: '3', mediaType: 'video', duration: 6 })],
    };

    expect(buildVideoJobReferences(refs)).toEqual([
      { role: 'first_frame', type: 'image', asset_id: '1' },
      { role: 'last_frame', type: 'image', asset_id: '2' },
      { role: 'reference', type: 'video', asset_id: '3', duration: 6 },
    ]);
  });
});
