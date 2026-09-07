// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import MediaNode, { type MediaGenStatus } from './index';

let root: Root;
let mountNode: HTMLDivElement;

function labels() {
  return [...mountNode.querySelectorAll('button')].map((button) => button.textContent?.trim() || button.getAttribute('title') || '');
}

interface RenderExtra {
  id?: string;
  selected?: boolean;
  genStatus?: MediaGenStatus;
  progress?: number;
  errorText?: string;
  data?: Record<string, unknown>;
}

async function renderNode(
  mediaType: 'image' | 'video' | 'audio',
  extra?: RenderExtra,
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(ReactFlowProvider, null, createElement(MediaNode, {
        id: extra?.id ?? `${mediaType}-node`,
        data: {
          mediaType,
          src: 'blob:test',
          fileName: `${mediaType}.bin`,
          genStatus: extra?.genStatus,
          progress: extra?.progress,
          errorText: extra?.errorText,
          ...extra?.data,
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
      } as never)),
    );
  });
}

/** 图片/视频新布局：外部标题行与内容主体（与 e2e 共用 data-testid 锚点） */
function contentCard(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-content"]') as HTMLElement;
}

function titleRow(): HTMLElement {
  return mountNode.querySelector('[data-testid="media-title"]') as HTMLElement;
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

describe('MediaNode draft overlay (IKDMQQ)', () => {
  it('待生成草稿：渲染待生成占位而非素材已被删除，无取消/重试按钮', async () => {
    await renderNode('image', { genStatus: 'draft', selected: false, data: { src: '', draft: true } });
    expect(mountNode.textContent).toContain('待生成');
    expect(mountNode.textContent).not.toContain('素材已被删除');
    expect(mountNode.textContent).not.toContain('取消生成');
    expect(mountNode.textContent).not.toContain('重试');
  });

  it('待生成草稿：选中态不显示媒体工具条（无有效素材可操作）', async () => {
    await renderNode('image', { genStatus: 'draft', selected: true, data: { src: '', draft: true } });
    expect(labels()).toEqual([]);
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

  it('重新生成中的成品卡继续显示旧素材并叠加状态角标（IKDMQU Q5）', async () => {
    await renderNode('image', {
      genStatus: 'generating',
      progress: 30,
      selected: false,
      data: { src: 'http://img/old.png', fileName: '生成-j1', jobId: 'j1' },
    });
    const overlay = mountNode.querySelector('[data-testid="regen-overlay"]');
    expect(overlay).toBeTruthy();
    expect(overlay!.textContent).toContain('重新生成中 30%');
    expect(overlay!.textContent).toContain('取消');
    expect(mountNode.querySelector('img')?.getAttribute('src')).toBe('http://img/old.png');
  });
});

describe('MediaNode failed overlay', () => {
  it('shows the backend error message instead of 生成失败 for image cards', async () => {
    await renderNode('image', {
      genStatus: 'failed',
      errorText: '账户余额不足，请充值后重试',
      selected: false,
    });
    expect(mountNode.textContent).toContain('账户余额不足，请充值后重试');
    expect(mountNode.textContent).not.toContain('生成失败');
    expect(labels()).toEqual(['重试']);
  });

  it('falls back to 生成失败 when the video card has no backend message', async () => {
    await renderNode('video', { genStatus: 'failed', selected: false });
    expect(mountNode.textContent).toContain('生成失败');
    expect(labels()).toEqual(['重试']);
  });

  it('shows the backend error message for media extraction without duplicating 音频提取失败', async () => {
    await renderNode('audio', {
      id: 'media-extract-job-1',
      genStatus: 'failed',
      errorText: '视频没有音轨',
      selected: false,
    });
    expect(mountNode.textContent).toContain('视频没有音轨');
    expect(mountNode.textContent).not.toContain('音频提取失败');
    expect(labels()).not.toContain('重试');
  });
});

describe('MediaNode external title (image/video)', () => {
  it('shows real resolution for images without file size', async () => {
    await renderNode('image', {
      selected: false,
      data: { fileName: 'photo.png', width: 1600, height: 900, size: 2.4 * 1024 * 1024 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('photo.png');
    expect(title).toContain('1600×900');
    expect(title).not.toContain('MB');
  });

  it('shows resolution and duration for videos', async () => {
    await renderNode('video', {
      selected: false,
      data: { fileName: 'clip.mp4', width: 1920, height: 1080, duration: 12.4, size: 8 * 1024 * 1024 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('1920×1080');
    expect(title).toContain('12s');
    expect(title).not.toContain('MB');
  });

  it('leaves meta blank when real dims are missing', async () => {
    await renderNode('image', { selected: false, data: { fileName: 'unknown.png' } });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('unknown.png');
    expect(title).not.toContain('×');
  });

  it('never shows the target ratio as resolution', async () => {
    await renderNode('image', {
      selected: false,
      genStatus: 'generating',
      data: { fileName: '图片生成中', targetRatio: '16:9' },
    });
    const title = titleRow().textContent ?? '';
    expect(title).not.toContain('16:9');
    expect(title).not.toContain('×');
  });

  it('still shows known real dims on a failed node (缺失项留空，已知项照显)', async () => {
    await renderNode('video', {
      selected: false,
      genStatus: 'failed',
      data: { width: 1920, height: 1080, duration: 8 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('1920×1080');
    expect(title).toContain('8s');
  });

  it('sizes the content body by real dims and ignores title/toolbar', async () => {
    await renderNode('image', {
      selected: false,
      data: { width: 1600, height: 900 },
    });
    const card = contentCard();
    expect(parseFloat(card.style.width)).toBeCloseTo(497.8, 1);
    expect(parseFloat(card.style.height)).toBeCloseTo(280, 1);
  });

  it('sizes a generating placeholder by targetRatio, else 280×280', async () => {
    await renderNode('image', {
      selected: false,
      genStatus: 'generating',
      data: { targetRatio: '16:9' },
    });
    expect(parseFloat(contentCard().style.width)).toBeCloseTo(497.8, 1);
    expect(parseFloat(contentCard().style.height)).toBeCloseTo(280, 1);

    await renderNode('video', { selected: false, genStatus: 'generating' });
    expect(parseFloat(contentCard().style.width)).toBeCloseTo(280, 1);
    expect(parseFloat(contentCard().style.height)).toBeCloseTo(280, 1);
  });

  it('keeps the known shape on failure', async () => {
    await renderNode('video', {
      selected: false,
      genStatus: 'failed',
      data: { targetRatio: '9:16' },
    });
    expect(parseFloat(contentCard().style.width)).toBeCloseTo(280, 1);
    expect(parseFloat(contentCard().style.height)).toBeCloseTo(497.8, 1);
  });
});

describe('MediaNode audio layout', () => {
  it('uses the external title and content body like image/video', async () => {
    await renderNode('audio', { selected: false, data: { fileName: '配音.wav', duration: 37.6 } });
    expect(titleRow().textContent).toContain('配音.wav');
    expect(contentCard()).toBeTruthy();
  });

  it('shows only the real duration in the title, never size or resolution', async () => {
    await renderNode('audio', {
      selected: false,
      data: { fileName: '配音.wav', duration: 37.6, size: 4.2 * 1024 * 1024, width: 1600, height: 900 },
    });
    const title = titleRow().textContent ?? '';
    expect(title).toContain('38s');
    expect(title).not.toContain('MB');
    expect(title).not.toContain('×');
  });

  it('leaves the title meta blank when duration is unknown', async () => {
    await renderNode('audio', { selected: false, data: { fileName: '配音.wav' } });
    const meta = titleRow().lastElementChild?.textContent ?? '';
    expect(meta.trim()).toBe('');
  });

  it('keeps the content body square regardless of dims or target ratio', async () => {
    await renderNode('audio', { selected: false, data: { width: 1600, height: 900, targetRatio: '16:9' } });
    expect(parseFloat(contentCard().style.width)).toBe(280);
    expect(parseFloat(contentCard().style.height)).toBe(280);
  });

  it('keeps player controls reachable and out of the node drag path', async () => {
    await renderNode('audio', { selected: false });
    const audio = mountNode.querySelector('audio');
    expect(audio).toBeTruthy();
    expect(audio!.getAttribute('controls')).not.toBeNull();
    expect(audio!.className).toContain('nodrag');
  });

  it('keeps the square body for generating, failed and missing audio', async () => {
    await renderNode('audio', { selected: false, genStatus: 'generating', progress: 0 });
    expect(parseFloat(contentCard().style.width)).toBe(280);
    expect(parseFloat(contentCard().style.height)).toBe(280);

    await renderNode('audio', { selected: false, genStatus: 'failed', errorText: '视频没有音轨' });
    expect(mountNode.textContent).toContain('视频没有音轨');
    expect(parseFloat(contentCard().style.height)).toBe(280);

    await renderNode('audio', { selected: false, data: { assetMissing: true } });
    expect(mountNode.textContent).toContain('素材已被删除');
    expect(parseFloat(contentCard().style.height)).toBe(280);
  });
});

describe('MediaNode browser-measured dims fill-in', () => {
  it('reports real image dims on load when missing', async () => {
    const onMediaDims = vi.fn();
    await renderNode('image', { selected: false, data: { onMediaDims } });
    const img = mountNode.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 1600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    await act(async () => {
      img.dispatchEvent(new Event('load'));
    });
    expect(onMediaDims).toHaveBeenCalledWith('image-node', { width: 1600, height: 900 });
  });

  it('does not report when dims already match', async () => {
    const onMediaDims = vi.fn();
    await renderNode('image', { selected: false, data: { width: 1600, height: 900, onMediaDims } });
    const img = mountNode.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 1600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    await act(async () => {
      img.dispatchEvent(new Event('load'));
    });
    expect(onMediaDims).not.toHaveBeenCalled();
  });

  it('reports video dims and duration on loadedmetadata when duration missing', async () => {
    const onMediaDims = vi.fn();
    await renderNode('video', { selected: false, data: { width: 1920, height: 1080, onMediaDims } });
    const video = mountNode.querySelector('video')!;
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    Object.defineProperty(video, 'duration', { value: 12.4, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(onMediaDims).toHaveBeenCalledWith('video-node', { width: 1920, height: 1080, duration: 12.4 });
  });
});
