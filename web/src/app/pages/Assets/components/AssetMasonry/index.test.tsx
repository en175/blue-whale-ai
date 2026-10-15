// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRecord } from '@/app/api/assets';
import styles from '../../index.module.css';
import { AssetCard, AssetMedia } from './index';

let root: Root;
let mountNode: HTMLDivElement;
let pauseMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  pauseMock = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(async () => {
  pauseMock.mockRestore();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('AssetMedia', () => {
  const videoAsset = {
    id: 'video',
    type: 'video' as const,
    url: 'https://example.test/video.mp4',
    width: 1920,
    height: 1080,
    duration: 60,
    source: null,
    model: null,
    created_at: null,
  };

  async function renderMedia(asset: typeof videoAsset) {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(AssetMedia, { asset }));
    });
  }

  it('removes the audio skeleton when metadata was already cached before effects run', async () => {
    const mediaPrototype = HTMLMediaElement.prototype;
    const readyStateDescriptor = Object.getOwnPropertyDescriptor(mediaPrototype, 'readyState');
    const durationDescriptor = Object.getOwnPropertyDescriptor(mediaPrototype, 'duration');
    Object.defineProperty(mediaPrototype, 'readyState', {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_METADATA,
    });
    Object.defineProperty(mediaPrototype, 'duration', {
      configurable: true,
      get: () => 90,
    });

    try {
      mountNode = document.createElement('div');
      document.body.appendChild(mountNode);
      root = createRoot(mountNode);
      await act(async () => {
        root.render(createElement(AssetMedia, {
          asset: {
            id: 'cached-audio',
            type: 'audio',
            url: 'https://example.test/cached.mp3',
            width: null,
            height: null,
            duration: null,
            source: null,
            model: null,
            created_at: null,
          },
        }));
      });

      expect(mountNode.querySelector(`.${styles.audioMediaSkeleton}`)).toBeNull();
      expect(mountNode.textContent).toContain('1:30');
    } finally {
      if (readyStateDescriptor) Object.defineProperty(mediaPrototype, 'readyState', readyStateDescriptor);
      else Reflect.deleteProperty(mediaPrototype, 'readyState');
      if (durationDescriptor) Object.defineProperty(mediaPrototype, 'duration', durationDescriptor);
      else Reflect.deleteProperty(mediaPrototype, 'duration');
    }
  });

  it('keeps the video skeleton hidden after its first frame has loaded', async () => {
    await renderMedia(videoAsset);
    const video = mountNode.querySelector('video') as HTMLVideoElement;
    expect(mountNode.querySelector(`.${styles.mediaSkeleton}`)).not.toBeNull();

    await act(async () => {
      video.dispatchEvent(new Event('loadeddata', { bubbles: true }));
    });

    expect(mountNode.querySelector(`.${styles.mediaSkeleton}`)).toBeNull();
  });

  it('replaces a failed video skeleton with the retry state', async () => {
    await renderMedia(videoAsset);
    const video = mountNode.querySelector('video') as HTMLVideoElement;

    await act(async () => {
      video.dispatchEvent(new Event('error', { bubbles: true }));
    });

    expect(mountNode.querySelector(`.${styles.mediaSkeleton}`)).toBeNull();
    expect(mountNode.textContent).toContain('加载失败');
  });
});

describe('AssetCard 悬浮操作（IKGHZ3）', () => {
  const imageAsset: AssetRecord = {
    id: 'a1',
    type: 'image',
    url: 'https://example.test/a.jpg',
    width: 100,
    height: 80,
    duration: null,
    source: null,
    model: null,
    created_at: null,
  };

  async function renderCard(props: {
    onPreview?: (asset: AssetRecord) => void;
    onDelete?: (asset: AssetRecord) => void;
    onToggleSelect?: (asset: AssetRecord) => void;
  }) {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(AssetCard, {
        asset: imageAsset,
        selected: false,
        ...props,
      }));
    });
    return mountNode.querySelector(`.${styles.card}`) as HTMLElement;
  }

  it('多选模式渲染删除与放大按钮，点放大调 onPreview 不触发勾选', async () => {
    const onPreview = vi.fn();
    const onToggleSelect = vi.fn();
    const card = await renderCard({ onPreview, onDelete: vi.fn(), onToggleSelect });

    const deleteBtn = card.querySelector<HTMLButtonElement>('button[title="删除资产"]');
    const previewBtn = card.querySelector<HTMLButtonElement>('button[title="放大预览"]');
    expect(deleteBtn).not.toBeNull();
    expect(previewBtn).not.toBeNull();

    await act(async () => { previewBtn!.click(); });
    expect(onPreview).toHaveBeenCalledWith(imageAsset);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('多选模式点删除调 onDelete 不触发勾选', async () => {
    const onDelete = vi.fn();
    const onToggleSelect = vi.fn();
    const card = await renderCard({ onDelete, onToggleSelect });

    await act(async () => { card.querySelector<HTMLButtonElement>('button[title="删除资产"]')!.click(); });

    expect(onDelete).toHaveBeenCalledWith(imageAsset);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('非多选模式（资产页）渲染删除按钮但不渲染放大按钮', async () => {
    const card = await renderCard({ onPreview: vi.fn(), onDelete: vi.fn() });

    expect(card.querySelector('button[title="删除资产"]')).not.toBeNull();
    expect(card.querySelector('button[title="放大预览"]')).toBeNull();
  });

  it('音频卡片多选模式同样渲染删除与放大按钮（故事12）', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    const audioAsset: AssetRecord = {
      ...imageAsset,
      id: 'a2',
      type: 'audio',
      url: 'https://example.test/a.mp3',
      width: null,
      height: null,
      duration: 30,
    };
    await act(async () => {
      root.render(createElement(AssetCard, {
        asset: audioAsset,
        selected: false,
        onDelete: vi.fn(),
        onToggleSelect: vi.fn(),
        onPreview: vi.fn(),
      }));
    });
    const card = mountNode.querySelector(`.${styles.card}`) as HTMLElement;
    expect(card.querySelector('button[title="删除资产"]')).not.toBeNull();
    expect(card.querySelector('button[title="放大预览"]')).not.toBeNull();
  });
});
