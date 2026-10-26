// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerAttachmentChip } from './ComposerAttachmentChip';

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

async function renderChip(
  props: Parameters<typeof ComposerAttachmentChip>[0],
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(ComposerAttachmentChip, props));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('ComposerAttachmentChip', () => {
  it('shows an image thumbnail while a sidebar upload is still in flight', async () => {
    await renderChip({
      name: 'shot.png',
      mediaType: 'image',
      status: 'uploading',
      url: 'blob:https://localhost/shot',
      onRemove: () => {},
    });
    expect(mountNode.querySelector('[data-testid="image-mention"]')?.textContent).toBe('shot.png');
    expect(mountNode.textContent).toContain('上传中…');
    expect(mountNode.textContent).not.toContain('图片：');
  });

  it('shows a video thumbnail for a sidebar upload', async () => {
    await renderChip({
      name: 'clip.mp4',
      mediaType: 'video',
      status: 'ready',
      url: 'https://cdn.example/clip.mp4',
      onRemove: () => {},
    });
    expect(mountNode.querySelector('[data-testid="video-mention"]')?.textContent).toBe('clip.mp4');
    expect(mountNode.textContent).not.toContain('视频：');
  });
});
