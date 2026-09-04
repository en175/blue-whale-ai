// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import styles from '../../index.module.css';
import { AssetMedia } from './index';

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
