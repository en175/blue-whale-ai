// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaNode from './index';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

let root: Root;
let mountNode: HTMLDivElement;

function labels() {
  return [...mountNode.querySelectorAll('button')].map((button) => button.textContent?.trim() || button.getAttribute('title') || '');
}

async function renderNode(
  mediaType: 'image' | 'video' | 'audio',
  extra?: {
    id?: string;
    selected?: boolean;
    genStatus?: 'generating' | 'failed' | 'cancelled';
    progress?: number;
  },
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(MediaNode, {
        id: extra?.id ?? `${mediaType}-node`,
        data: {
          mediaType,
          src: 'blob:test',
          fileName: `${mediaType}.bin`,
          genStatus: extra?.genStatus,
          progress: extra?.progress,
        },
        selected: extra?.selected ?? true,
        type: 'mediaNode',
        dragging: false,
        zIndex: 1,
        selectable: true,
        deletable: true,
        draggable: true,
        isConnectable: true,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('MediaNode selected toolbar', () => {
  it('hides @, generate-image and generate-video on an audio node', async () => {
    await renderNode('audio');
    expect(labels()).toEqual(['重新编辑', '详情', '下载']);
  });

  it('keeps @ and generate actions on an image node', async () => {
    await renderNode('image');
    expect(labels()).toEqual(['重新编辑', '生成图片', '生成视频', '详情', '下载', '添加到 Agent 聊天']);
  });

  it('keeps @ and generate-video on a video node', async () => {
    await renderNode('video');
    expect(labels()).toEqual(['重新编辑', '生成视频', '提取音频', '详情', '下载', '添加到 Agent 聊天']);
  });
});

describe('MediaNode generating overlay', () => {
  it('hides fake progress copy and bar for image generation, keeps cancel', async () => {
    await renderNode('image', { genStatus: 'generating', progress: 0, selected: false });
    expect(mountNode.textContent).not.toContain('正在生成');
    expect(mountNode.textContent).not.toContain('0%');
    expect(mountNode.querySelector('[role="progressbar"]')).toBeNull();
    expect(labels()).toEqual(['取消生成']);
  });

  it('hides fake progress copy and bar for video generation, keeps cancel', async () => {
    await renderNode('video', { genStatus: 'generating', progress: 0, selected: false });
    expect(mountNode.textContent).not.toContain('正在生成');
    expect(mountNode.textContent).not.toContain('0%');
    expect(mountNode.querySelector('[role="progressbar"]')).toBeNull();
    expect(labels()).toEqual(['取消生成']);
  });

  it('keeps extract progress copy and bar for audio extraction', async () => {
    await renderNode('audio', {
      id: 'media-extract-job-1',
      genStatus: 'generating',
      progress: 42,
      selected: false,
    });
    expect(mountNode.textContent).toContain('正在提取音频 42%');
    expect(mountNode.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');
    expect(labels()).not.toContain('取消生成');
  });
});
