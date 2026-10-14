// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FlowCanvas from './index';

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    toolMode: 'select', showMiniMap: false, showEdges: false, hideZoomControl: true,
    extraNodes: [], textNodes: [], productNodes: [], assetNodes: [],
    mediaNodes: [0, 1].map(i => ({
      id: `video-${i}`, type: 'mediaNode', position: { x: i * 350, y: 0 },
      data: { mediaType: 'video', src: `https://example.test/video-${i}.mp4`, width: 560, height: 752, duration: 5, fileName: `视频${i}`, onMediaDims: vi.fn() },
    })),
    edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(), onDeleteNode: vi.fn(),
    viewport: { x: 0, y: 0, zoom: 1 }, groups: [],
  };
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => { root.render(createElement(FlowCanvas, props)); });
}

it('视频成组与解组后保持已经解码的画面和有效播放源', async () => {
  await render();
  const videos = [...document.body.querySelectorAll<HTMLVideoElement>('div[aria-hidden="true"] > video')];
  expect(videos).toHaveLength(2);
  await act(async () => {
    for (const video of videos) {
      Object.defineProperties(video, {
        readyState: { configurable: true, value: 2 },
        videoWidth: { configurable: true, value: 560 },
        videoHeight: { configurable: true, value: 752 },
        duration: { configurable: true, value: 5 },
        currentTime: { configurable: true, writable: true, value: 0.04 },
      });
      video.dispatchEvent(new Event('loadeddata'));
    }
  });
  const sources = videos.map(video => video.querySelector('source')!.src);
  for (const groups of [[{ id: 'group-1', box: { x: -48, y: -48, w: 1000, h: 800 }, excludedIds: [] }], []]) {
    props = { ...props, groups, mediaNodes: props.mediaNodes.map(node => ({ ...node, data: { ...node.data } })) };
    await render();
    expect(container.querySelector('[data-testid="video-error-box"]')).toBeNull();
    const current = [...document.body.querySelectorAll<HTMLVideoElement>('div[aria-hidden="true"] > video')];
    expect(current.map(video => video.querySelector('source')!.src)).toEqual(sources);
    expect(current.map(video => video.readyState)).toEqual([2, 2]);
  }
  props = {
    ...props,
    mediaNodes: props.mediaNodes.map(node => ({
      ...node,
      data: { ...node.data, src: `https://example.test/replaced-${node.id}.mp4` },
    })),
  };
  await render();
  const rebuilt = [...document.body.querySelectorAll<HTMLVideoElement>('div[aria-hidden="true"] > video')];
  expect(rebuilt.map(video => video.querySelector('source')!.src)).toEqual([
    'https://example.test/replaced-video-0.mp4',
    'https://example.test/replaced-video-1.mp4',
  ]);
});

it('单视频仅等值 data 替换不重建解码器（最小场景）', async () => {
  props = { ...props, mediaNodes: props.mediaNodes.slice(0, 1) };
  await render();
  const videos = [...document.body.querySelectorAll<HTMLVideoElement>('div[aria-hidden="true"] > video')];
  expect(videos).toHaveLength(1);
  await act(async () => {
    Object.defineProperties(videos[0], {
      readyState: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 560 },
      videoHeight: { configurable: true, value: 752 },
      duration: { configurable: true, value: 5 },
      currentTime: { configurable: true, writable: true, value: 0.04 },
    });
    videos[0].dispatchEvent(new Event('loadeddata'));
  });
  props = { ...props, mediaNodes: props.mediaNodes.map(node => ({ ...node, data: { ...node.data } })) };
  await render();
  const current = [...document.body.querySelectorAll<HTMLVideoElement>('div[aria-hidden="true"] > video')];
  expect(current).toHaveLength(1);
  expect(current[0].querySelector('source')!.src).toBe(videos[0].querySelector('source')!.src);
  expect(current[0].readyState).toBe(2);
});
