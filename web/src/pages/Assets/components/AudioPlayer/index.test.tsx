// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioPlayer, { type AudioPlayerHandle } from './index';

let root: Root;
let mountNode: HTMLDivElement;
let playMock: ReturnType<typeof vi.spyOn>;
let pauseMock: ReturnType<typeof vi.spyOn>;

async function renderPlayer(
  props: { variant?: 'compact' | 'full' } = {},
  ref?: React.RefObject<AudioPlayerHandle | null>,
  onParentClick?: () => void,
  onParentPointerDown?: () => void,
) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(
      'div',
      { onClick: onParentClick, onPointerDown: onParentPointerDown },
      createElement(AudioPlayer, { src: 'https://example.test/sample.mp3', ref, ...props }),
    ));
  });
}

function dispatchMediaEvent(audio: HTMLAudioElement, type: string) {
  audio.dispatchEvent(new Event(type, { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  playMock = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pauseMock = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(async () => {
  playMock.mockRestore();
  pauseMock.mockRestore();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('AudioPlayer', () => {
  it('plays, shows metadata duration, and updates the elapsed time', async () => {
    await renderPlayer();
    const audio = mountNode.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 125 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });

    await act(async () => {
      dispatchMediaEvent(audio, 'loadedmetadata');
    });
    expect(mountNode.textContent).toContain('0:00');
    expect(mountNode.textContent).toContain('2:05');

    const audioWave = mountNode.querySelector('[data-testid="audio-wave"]') as HTMLDivElement;
    expect(audioWave.querySelector('svg')).toBeNull();
    expect(mountNode.querySelector('[data-testid="audio-controls"]')).not.toBeNull();
    const playButton = mountNode.querySelector('button[aria-label="播放"]') as HTMLButtonElement;
    await act(async () => playButton.click());
    expect(playMock).toHaveBeenCalledTimes(1);
    const idleWaveClass = audioWave.className;
    await act(async () => dispatchMediaEvent(audio, 'play'));
    expect(audioWave.className).not.toBe(idleWaveClass);

    audio.currentTime = 62;
    await act(async () => dispatchMediaEvent(audio, 'timeupdate'));
    expect(mountNode.textContent).toContain('1:02');
  });

  it('exposes an operable keyboard progress control', async () => {
    await renderPlayer();
    const audio = mountNode.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 30 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
    await act(async () => dispatchMediaEvent(audio, 'loadedmetadata'));

    const progress = mountNode.querySelector('[role="slider"]') as HTMLDivElement;
    await act(async () => {
      progress.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(audio.currentTime).toBe(5);
    expect(progress.getAttribute('aria-valuetext')).toBe('0:05 / 0:30');
  });

  it('lets the containing card preview and stop compact audio through its handle', async () => {
    const playerRef = createRef<AudioPlayerHandle>();
    await renderPlayer({ variant: 'compact' }, playerRef);
    const audio = mountNode.querySelector('audio') as HTMLAudioElement;
    expect(mountNode.querySelectorAll('[data-testid="audio-wave-bar"]').length).toBe(9);
    expect(mountNode.querySelector('[data-testid="audio-compact-controls"]')).not.toBeNull();
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 12 });

    await act(async () => {
      playerRef.current?.startPreview();
    });
    expect(playMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      playerRef.current?.stopPreview();
    });
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(0);
  });

  it('keeps timeline interactions inside the audio player instead of opening its card', async () => {
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();
    await renderPlayer({ variant: 'compact' }, undefined, parentClick, parentPointerDown);
    const audio = mountNode.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 30 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
    await act(async () => dispatchMediaEvent(audio, 'loadedmetadata'));

    const progress = mountNode.querySelector('[role="slider"]') as HTMLDivElement;
    Object.defineProperty(progress, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 100 }),
    });
    await act(async () => {
      progress.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      progress.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
