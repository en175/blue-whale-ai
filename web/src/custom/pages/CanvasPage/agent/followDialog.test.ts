import { describe, expect, it } from 'vitest';
import { anchoredOverlayStyle, computeFollowAnchorAbove } from './followDialog';






describe('IKGYYD computeFollowAnchorAbove（卡片上方居中锚定）', () => {
  const base = {
    nodeX: 100,
    nodeY: 200,
    nodeWidth: 400,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerWidth: 1200,
    toolbarHalfWidth: 200,
    toolbarLift: 52,
  };

  it('默认场景：left 为节点中心点屏幕 x（不钳制），top 为卡片顶边上方抬升量', () => {
    expect(computeFollowAnchorAbove(base)).toEqual({ left: 300, top: 148 });
  });

  it('zoom 与视口平移参与位置换算：中心与顶边按同一变换走', () => {
    expect(computeFollowAnchorAbove({ ...base, viewport: { x: 50, y: 30, zoom: 2 } })).toEqual({
      left: (100 + 400 / 2) * 2 + 50,
      top: 200 * 2 + 30 - 52,
    });
  });

  it('缩放不影响尺寸：lift 与半宽是屏幕像素常量，缩小画布时不随 zoom 缩小', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeX: 500, viewport: { x: 0, y: 0, zoom: 0.5 } })).toEqual({
      left: (500 + 400 / 2) * 0.5,
      top: 200 * 0.5 - 52,
    });
  });

  it('水平左钳：节点中心越出左侧时 left 钳到 FOLLOW_PAD + 半宽', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeX: -600 })).toEqual({ left: 12 + 200, top: 148 });
  });

  it('水平右钳：节点中心越出右侧时 left 钳到 containerWidth - 半宽 - FOLLOW_PAD', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeX: 1000 })).toEqual({ left: 1200 - 200 - 12, top: 148 });
  });

  it('容器窄于钳制区间时左界优先（防负区间，口径同 computeFollowAnchor）', () => {
    expect(computeFollowAnchorAbove({ ...base, containerWidth: 300 })).toEqual({ left: 212, top: 148 });
  });

  it('垂直钳顶：卡片顶到视口上方时 top 不小于 8（不被容器裁掉）', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeY: -200 }).top).toBe(8);
    expect(computeFollowAnchorAbove({ ...base, nodeY: 0, toolbarLift: 100 }).top).toBe(8);
  });

  it('垂直向下不钳制：卡片在视口中下部时 top 按公式原样输出', () => {
    expect(computeFollowAnchorAbove({ ...base, nodeY: 900 }).top).toBe(900 - 52);
  });

  it('结果四舍五入为整数（非整数 zoom/平移换算）', () => {
    expect(computeFollowAnchorAbove({ ...base, viewport: { x: 13.7, y: 0.4, zoom: 1.1 } })).toEqual({
      left: Math.round((100 + 200) * 1.1 + 13.7),
      top: Math.round(200 * 1.1 + 0.4 - 52),
    });
  });

  it('缺省估半宽为 341（IKHK7N+IKHLKR：高清 ▾ 实测 564px 与智能抠像 ▾ 约 106px 并存，估约 670px，真实半宽约 335）', () => {
    const { toolbarHalfWidth: _omit, ...noHalfWidth } = base;

    expect(computeFollowAnchorAbove({ ...noHalfWidth, nodeX: -600 })).toEqual({ left: 12 + 341, top: 148 });
    expect(computeFollowAnchorAbove({ ...noHalfWidth, nodeX: 1000 })).toEqual({ left: 1200 - 341 - 12, top: 148 });
  });
});




describe('IKJR9J anchoredOverlayStyle（锚定浮层根样式）', () => {
  const anchor = { left: 120, top: 340 };

  it('无锚点且不隐藏：返回 undefined（沿用原行为，不落 style 对象）', () => {
    expect(anchoredOverlayStyle(null)).toBeUndefined();
    expect(anchoredOverlayStyle(null, false)).toBeUndefined();
  });

  it('有锚点不隐藏：仅定位，不带 visibility', () => {
    expect(anchoredOverlayStyle(anchor)).toEqual({ left: 120, top: 340 });
    expect(anchoredOverlayStyle(anchor, false)).toEqual({ left: 120, top: 340 });
  });

  it('有锚点且拖拽隐藏：定位保留 + visibility:hidden（不卸载、不改布局）', () => {
    expect(anchoredOverlayStyle(anchor, true)).toEqual({ left: 120, top: 340, visibility: 'hidden' });
  });

  it('无锚点但拖拽隐藏：仍输出 visibility:hidden（锚点暂缺时不错过隐藏帧）', () => {
    expect(anchoredOverlayStyle(null, true)).toEqual({ visibility: 'hidden' });
  });
});
