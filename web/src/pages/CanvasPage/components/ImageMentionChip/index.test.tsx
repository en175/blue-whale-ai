// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageMentionChip } from './index';

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
      createElement(ImageMentionChip, {
        url: 'https://cdn.example/cat.png',
        label: 'cat.png',
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

describe('ImageMentionChip', () => {
  it('renders the original image as a small thumbnail in the capsule', async () => {
    await renderChip();
    const thumb = mountNode.querySelector('img');
    expect(thumb?.getAttribute('src')).toBe('https://cdn.example/cat.png');
    expect(mountNode.textContent).toContain('cat.png');
  });

  it('shows a remove control only when the composer asks for one', async () => {
    await renderChip();
    expect(mountNode.querySelector('button')).toBeNull();
    await renderChip(() => {});
    expect(mountNode.querySelector('button')?.getAttribute('aria-label')).toBe('移除 cat.png');
  });
});
