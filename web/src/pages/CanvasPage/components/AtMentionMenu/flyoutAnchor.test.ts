import { describe, expect, it } from 'vitest';
import { computeFlyoutOffset } from './flyoutAnchor';

/** 主面板：视口顶部 300，高 242（搜索框 36 + 间距 + 小标题 + 四行分类 + 内边距） */
const panel = { panelTop: 300, panelHeight: 242 };
/** 「文本」行是最后一行，顶部相对面板 72 + 3×38 = 186 */
const textRow = { ...panel, rowTop: 486 };

describe('computeFlyoutOffset', () => {
  it('子菜单顶部对齐触发它的分类行顶部', () => {
    expect(computeFlyoutOffset({ ...textRow, flyoutHeight: 56 })).toBe(186);
  });

  it('对齐后子菜单的垂直范围覆盖触发它的那一行', () => {
    const offset = computeFlyoutOffset({ ...textRow, flyoutHeight: 56 });
    const rowTopInPanel = textRow.rowTop - panel.panelTop;
    expect(offset).toBeLessThanOrEqual(rowTopInPanel);
    expect(offset + 56).toBeGreaterThanOrEqual(rowTopInPanel + 38);
  });

  it('上方的分类行对应更小的偏移', () => {
    const image = computeFlyoutOffset({ ...panel, rowTop: 372, flyoutHeight: 56 });
    expect(image).toBe(72);
    expect(image).toBeLessThan(computeFlyoutOffset({ ...textRow, flyoutHeight: 56 }));
  });

  it('下方放不下时整体上移，子菜单不越出面板底部', () => {
    const offset = computeFlyoutOffset({ ...textRow, flyoutHeight: 232 });
    expect(offset).toBe(10);
    expect(offset + 232).toBe(panel.panelHeight);
  });

  it('子菜单比面板还高时退回顶部对齐', () => {
    expect(computeFlyoutOffset({ ...textRow, flyoutHeight: 300 })).toBe(0);
  });

  it('触发行就在面板顶部时不需要偏移', () => {
    expect(computeFlyoutOffset({ ...panel, rowTop: 300, flyoutHeight: 56 })).toBe(0);
  });
});
