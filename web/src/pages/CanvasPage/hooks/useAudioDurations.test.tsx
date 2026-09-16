// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  useAudioDurations,
  type AudioDurationSource,
} from './useAudioDurations';

let root: Root | null;
let container: HTMLDivElement;
let result = new Map<string, number>();

class ControlledAudio {
  static instances: ControlledAudio[] = [];

  duration = Number.NaN;
  preload = '';
  private currentSrc = '';
  requestedSrc = '';
  loadCalls = 0;
  srcRemoved = false;
  private listeners = new Set<() => void>();
  private allListeners: Array<() => void> = [];

  set src(value: string) {
    this.currentSrc = value;
    if (value) this.requestedSrc = value;
  }

  get src() {
    return this.currentSrc;
  }

  constructor() {
    ControlledAudio.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'loadedmetadata') {
      this.listeners.add(listener as () => void);
      this.allListeners.push(listener as () => void);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'loadedmetadata') this.listeners.delete(listener as () => void);
  }

  removeAttribute(name: string) {
    if (name === 'src') {
      this.src = '';
      this.srcRemoved = true;
    }
  }

  load() {
    this.loadCalls += 1;
  }

  complete(duration: number) {
    this.duration = duration;
    for (const listener of [...this.listeners]) listener();
  }

  completeLate(duration: number) {
    this.duration = duration;
    for (const listener of this.allListeners) listener();
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

const a = { key: 'a', src: 'https://example.com/a.mp3' };
const b = { key: 'b', src: 'https://example.com/b.mp3' };

function Probe({ sources }: { sources: readonly AudioDurationSource[] }) {
  result = useAudioDurations(sources);
  return null;
}

function audioFor(src: string) {
  const audio = ControlledAudio.instances.find((candidate) => candidate.requestedSrc === src);
  if (!audio) throw new Error(`未找到 ${src} 的 Audio 探测实例`);
  return audio;
}

async function render(sources: readonly AudioDurationSource[]) {
  await act(async () => {
    root!.render(createElement(Probe, { sources }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ControlledAudio.instances = [];
  result = new Map();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.Audio = ControlledAudio as unknown as typeof Audio;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe('useAudioDurations', () => {
  it('首次探测尚未完成时追加来源，保留原来源并收集两者时长', async () => {
    await render([a]);
    await render([a, b]);

    await act(async () => {
      audioFor(a.src).complete(12);
      audioFor(b.src).complete(34);
    });

    expect([...result]).toEqual([
      ['a', 12],
      ['b', 34],
    ]);
    expect(audioFor(a.src).listenerCount).toBe(0);
    expect(audioFor(a.src).srcRemoved).toBe(true);
    expect(audioFor(a.src).loadCalls).toBe(1);
  });

  it('StrictMode 首次 effect 重建后仍可完成探测', async () => {
    await act(async () => {
      root!.render(createElement(StrictMode, null, createElement(Probe, { sources: [a] })));
    });

    const active = ControlledAudio.instances.at(-1)!;
    await act(async () => active.complete(12));

    expect(result.get('a')).toBe(12);
    expect(ControlledAudio.instances).toHaveLength(2);
  });

  it('同 key 更换地址时只接收新地址时长，旧事件迟到不污染', async () => {
    const replacement = { key: 'a', src: 'https://example.com/a-v2.mp3' };
    await render([a]);
    const oldAudio = audioFor(a.src);
    await render([replacement]);

    await act(async () => {
      oldAudio.completeLate(99);
      audioFor(replacement.src).complete(56);
    });

    expect([...result]).toEqual([['a', 56]]);
    expect(oldAudio.listenerCount).toBe(0);
    expect(oldAudio.loadCalls).toBe(1);
  });

  it('删除来源会释放探测并拒绝已删除资源的迟到事件', async () => {
    await render([a]);
    const removedAudio = audioFor(a.src);
    await render([]);

    await act(async () => removedAudio.completeLate(12));

    expect(result.has('a')).toBe(false);
    expect(removedAudio.listenerCount).toBe(0);
    expect(removedAudio.srcRemoved).toBe(true);
    expect(removedAudio.loadCalls).toBe(1);
  });

  it('卸载会释放全部未完成探测并拒绝迟到事件', async () => {
    await render([a, b]);
    const pending = [...ControlledAudio.instances];

    await act(async () => root!.unmount());
    root = null;
    await act(async () => pending.forEach((audio) => audio.completeLate(88)));

    for (const audio of pending) {
      expect(audio.listenerCount).toBe(0);
      expect(audio.srcRemoved).toBe(true);
      expect(audio.loadCalls).toBe(1);
    }
  });

  it('重排已完成来源时复用时长缓存且不重新探测', async () => {
    await render([a, b]);
    await act(async () => {
      audioFor(a.src).complete(12);
      audioFor(b.src).complete(34);
    });
    const probeCount = ControlledAudio.instances.length;

    await render([b, a]);

    expect(ControlledAudio.instances).toHaveLength(probeCount);
    expect([...result]).toEqual([
      ['a', 12],
      ['b', 34],
    ]);
  });
});
