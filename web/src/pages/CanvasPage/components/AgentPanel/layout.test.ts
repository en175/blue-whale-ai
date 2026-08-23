import { describe, expect, it } from 'vitest';
import { dockedPanelLayout, freePanelLayout, getPanelLayout, PANEL_MARGIN } from './layout';

describe('getPanelLayout', () => {
  it('keeps the initial panel inside a narrow viewport', () => {
    expect(
      getPanelLayout({
        pageWidth: 320,
        pageHeight: 520,
        headerHeight: 56,
        panelWidth: 304,
        panelHeight: 600,
        desiredX: 500,
        desiredY: 500,
      }),
    ).toEqual({ x: 8, y: 64, height: 448 });
  });

  it('does not subtract the header twice when clamping floating y', () => {
    expect(
      getPanelLayout({
        pageWidth: 1200,
        pageHeight: 800,
        headerHeight: 64,
        panelWidth: 400,
        panelHeight: 500,
        desiredX: 900,
        desiredY: 700,
      }),
    ).toEqual({ x: 792, y: 292, height: 500 });
  });
});

/**
 * 固定模式与浮动模式此前内联在组件里，测不到——「贴右上角、撑满可用高度」这条规则
 * 有两份逐字相同的副本，改一处漏一处（审查 W·S8）。抽出来之后钉在这里。
 */
describe('dockedPanelLayout', () => {
  const metrics = {
    pageWidth: 1200,
    pageHeight: 800,
    headerHeight: 64,
    panelWidth: 468,
    // 固定模式不看当前高度：给一个明显不对的值，结果也不该受它影响
    panelHeight: 123,
  };

  it('贴住右上角，两边各留一个 PANEL_MARGIN', () => {
    const layout = dockedPanelLayout(metrics);
    expect(layout.x).toBe(1200 - PANEL_MARGIN - 468);
    expect(layout.y).toBe(64 + PANEL_MARGIN);
  });

  it('高度撑满可用空间，而不是沿用当前高度', () => {
    // 可用高度 = 页高 - header - 上下各一个 margin
    expect(dockedPanelLayout(metrics).height).toBe(800 - 64 - PANEL_MARGIN * 2);
    // 传进去的 panelHeight: 123 不该影响结果
    expect(dockedPanelLayout({ ...metrics, panelHeight: 9999 })).toEqual(dockedPanelLayout(metrics));
  });

  it('窄视口下不横向溢出', () => {
    const layout = dockedPanelLayout({ ...metrics, pageWidth: 320, panelWidth: 468 });
    expect(layout.x).toBeGreaterThanOrEqual(0);
  });
});

describe('freePanelLayout', () => {
  const metrics = {
    pageWidth: 1200,
    pageHeight: 800,
    headerHeight: 64,
    panelWidth: 400,
    panelHeight: 500,
  };

  it('保留当前高度，位置照给', () => {
    expect(freePanelLayout(metrics, 300, 200)).toEqual({ x: 300, y: 200, height: 500 });
  });

  it('越界的位置被收回可视区', () => {
    const layout = freePanelLayout(metrics, 5000, 5000);
    expect(layout.x).toBe(1200 - PANEL_MARGIN - 400);
    expect(layout.y).toBe(800 - PANEL_MARGIN - 500);
  });

  it('与直接调 getPanelLayout 等价——它只是省掉那对重复的坐标字段', () => {
    expect(freePanelLayout(metrics, 300, 200)).toEqual(
      getPanelLayout({ ...metrics, desiredX: 300, desiredY: 200 }),
    );
  });
});
