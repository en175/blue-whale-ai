import { describe, expect, it } from 'vitest';
import { isCanvasToolGeneration, mediaNodeGenerationOverlay } from './generationOverlay';

describe('mediaNodeGenerationOverlay', () => {
  it('图片与视频生成中不显示百分比、也不提供取消（IKR63Z）', () => {
    expect(mediaNodeGenerationOverlay('image', false)).toEqual({
      showProgress: false,
      progressLabel: '图片生成中…',
      showCancel: false,
    });
    expect(mediaNodeGenerationOverlay('video', false)).toEqual({
      showProgress: false,
      progressLabel: '视频生成中…',
      showCancel: false,
    });
  });

  it('音频生成保留取消入口', () => {
    expect(mediaNodeGenerationOverlay('audio', false)).toEqual({
      showProgress: false,
      progressLabel: null,
      showCancel: true,
    });
  });

  it('keeps progress copy and bar for audio video split (IKH28X 处理中语义：火山无中间百分比)', () => {
    expect(mediaNodeGenerationOverlay('audio', true)).toEqual({
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
