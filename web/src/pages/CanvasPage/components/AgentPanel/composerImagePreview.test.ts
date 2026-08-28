import { describe, expect, it } from 'vitest';
import { composerImagePreview } from './composerImagePreview';

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
    ).toEqual({ url: 'https://cdn.example/cat.png', label: 'cat.png' });
  });

  it('does not convert a video node mention', () => {
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
    ).toBeUndefined();
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
