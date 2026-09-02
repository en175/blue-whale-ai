import { describe, expect, it } from 'vitest';
import { collectMediaBlocks } from './collectMediaBlocks';

describe('collectMediaBlocks', () => {
  it('carries 图集 reference asset_id so @ mention can serialize as asset_ref (IKBCV3)', () => {
    const blocks = collectMediaBlocks(
      {
        id: 'card-1',
        type: 'assetNode',
        data: {
          kind: 'style',
          refs: [
            { id: 'ref-1', src: 'https://cdn.example/a.png', type: 'image', assetId: 'ast_gallery_1' },
          ],
        },
      },
      'chip-9',
    );

    expect(blocks).toContainEqual(
      expect.objectContaining({
        type: 'image',
        url: 'https://cdn.example/a.png',
        asset_id: 'ast_gallery_1',
        media_type: 'image',
        display_label: '参考图',
        chip_id: 'chip-9',
        source: 'card-ref',
      }),
    );
  });

  it('carries 商品图集 asset_id the same way', () => {
    const blocks = collectMediaBlocks(
      {
        id: 'product-1',
        type: 'productNode',
        data: {
          images: [
            { id: 'img-1', src: 'https://cdn.example/p.png', enabled: true, type: 'image', assetId: 'ast_p1' },
          ],
        },
      },
      'chip-2',
    );

    expect(blocks).toContainEqual(
      expect.objectContaining({
        asset_id: 'ast_p1',
        url: 'https://cdn.example/p.png',
        media_type: 'image',
        chip_id: 'chip-2',
      }),
    );
  });

  it('keeps media-node assetId on the collected block', () => {
    const blocks = collectMediaBlocks(
      {
        id: 'media-1',
        type: 'mediaNode',
        data: {
          src: 'https://cdn.example/shot.png',
          mediaType: 'image',
          fileName: 'shot.png',
          assetId: 'ast_node_1',
        },
      },
      'chip-3',
    );

    expect(blocks[0]).toMatchObject({
      asset_id: 'ast_node_1',
      url: 'https://cdn.example/shot.png',
      display_label: 'shot.png',
      chip_id: 'chip-3',
    });
  });

  it('keeps independent video node url and source for hover preview (IKCHEC)', () => {
    const blocks = collectMediaBlocks(
      {
        id: 'media-v1',
        type: 'mediaNode',
        data: {
          src: 'https://cdn.example/clip.mp4',
          mediaType: 'video',
          fileName: 'clip.mp4',
          assetId: 'ast_video_1',
        },
      },
      'chip-v',
    );

    expect(blocks[0]).toMatchObject({
      type: 'video',
      media_type: 'video',
      source: 'node',
      url: 'https://cdn.example/clip.mp4',
      asset_id: 'ast_video_1',
      display_label: 'clip.mp4',
      resource_type: '视频',
      chip_id: 'chip-v',
    });
  });
});
