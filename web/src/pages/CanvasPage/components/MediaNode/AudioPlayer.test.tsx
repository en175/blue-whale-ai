// @vitest-environment jsdom
/* IKHB08 审查修复（Important 测试缺口）：AudioPlayer 截取编辑态试听钳制的最小组件
   测试——进入编辑态暂停+播放头归零、选区变化暂停+挤出钳回边界、点播放从选区头
   起播（播放头停在选区尾再点同分支归选区头重播）、rAF tick 播放推进越过选区尾自动
   停且播放头停终点。
   手法沿用目录先例：vi.spyOn(HTMLMediaElement.prototype, 'play'/'pause')（jsdom 不
   加载媒体；桩内同步维护实例 paused 供组件 a.paused 分支判定），currentTime 以实例
   defineProperty 覆盖；rAF 以 stubGlobal 换成手动队列、驱动一帧即一拍（tick 自续
   注册进新队列）。
   覆盖边界（如实声明）：真实 16ms 帧节奏与 timeupdate 事件路径未覆盖（jsdom 无媒体
   时钟，tick 分支靠手动驱动等价覆盖）；波形解码未覆盖（fetch 桩失败走兜底波形，与本
   组断言无关）。渲染模式沿用 AudioTrimOverlay.test.tsx（createRoot + act）。 */
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

/** 覆盖实例 currentTime（jsdom 原型 getter/setter 换成普通可写属性，直读直写）。 */
function stubCurrentTime(el: HTMLAudioElement, value: number) {
  Object.defineProperty(el, 'currentTime', { configurable: true, writable: true, value });
}

function renderPlayer(trimSelection: AudioPlayerTrimSelection | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  return act(() => {
    root!.render(
      createElement(AudioPlayer, { src: 'http://aud/trim.mp3', duration: 30, trimSelection }),
    );
  });
}

/** 同一 root 二次 render 触发 trimSelection 变化（进入编辑态 / 拖抓手改选区路径）。 */
function rerenderPlayer(trimSelection: AudioPlayerTrimSelection | null) {
  return act(() => {
    root!.render(
      createElement(AudioPlayer, { src: 'http://aud/trim.mp3', duration: 30, trimSelection }),
    );
  });
}

/** 驱动一帧 rAF：取走当前队列逐个执行（tick 执行中自续注册进新队列）。 */
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
  // 桩内同步维护实例 paused：play → false、pause → true（组件以 a.paused 判定播放态）
  playMock = spyPlay().mockImplementation(function (this: HTMLAudioElement) {
    Object.defineProperty(this, 'paused', { configurable: true, get: () => false });
    return Promise.resolve();
  });
  pauseMock = spyPause().mockImplementation(function (this: HTMLAudioElement) {
    Object.defineProperty(this, 'paused', { configurable: true, get: () => true });
  });
  // 波形解码 fetch 直接失败走兜底波形（避免真实网络请求，断言无关）
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  // rAF 换手动队列：注册进队列，driveFrame 推进
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
    // 建立播放中状态（paused=false 由 play 桩维护），推进到 3s
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
    audio.currentTime = 8; // 播放推进到选区内 8s
    pauseMock.mockClear();
    rerenderPlayer({ start: 1, end: 5 }); // 收窄到 [1,5]，8 被挤出
    expect(pauseMock).toHaveBeenCalled();
    expect(audio.currentTime).toBe(5);
  });

  it('编辑态点播放：播放头在选区外（< start）时从选区头起播', async () => {
    await renderPlayer({ start: 5, end: 8 });
    const audio = audioEl();
    stubCurrentTime(audio, 0); // 进入编辑态归零后停在选区外（0 < 5）
    await act(async () => {
      clickPlayButton();
    });
    expect(audio.currentTime).toBe(5);
    expect(playMock).toHaveBeenCalled();
  });

  it('播放推进越过选区尾：自动停且播放头停终点；再点播放从选区头重播', async () => {
    await renderPlayer({ start: 5, end: 8 });
    const audio = audioEl();
    stubCurrentTime(audio, 0);
    await act(async () => {
      clickPlayButton(); // 从选区头 5 起播（playing=true，rAF effect 注册 tick）
    });
    expect(audio.currentTime).toBe(5);
    audio.currentTime = 8.2; // 一帧内推进越过选区尾
    pauseMock.mockClear();
    await driveFrame();
    expect(pauseMock).toHaveBeenCalled(); // 到尾自动停
    expect(audio.currentTime).toBe(8); // 播放头停终点
    // 真实浏览器 pause 派发 onPause → setPlaying(false)；jsdom 桩不派发，手动补齐
    await act(async () => {
      audio.dispatchEvent(new Event('pause', { bubbles: true }));
    });
    await act(async () => {
      clickPlayButton(); // 播放头停在终点（>= end）再点 → 归选区头重播
    });
    expect(audio.currentTime).toBe(5);
  });
});
