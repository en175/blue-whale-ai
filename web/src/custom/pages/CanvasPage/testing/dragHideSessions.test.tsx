// @vitest-environment jsdom
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { canvasToolSessionFixture } from './canvasToolSessionFixture';
import type { CanvasToolKind } from '../tool-runtime/canvasToolSessions';

const ANCHOR_ID: Record<CanvasToolKind, string> = {
  erase: 'image',
  cutout: 'image',
  crop: 'image',
  outpaint: 'image',
  subtitleErase: 'video',
  audioVideoSplit: 'video',
  audioTrim: 'audio',
  audioMix: 'audio',
  audioSpeed: 'audio',
  sceneSplit: 'video',
  vocalSplit: 'video',
  smartMatting: 'video',
  audioVideoMux: 'mux-1',
  imageEnhance: 'imageEnhance',
  videoEnhance: 'videoEnhance',
  frameInterpolation: 'frameInterpolation',
};

function renderedDialog(elements: ReactNode[]): ReactElement<{ dragHidden?: boolean }> {
  const entry = elements.find(
    (el) => isValidElement<{ children: ReactNode }>(el) && el.props.children,
  );
  expect(entry).toBeTruthy();
  return (entry as ReactElement<{ children: ReactElement<{ dragHidden?: boolean }> }>).props.children;
}

describe('IKJR9J 工具会话锚定浮层拖拽隐藏接线', () => {
  it.each(Object.keys(ANCHOR_ID) as CanvasToolKind[])(
    '%s：锚定卡在被拖集合 → dragHidden=true；拖别的卡 → false',
    (kind) => {
      const f = canvasToolSessionFixture();
      f.launch[kind]();
      expect(f.tools.entries[kind].handle.getSnapshot().state).not.toBeNull();

      f.view.dragHiddenIds = new Set([ANCHOR_ID[kind]]);
      expect(renderedDialog(f.tools.render()).props.dragHidden).toBe(true);

      f.view.dragHiddenIds = new Set(['other-card']);
      expect(renderedDialog(f.tools.render()).props.dragHidden).toBe(false);

      f.view.dragHiddenIds = null;
      expect(renderedDialog(f.tools.render()).props.dragHidden).toBe(false);
    },
  );

  it.each(['crop', 'outpaint'] as const)('%s 画布层框随锚定卡拖拽携带 dragHidden', (kind) => {
    const f = canvasToolSessionFixture();
    f.launch[kind]();
    const layer = kind === 'crop'
      ? () => f.tools.canvasLayers().cropFrame
      : () => f.tools.canvasLayers().outpaintFrame;

    f.view.dragHiddenIds = new Set(['image']);
    expect(layer()).toMatchObject({ dragHidden: true });

    f.view.dragHiddenIds = new Set(['other-card']);
    expect(layer()).toMatchObject({ dragHidden: false });

    f.view.dragHiddenIds = null;
    expect(layer()).toMatchObject({ dragHidden: false });
  });
});
