// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoMentionChip } from './index';

vi.mock('@floating-ui/react', () => ({
  FloatingPortal: ({ children }: { children: unknown }) => children,
  autoUpdate: () => () => {},
  flip: () => ({}),
  offset: () => ({}),
  safePolygon: () => ({}),
  shift: () => ({}),
  useFloating: () => ({
    refs: { setReference: () => {}, setFloating: () => {} },
    floatingStyles: {},
    context: {},
  }),
  useFocus: () => ({}),
  useHover: () => ({}),
  useInteractions: () => ({ getReferenceProps: () => ({}), getFloatingProps: () => ({}) }),
}));

let root: Root;
let mountNode: HTMLDivElement;

async function renderChip(onRemove?: () => void) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(VideoMentionChip, {
        url: 'https://cdn.example/clip.mp4',
        label: 'clip.mp4',
        onRemove,
      }),
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

describe('VideoMentionChip', () => {
  it('renders the original video as a small thumbnail in the capsule', async () => {
    await renderChip();
    const thumb = mountNode.querySelector('video');
    expect(thumb?.getAttribute('src')).toBe('https://cdn.example/clip.mp4');
    expect((thumb as HTMLVideoElement).muted).toBe(true);
    expect(mountNode.textContent).toContain('clip.mp4');
  });

  it('shows a remove control only when the composer asks for one', async () => {
    await renderChip();
    expect(mountNode.querySelector('button')).toBeNull();
    await renderChip(() => {});
    expect(mountNode.querySelector('button')?.getAttribute('aria-label')).toBe('移除 clip.mp4');
  });
});
