import { describe, expect, it } from 'vitest';
import { mediaNodeGenerationOverlay } from './generationOverlay';

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
});
