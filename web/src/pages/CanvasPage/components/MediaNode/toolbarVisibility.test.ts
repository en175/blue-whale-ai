import { describe, expect, it } from 'vitest';
import { mediaNodeToolbarVisibility, mediaCardToolbarVisible } from './toolbarVisibility';

describe('mediaNodeToolbarVisibility', () => {
  it('音频卡只显五功能占位（audioTools），mention/画质/视频工具全隐（IKH8Q3）', () => {
    expect(mediaNodeToolbarVisibility('audio')).toEqual({
      mention: false,
      imageQuality: false,
      videoEnhance: false,
      videoSubtitleErase: false,
      audioTools: true,
    });
  });

  it('keeps mention and image-quality menu on image nodes', () => {
    expect(mediaNodeToolbarVisibility('image')).toEqual({
      mention: true,
      imageQuality: true,
      videoEnhance: false,
      videoSubtitleErase: false,
      audioTools: false,
    });
  });

  it('keeps mention, video-enhance and subtitle-erase on video nodes, still hides image-quality menu', () => {
    expect(mediaNodeToolbarVisibility('video')).toEqual({
      mention: true,
      imageQuality: false,
      videoEnhance: true,
      videoSubtitleErase: true,
      audioTools: false,
    });
  });

  it('treats unspecified media as an image node', () => {
    expect(mediaNodeToolbarVisibility(undefined)).toEqual({
      mention: true,
      imageQuality: true,
      videoEnhance: false,
      videoSubtitleErase: false,
      audioTools: false,
    });
  });
});

describe('mediaCardToolbarVisible（悬浮工具条数据门，CanvasPage 与 MediaNodeToolbar 共用）', () => {
  it('普通成品卡显示', () => {
    expect(mediaCardToolbarVisible({})).toBe(true);
    expect(mediaCardToolbarVisible({ genStatus: undefined, assetMissing: undefined, emptyShell: undefined })).toBe(true);
  });

  it('生成流程卡（genStatus 有值）不显', () => {
    for (const genStatus of ['draft', 'generating', 'failed', 'cancelled'] as const) {
      expect(mediaCardToolbarVisible({ genStatus })).toBe(false);
    }
  });

  it('素材缺失（assetMissing）不显', () => {
    expect(mediaCardToolbarVisible({ assetMissing: true })).toBe(false);
  });

  it('空壳上传卡（emptyShell===true）不显；emptyShell falsy 不受影响', () => {
    expect(mediaCardToolbarVisible({ emptyShell: true })).toBe(false);
    expect(mediaCardToolbarVisible({ emptyShell: false })).toBe(true);
    expect(mediaCardToolbarVisible({ emptyShell: undefined })).toBe(true);
  });
});
