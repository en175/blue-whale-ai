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

  it('keeps progress copy and bar for audio extraction', () => {
    expect(mediaNodeGenerationOverlay(true)).toEqual({
      showProgress: true,
      progressLabel: '正在提取音频',
      showCancel: false,
    });
  });
});
