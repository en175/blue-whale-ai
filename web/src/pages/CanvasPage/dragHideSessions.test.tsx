// @vitest-environment jsdom
/* IKJR9J 工具会话层：16 种工具的锚定浮层按「锚定卡 id ∈ 被拖集合（view.dragHiddenIds）」
 * 收到 dragHidden=true（visibility 级隐藏的接线）；拖别的卡（锚定卡不在集合中）一律
 * false——面板/发送条原地不动不隐藏。裁切/扩图的画布层（cropFrame/outpaintFrame）
 * 同口径携带 dragHidden。dialog 组件内部把 dragHidden 落到根 style 由
 * followDialog.anchoredOverlayStyle 单测与各组件渲染先例兜底。 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { canvasToolSessionFixture } from './testing/canvasToolSessionFixture';
import type { CanvasToolKind } from './canvasToolSessions';

/** 各工具的锚定卡 id（fixture 画布口径）：多数为 state.nodeId，
 *  混合为 sourceNodeId、合成为草稿卡 draftId（open 后从会话状态读取）。 */
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

/** render() 输出中唯一非空工具界面（与 canvasToolSessions.test.tsx 同口径拾取） */
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
