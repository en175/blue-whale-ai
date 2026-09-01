import { describe, expect, it } from 'vitest';
import { composerImagePreview, isCanvasNodeVideo, isSidebarUploadedVideo } from './composerImagePreview';

describe('composerImagePreview', () => {
  it('uses the canvas image node original URL for the composer capsule', () => {
    expect(
      composerImagePreview([
        {
          type: 'image',
          url: 'https://cdn.example/cat.png',
          name: 'cat.png',
          source: 'node',
          media_type: 'image',
          display_label: 'cat.png',
          chip_id: 'chip-1',
        },
      ]),
    ).toEqual({ url: 'https://cdn.example/cat.png', label: 'cat.png', mediaType: 'image' });
  });

  it('uses the canvas video node original URL for the composer capsule', () => {
    expect(
      composerImagePreview([
        {
          type: 'video',
          url: 'https://cdn.example/clip.mp4',
          source: 'node',
          media_type: 'video',
          display_label: 'clip.mp4',
        },
      ]),
    ).toEqual({ url: 'https://cdn.example/clip.mp4', label: 'clip.mp4', mediaType: 'video' });
  });

  it('leaves 图集 / 商品卡 image mentions as-is', () => {
    expect(
      composerImagePreview([
        {
          type: 'image',
          url: 'https://cdn.example/ref.png',
          source: 'card-ref',
          media_type: 'image',
          display_label: '参考图',
        },
        {
          type: 'image',
          url: 'https://cdn.example/product.png',
          source: 'card-image',
          media_type: 'image',
          display_label: '商品图',
        },
      ]),
    ).toBeUndefined();
  });

  it('leaves 商品卡 / 图集 video mentions as-is', () => {
    expect(
      composerImagePreview([
        {
          type: 'video',
          url: 'https://cdn.example/product.mp4',
          source: 'card-image',
          media_type: 'video',
          display_label: '商品视频',
        },
        {
          type: 'video',
          url: 'https://cdn.example/ref.mp4',
          source: 'card-ref',
          media_type: 'video',
          display_label: '参考视频',
        },
      ]),
    ).toBeUndefined();
  });

  it('does not convert an audio node mention', () => {
    expect(
      composerImagePreview([
        {
          type: 'audio',
          url: 'https://cdn.example/voice.mp3',
          source: 'node',
          media_type: 'audio',
          display_label: '旁白',
        },
      ]),
    ).toBeUndefined();
  });

  it('does not invent a preview when the image node has no URL', () => {
    expect(
      composerImagePreview([
        {
          type: 'image',
          source: 'node',
          media_type: 'image',
          asset_id: 'ast_1',
          display_label: 'shot.png',
        },
      ]),
    ).toBeUndefined();
  });
});

describe('isCanvasNodeVideo', () => {
  it('recognizes an independent canvas video node', () => {
    expect(
      isCanvasNodeVideo({
        type: 'video',
        source: 'node',
        media_type: 'video',
        url: 'https://cdn.example/clip.mp4',
      }),
    ).toBe(true);
  });

  it('recognizes a history resource_ref that kept resource_kind 视频', () => {
    expect(
      isCanvasNodeVideo({
        type: 'resource_ref',
        media_type: 'video',
        resource_id: 'node_1',
        resource_kind: '视频',
        display_label: 'clip.mp4',
      }),
    ).toBe(true);
  });

  it('recognizes an asset_ref that kept resource_type 视频', () => {
    expect(
      isCanvasNodeVideo({
        type: 'asset_ref',
        asset_id: 'ast_v1',
        media_type: 'video',
        resource_type: '视频',
        display_label: 'clip.mp4',
      }),
    ).toBe(true);
  });

  it('does not treat 商品卡 or 图集 videos as canvas node videos', () => {
    expect(
      isCanvasNodeVideo({
        type: 'video',
        source: 'card-image',
        media_type: 'video',
        resource_kind: '商品卡',
      }),
    ).toBe(false);
    expect(
      isCanvasNodeVideo({
        type: 'asset_ref',
        asset_id: 'ast_v1',
        media_type: 'video',
        display_label: 'scene.mp4',
      }),
    ).toBe(false);
  });
});

describe('isSidebarUploadedVideo', () => {
  it('recognizes a sidebar-uploaded asset_ref with only library identity', () => {
    expect(
      isSidebarUploadedVideo({
        type: 'asset_ref',
        asset_id: 'asset-up-1',
        media_type: 'video',
        display_label: 'clip.mp4',
      }),
    ).toBe(true);
  });

  it('does not treat 商品卡 or 图集 videos as sidebar uploads', () => {
    expect(
      isSidebarUploadedVideo({
        type: 'video',
        source: 'card-image',
        media_type: 'video',
        url: 'https://cdn.example/product.mp4',
        resource_type: '商品卡',
        asset_id: 'ast_p',
      }),
    ).toBe(false);
    expect(
      isSidebarUploadedVideo({
        type: 'video',
        source: 'card-ref',
        media_type: 'video',
        url: 'https://cdn.example/ref.mp4',
        resource_type: '风格卡',
        asset_id: 'ast_g',
      }),
    ).toBe(false);
  });

  it('does not treat canvas node videos as sidebar uploads', () => {
    expect(
      isSidebarUploadedVideo({
        type: 'video',
        source: 'node',
        media_type: 'video',
        asset_id: 'ast_n',
        url: 'https://cdn.example/clip.mp4',
      }),
    ).toBe(false);
  });
});
