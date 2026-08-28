// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroVideoCarousel, {
  HERO_PRELOAD_LEAD_SECONDS,
  HERO_TRANSITION_LEAD_SECONDS,
  HERO_TRANSITION_MS,
} from './index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ReducedMotionListener = (event: MediaQueryListEvent) => void;

let container: HTMLDivElement;
let root: Root;
let idleCallback: IdleRequestCallback;
let observerCallback: IntersectionObserverCallback;
let reducedMotion = false;
let reducedMotionListeners: Set<ReducedMotionListener>;
let playMock: ReturnType<typeof vi.spyOn>;
let pauseMock: ReturnType<typeof vi.spyOn>;
let loadMock: ReturnType<typeof vi.spyOn>;
let rootMounted: boolean;

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0.1];

  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}

function visibilityEntry(isIntersecting: boolean): IntersectionObserverEntry {
  const target = container.querySelector('[data-testid="hero-video-carousel"]') as Element;
  return {
    boundingClientRect: target.getBoundingClientRect(),
    intersectionRatio: isIntersecting ? 1 : 0,
    intersectionRect: target.getBoundingClientRect(),
    isIntersecting,
    rootBounds: null,
    target,
    time: 0,
  };
}

async function mountCarousel() {
  await act(async () => {
    root.render(
      createElement(HeroVideoCarousel, null, createElement('span', null, '首页内容')),
    );
  });
  act(() => {
    observerCallback([visibilityEntry(true)], {} as IntersectionObserver);
    idleCallback({ didTimeout: false, timeRemaining: () => 50 });
  });
  await act(async () => undefined);
  return Array.from(container.querySelectorAll('video'));
}

function setPlaybackPosition(video: HTMLVideoElement, duration: number, currentTime: number) {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: currentTime });
  Object.defineProperty(video, 'ended', { configurable: true, value: currentTime >= duration && duration > 0 });
}

async function emit(video: HTMLVideoElement, eventName: string) {
  await act(async () => {
    video.dispatchEvent(new Event(eventName));
  });
}

describe('HeroVideoCarousel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    rootMounted = true;
    reducedMotion = false;
    reducedMotionListeners = new Set();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      idleCallback = callback;
      return 1;
    }));
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: reducedMotion,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: ReducedMotionListener) => {
        reducedMotionListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: ReducedMotionListener) => {
        reducedMotionListeners.delete(listener);
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })));

    playMock = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pauseMock = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    loadMock = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    if (rootMounted) await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads only the current video until the preload window', async () => {
    const videos = await mountCarousel();

    expect(videos).toHaveLength(2);
    expect(videos[0].getAttribute('src')).toContain('desert.mp4');
    expect(videos[1].hasAttribute('src')).toBe(false);
    expect(loadMock).toHaveBeenCalled();
    expect(playMock).toHaveBeenCalled();

    await emit(videos[0], 'canplay');

    setPlaybackPosition(videos[0], 5, 5 - HERO_PRELOAD_LEAD_SECONDS - 0.1);
    await emit(videos[0], 'timeupdate');
    expect(videos[1].hasAttribute('src')).toBe(false);

    setPlaybackPosition(videos[0], 5, 5 - HERO_PRELOAD_LEAD_SECONDS + 0.1);
    await emit(videos[0], 'timeupdate');
    expect(videos[1].getAttribute('src')).toContain('ocean.mp4');
    expect(videos.every((video) => !video.getAttribute('src')?.includes('color-burst.mp4'))).toBe(true);
  });

  it('does not reload the current source when it becomes ready', async () => {
    const videos = await mountCarousel();
    loadMock.mockClear();

    await emit(videos[0], 'canplay');

    expect(loadMock).not.toHaveBeenCalled();
    expect(videos[0].getAttribute('src')).toContain('desert.mp4');
    expect(videos[1].hasAttribute('src')).toBe(false);
  });

  it('ignores incomplete duration metadata instead of advancing immediately', async () => {
    const videos = await mountCarousel();
    await emit(videos[0], 'canplay');

    setPlaybackPosition(videos[0], 1, 0);
    await emit(videos[0], 'timeupdate');
    expect(videos[1].hasAttribute('src')).toBe(false);

    setPlaybackPosition(videos[0], Number.NaN, 0);
    await emit(videos[0], 'timeupdate');
    expect(videos[1].hasAttribute('src')).toBe(false);
  });

  it('crossfades with two slots, unloads the old source, and keeps playlist order', async () => {
    const videos = await mountCarousel();
    await emit(videos[0], 'canplay');
    setPlaybackPosition(videos[0], 5, 4.2);
    await emit(videos[0], 'timeupdate');
    await emit(videos[1], 'canplay');

    expect(videos[0].getAttribute('src')).toContain('desert.mp4');
    expect(videos[1].getAttribute('src')).toContain('ocean.mp4');
    expect(videos[0].className).toContain('videoVisible');
    expect(videos[1].className).not.toContain('videoVisible');

    setPlaybackPosition(videos[0], 5, 5 - HERO_TRANSITION_LEAD_SECONDS + 0.01);
    await emit(videos[0], 'timeupdate');
    expect(videos[1].className).toContain('videoVisible');

    await act(async () => vi.advanceTimersByTime(HERO_TRANSITION_MS));
    expect(videos[0].hasAttribute('src')).toBe(false);
    expect(videos[1].getAttribute('src')).toContain('ocean.mp4');

    setPlaybackPosition(videos[1], 5, 4.2);
    await emit(videos[1], 'timeupdate');
    expect(videos[0].getAttribute('src')).toContain('color-burst.mp4');
    await emit(videos[0], 'canplay');
    setPlaybackPosition(videos[1], 5, 5 - HERO_TRANSITION_LEAD_SECONDS + 0.01);
    await emit(videos[1], 'timeupdate');
    await act(async () => vi.advanceTimersByTime(HERO_TRANSITION_MS));
    expect(videos[1].hasAttribute('src')).toBe(false);
    expect(videos[0].getAttribute('src')).toContain('color-burst.mp4');

    setPlaybackPosition(videos[0], 5, 4.2);
    await emit(videos[0], 'timeupdate');
    expect(videos[1].getAttribute('src')).toContain('desert.mp4');
  });

  it('pauses outside the viewport and when the page is hidden', async () => {
    const videos = await mountCarousel();
    await emit(videos[0], 'canplay');
    pauseMock.mockClear();

    act(() => observerCallback([visibilityEntry(false)], {} as IntersectionObserver));
    expect(pauseMock).toHaveBeenCalled();

    act(() => observerCallback([visibilityEntry(true)], {} as IntersectionObserver));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(pauseMock).toHaveBeenCalled();
  });

  it('uses the first poster and unloads video sources for reduced motion', async () => {
    const videos = await mountCarousel();
    expect(videos[0].getAttribute('src')).toContain('desert.mp4');

    reducedMotion = true;
    act(() => {
      reducedMotionListeners.forEach((listener) => listener({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
      } as MediaQueryListEvent));
    });
    await act(async () => undefined);

    expect(videos.every((video) => !video.hasAttribute('src'))).toBe(true);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('desert-poster.jpg');
  });

  it('does not attach any video source when reduced motion is enabled initially', async () => {
    reducedMotion = true;
    const videos = await mountCarousel();

    expect(videos.every((video) => !video.hasAttribute('src'))).toBe(true);
    expect(playMock).not.toHaveBeenCalled();
    expect(container.querySelector('img')?.getAttribute('src')).toContain('desert-poster.jpg');
  });

  it('cleans the transition timer and media elements when unmounted', async () => {
    const videos = await mountCarousel();
    await emit(videos[0], 'canplay');
    setPlaybackPosition(videos[0], 5, 4.2);
    await emit(videos[0], 'timeupdate');
    await emit(videos[1], 'canplay');
    setPlaybackPosition(videos[0], 5, 5 - HERO_TRANSITION_LEAD_SECONDS + 0.01);
    await emit(videos[0], 'timeupdate');
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await act(async () => root.unmount());
    rootMounted = false;

    expect(vi.getTimerCount()).toBe(0);
    expect(pauseMock).toHaveBeenCalled();
  });

  it('contains autoplay rejection without interrupting the carousel', async () => {
    playMock.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    const videos = await mountCarousel();

    await expect(emit(videos[0], 'canplay')).resolves.toBeUndefined();
    expect(container.textContent).toContain('首页内容');
  });
});
