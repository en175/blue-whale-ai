import { describe, expect, it } from 'vitest';
import { mediaNodeToolbarVisibility, mediaCardToolbarVisible } from './toolbarVisibility';

describe('mediaNodeToolbarVisibility', () => {
  it('hides mention, generate-image, image-quality menu, generate-video and subtitle-erase on audio nodes', () => {
    expect(mediaNodeToolbarVisibility('audio')).toEqual({
      mention: false,
      genImage: false,
      genVideo: false,
      imageQuality: false,
      videoSubtitleErase: false,
    });
  });

  it('keeps mention and generate actions on image nodes', () => {
    expect(mediaNodeToolbarVisibility('image')).toEqual({
      mention: true,
      genImage: true,
      genVideo: true,
      imageQuality: true,
      videoSubtitleErase: false,
    });
  });

  it('keeps mention, generate-video and subtitle-erase on video nodes, still hides generate-image and image-quality menu', () => {
    expect(mediaNodeToolbarVisibility('video')).toEqual({
      mention: true,
      genImage: false,
      genVideo: true,
      imageQuality: false,
      videoSubtitleErase: true,
    });
  });

  it('treats unspecified media as an image node', () => {
    expect(mediaNodeToolbarVisibility(undefined)).toEqual({
      mention: true,
      genImage: true,
      genVideo: true,
      imageQuality: true,
      videoSubtitleErase: false,
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
