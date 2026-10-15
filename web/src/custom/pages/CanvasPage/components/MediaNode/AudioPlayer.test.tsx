// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioPlayer, { type AudioPlayerTrimSelection } from './AudioPlayer';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let playMock: ReturnType<typeof spyPlay>;
let pauseMock: ReturnType<typeof spyPause>;
let rafQueue: FrameRequestCallback[] = [];

function spyPlay() {
  return vi.spyOn(HTMLMediaElement.prototype, 'play');
}
function spyPause() {
  return vi.spyOn(HTMLMediaElement.prototype, 'pause');
}

function audioEl(): HTMLAudioElement {
  return container!.querySelector('audio') as HTMLAudioElement;
}

function stubCurrentTime(el: HTMLAudioElement, value: number) {
  Object.defineProperty(el, 'currentTime', { configurable: true, writable: true, value });
}

type SpeedProps = { speedEditing?: boolean; speedFactor?: number; duration?: number };

function renderPlayer(trimSelection: AudioPlayerTrimSelection | null, speedProps?: SpeedProps) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(() => {
    root!.render(
      createElement(AudioPlayer, {
        src: 'http://aud/trim.mp3',
        duration: speedProps?.duration ?? 30,
        trimSelection,
        ...(speedProps?.speedEditing != null ? { speedEditing: speedProps.speedEditing } : {}),
        ...(speedProps?.speedFactor != null ? { speedFactor: speedProps.speedFactor } : {}),
      }),
    );
  });
}

function rerenderPlayer(trimSelection: AudioPlayerTrimSelection | null, speedProps?: SpeedProps) {
  return act(() => {
    root!.render(
      createElement(AudioPlayer, {
        src: 'http://aud/trim.mp3',
        duration: speedProps?.duration ?? 30,
        trimSelection,
        ...(speedProps?.speedEditing != null ? { speedEditing: speedProps.speedEditing } : {}),
        ...(speedProps?.speedFactor != null ? { speedFactor: speedProps.speedFactor } : {}),
      }),
    );
  });
}

function driveFrame() {
  return act(() => {
    rafQueue.splice(0).forEach((cb) => cb(0));
  });
}

function clickPlayButton() {
  const btn = container!.querySelector('button[aria-label="播放"]') as HTMLButtonElement;
  btn.click();
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  playMock = spyPlay().mockImplementation(function (this: HTMLAudioElement) {
    Object.defineProperty(this, 'paused', { configurable: true, get: () => false });
    return Promise.resolve();
  });
  pauseMock = spyPause().mockImplementation(function (this: HTMLAudioElement) {
    Object.defineProperty(this, 'paused', { configurable: true, get: () => true });
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  playMock.mockRestore();
  pauseMock.mockRestore();
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('AudioPlayer 截取编辑态试听钳制（IKHB7A）', () => {
  it('进入编辑态（null→选区）：播放中即暂停且播放头归零', () => {
    renderPlayer(null);
    const audio = audioEl();
    stubCurrentTime(audio, 0);
    act(() => {
      void audio.play();
    });
    audio.currentTime = 3;
    rerenderPlayer({ start: 5, end: 8 });
    expect(pauseMock).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(container!.textContent).toContain('0:00 / 0:30');
  });

  it('选区收窄把播放头挤出：暂停并钳回最近边界', () => {
    renderPlayer({ start: 1, end: 10 });
    const audio = audioEl();
    stubCurrentTime(audio, 0);
    act(() => {
      void audio.play();
    });
    audio.currentTime = 8;
    pauseMock.mockClear();
    rerenderPlayer({ start: 1, end: 5 });
    expect(pauseMock).toHaveBeenCalled();
    expect(audio.currentTime).toBe(5);
  });

  it('编辑态点播放：播放头在选区外（< start）时从选区头起播', async () => {
    await renderPlayer({ start: 5, end: 8 });
    const audio = audioEl();
    stubCurrentTime(audio, 0);
    await act(async () => {
      clickPlayButton();
    });
    expect(audio.currentTime).toBe(5);
    expect(playMock).toHaveBeenCalled();
  });

  it('播放中父级重渲染传「值相同、引用不同」选区：不应暂停', async () => {
    await renderPlayer({ start: 5, end: 8 });
    const audio = audioEl();
    stubCurrentTime(audio, 0);
    await act(async () => {
      clickPlayButton();
    });
    expect(audio.currentTime).toBe(5);
    pauseMock.mockClear();
    rerenderPlayer({ start: 5, end: 8 });
    expect(pauseMock).not.toHaveBeenCalled();
  });

  it('播放推进越过选区尾：自动停且播放头停终点；再点播放从选区头重播', async () => {
    await renderPlayer({ start: 5, end: 8 });
    const audio = audioEl();
    stubCurrentTime(audio, 0);
    await act(async () => {
      clickPlayButton();
    });
    expect(audio.currentTime).toBe(5);
    audio.currentTime = 8.2;
    pauseMock.mockClear();
    await driveFrame();
    expect(pauseMock).toHaveBeenCalled();
    expect(audio.currentTime).toBe(8);
    await act(async () => {
      audio.dispatchEvent(new Event('pause', { bubbles: true }));
    });
    await act(async () => {
      clickPlayButton();
    });
    expect(audio.currentTime).toBe(5);
  });
});

describe('AudioPlayer 调速编辑态时间行折算（IKHVYO 审查修复：round 口径）', () => {
  it('编辑态 12s @1.35x：总时长折算 12/1.35≈8.89 → round 显示 0:09（规格用户故事 23 例证）', () => {
    renderPlayer(null, { duration: 12, speedEditing: true, speedFactor: 1.35 });
    expect(container!.textContent).toContain('0:00 / 0:09');
  });

  it('编辑态播放中当前位同口径折算：源推进到 12s @1.35x → 当前位也显示 0:09', async () => {
    await renderPlayer(null, { duration: 12, speedEditing: true, speedFactor: 1.35 });
    const audio = audioEl();
    stubCurrentTime(audio, 0);
    await act(async () => {
      clickPlayButton();
    });
    audio.currentTime = 12;
    await driveFrame();
    expect(container!.textContent).toContain('0:09 / 0:09');
  });

  it('非编辑态保持既有 floor 显示，退出编辑态恢复源时长：12.6s → 0:12（round 会得 0:13，锁口径不外溢）', () => {
    renderPlayer(null, { duration: 12.6 });
    expect(container!.textContent).toContain('0:00 / 0:12');
    rerenderPlayer(null, { duration: 12.6, speedEditing: true, speedFactor: 1.35 });
    expect(container!.textContent).toContain('0:00 / 0:09');
    rerenderPlayer(null, { duration: 12.6 });
    expect(container!.textContent).toContain('0:00 / 0:12');
  });
});
