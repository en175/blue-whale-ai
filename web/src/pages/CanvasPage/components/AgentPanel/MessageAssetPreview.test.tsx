// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageAssetPreview } from './MessageAssetPreview';

vi.mock('@/api/assets', () => ({
  fetchAllAssets: async () => [],
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
