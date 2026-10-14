import { describe, expect, it } from 'vitest';
import { isCanvasToolGeneration, mediaNodeGenerationOverlay } from './generationOverlay';

describe('mediaNodeGenerationOverlay', () => {
  it('hides fake progress and keeps cancel for image/video generation', () => {
    expect(mediaNodeGenerationOverlay(false)).toEqual({
      showProgress: false,
      progressLabel: null,
      showCancel: true,
    });
  });

  it('keeps progress copy and bar for audio video split (IKH28X 处理中语义：火山无中间百分比)', () => {
    expect(mediaNodeGenerationOverlay(true)).toEqual({
      showProgress: true,
      progressLabel: '音视频分离处理中',
      showCancel: false,
    });
  });

  it('音视频合成占位卡按画布工具卡口径（IKIHPM）：生成中不开放取消', () => {
    expect(isCanvasToolGeneration({ audioVideoMux: { sourceNodeId: 'a1' } })).toBe(true);
    expect(isCanvasToolGeneration({ mediaType: 'video', genStatus: 'generating' })).toBe(false);
  });
});
