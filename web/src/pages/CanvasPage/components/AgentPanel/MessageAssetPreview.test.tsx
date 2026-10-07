// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageAssetPreview } from './MessageAssetPreview';
import { rememberAssetUrl, isInlineMediaThumbnail } from './assetUrlCache';

const fetchAssetDetail = vi.hoisted(() => vi.fn(async (): Promise<{ id: string; url: string }> => {
  throw new Error('asset not found');
}));

vi.mock('@/api/assets', () => ({
  fetchAssetDetail,
}));

vi.mock('../ImageMentionChip', () => ({
  ImageMentionChip: ({ label }: { label: string }) =>
    createElement('span', { 'data-testid': 'image-mention' }, label),
}));

vi.mock('../VideoMentionChip', () => ({
  VideoMentionChip: ({ label }: { label: string }) =>
    createElement('span', { 'data-testid': 'video-mention' }, label),
}));

let root: Root;
let mountNode: HTMLDivElement;

async function renderPreview(
  blocks: Parameters<typeof MessageAssetPreview>[0]['blocks'],
  chips?: { id: string }[],
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(MessageAssetPreview, { blocks, chips }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchAssetDetail.mockReset();
  fetchAssetDetail.mockRejectedValue(new Error('asset not found'));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('MessageAssetPreview', () => {
  it('renders a video mention chip for a canvas node video', async () => {
    await renderPreview(
      [
        {
          type: 'video',
          source: 'node',
          media_type: 'video',
          url: 'https://cdn.example/clip.mp4',
          display_label: 'clip.mp4',
          chip_id: 'chip-v',
          node_id: 'node-v',
        },
      ],
      [{ id: 'chip-v' }],
    );
    expect(mountNode.querySelector('[data-testid="video-mention"]')?.textContent).toBe('clip.mp4');
    expect(mountNode.textContent).not.toContain('[视频]');
  });

  it('does not extra-render an ordinary @ video that already has a text chip', async () => {
    await renderPreview(
      [
        {
          type: 'asset_ref',
          asset_id: 'video_1',
          media_type: 'video',
          display_label: 'scene.mp4',
        },
      ],
      [{ id: 'video_1' }],
    );
    expect(mountNode.querySelector('[data-testid="video-mention"]')).toBeNull();
    expect(mountNode.textContent).toBe('');
  });

  it('renders a video mention chip for a sidebar-uploaded asset_ref with a cached URL', async () => {
    rememberAssetUrl('asset-up-1', 'https://cdn.example/upload.mp4');
    await renderPreview([
      {
        type: 'asset_ref',
        asset_id: 'asset-up-1',
        media_type: 'video',
        display_label: 'upload.mp4',
      },
    ]);
    expect(mountNode.querySelector('[data-testid="video-mention"]')?.textContent).toBe('upload.mp4');
    expect(mountNode.textContent).not.toContain('[视频]');
  });

  it('keeps the uploaded-video thumbnail after history rebuilds a @ [视频] text chip', async () => {
    rememberAssetUrl('asset-up-2', 'https://cdn.example/upload-2.mp4');
    await renderPreview(
      [
        {
          type: 'asset_ref',
          asset_id: 'asset-up-2',
          media_type: 'video',
          display_label: 'upload-2.mp4',
        },
      ],
      [{ id: 'asset-up-2' }],
    );
    expect(mountNode.querySelector('[data-testid="video-mention"]')?.textContent).toBe('upload-2.mp4');
    expect(mountNode.textContent).not.toContain('[视频]');
  });

  it('resolves a sidebar-uploaded video thumbnail from the asset library after refresh', async () => {
    fetchAssetDetail.mockResolvedValueOnce({ id: 'asset-up-4', url: 'https://cdn.example/r.mp4' });
    await renderPreview(
      [
        {
          type: 'asset_ref',
          asset_id: 'asset-up-4',
          media_type: 'video',
          display_label: 'r.mp4',
        },
      ],
      [{ id: 'asset-up-4' }],
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mountNode.querySelector('[data-testid="video-mention"]')?.textContent).toBe('r.mp4');
    expect(mountNode.textContent).not.toContain('[视频]');
    expect(
      isInlineMediaThumbnail({
        type: 'asset_ref',
        asset_id: 'asset-up-4',
        media_type: 'video',
        display_label: 'r.mp4',
      }),
    ).toBe(true);
  });

  it('does not turn a 商品卡 video with a playable URL into a thumbnail chip', async () => {
    await renderPreview(
      [
        {
          type: 'video',
          source: 'card-image',
          media_type: 'video',
          url: 'https://cdn.example/product.mp4',
          display_label: '商品视频',
          chip_id: 'chip-product',
          resource_type: '商品卡',
          asset_id: 'asset-product-v',
        },
      ],
      [{ id: 'chip-product' }],
    );
    expect(mountNode.querySelector('[data-testid="video-mention"]')).toBeNull();
    expect(mountNode.textContent).toBe('');
  });

  it('does not turn a 图集 video into a thumbnail even if the asset library has its URL', async () => {
    fetchAssetDetail.mockResolvedValueOnce({ id: 'asset-gallery-v', url: 'https://cdn.example/gallery.mp4' });
    await renderPreview(
      [
        {
          type: 'video',
          source: 'card-ref',
          media_type: 'video',
          url: 'https://cdn.example/gallery.mp4',
          display_label: '参考视频',
          chip_id: 'chip-gallery',
          resource_type: '风格卡',
          asset_id: 'asset-gallery-v',
        },
      ],
      [{ id: 'chip-gallery' }],
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mountNode.querySelector('[data-testid="video-mention"]')).toBeNull();
    expect(mountNode.textContent).toBe('');
  });

  it('still renders image mention chips for canvas images', async () => {
    await renderPreview([
      {
        type: 'image',
        source: 'node',
        media_type: 'image',
        url: 'https://cdn.example/cat.png',
        display_label: 'cat.png',
      },
    ]);
    expect(mountNode.querySelector('[data-testid="image-mention"]')?.textContent).toBe('cat.png');
  });
});

describe('isInlineMediaThumbnail', () => {
  it('treats a cached sidebar upload as an inline thumbnail so @ [视频] is suppressed', () => {
    rememberAssetUrl('asset-up-3', 'https://cdn.example/c.mp4');
    expect(
      isInlineMediaThumbnail({
        type: 'asset_ref',
        asset_id: 'asset-up-3',
        media_type: 'video',
        display_label: 'c.mp4',
      }),
    ).toBe(true);
  });

  it('leaves an ordinary @ video without a playable URL as a text chip', () => {
    expect(
      isInlineMediaThumbnail({
        type: 'asset_ref',
        asset_id: 'video_plain',
        media_type: 'video',
        display_label: 'scene.mp4',
      }),
    ).toBe(false);
  });

  it('leaves a 商品卡 video with a URL as a text chip', () => {
    expect(
      isInlineMediaThumbnail({
        type: 'video',
        source: 'card-image',
        media_type: 'video',
        url: 'https://cdn.example/product.mp4',
        display_label: '商品视频',
        resource_type: '商品卡',
        asset_id: 'asset-product-inline',
      }),
    ).toBe(false);
  });
});
