/* IKGGCT T1：画布拖拽对齐吸附纯函数——六种对齐关系、屏幕阈值与 zoom 换算、
 * 双轴独立、多目标取最近、参考块收集（排除被拖集合、组框整体、尺寸回退）、
 * 对齐线区间（两块投影联合跨度的贯穿长线） */
import { describe, expect, it } from 'vitest';
import {
  collectSnapTargets,
  computeSnapAlignment,
  SNAP_THRESHOLD_PX,
  type SnapNodeLike,
  type SnapRect,
  type SnapTarget,
} from './snapAlignment';

function rect(x: number, y: number, width: number, height: number): SnapRect {
  return { x, y, width, height };
}

function target(id: string, x: number, y: number, width: number, height: number): SnapTarget {
  return { id, rect: rect(x, y, width, height) };
}

/** 主拖卡基准：100×80，左上角在原点（中心 (50,40)，右边 100，下边 80） */
const MAIN = rect(0, 0, 100, 80);

describe('computeSnapAlignment：六种对齐关系', () => {
  it('垂直中线对垂直中线：dx 把主拖卡拉向参考块（右侧为正、左侧为负）', () => {
    const right = computeSnapAlignment(MAIN, [target('ref', 5, 30, 100, 80)]);
    expect(right.dx).toBe(5);
    expect(right.dy).toBe(0);
    expect(right.guides).toHaveLength(1);
    expect(right.guides[0].relation).toBe('centerX');
    expect(right.guides[0].orientation).toBe('vertical');
    expect(right.guides[0].pos).toBe(55);

    const left = computeSnapAlignment(MAIN, [target('ref', -5, 30, 100, 80)]);
    expect(left.dx).toBe(-5);
    expect(left.guides[0].pos).toBe(45);
  });

  it('左边缘贴左边缘：主拖卡左边被拉到参考块左边', () => {
    const res = computeSnapAlignment(MAIN, [target('ref', 3, 50, 60, 50)]);
    expect(res.dx).toBe(3);
    expect(res.dy).toBe(0);
    expect(res.guides[0].relation).toBe('left');
    expect(res.guides[0].pos).toBe(3);
  });

  it('右边缘贴右边缘：参考块在左侧时主拖卡被向左拉', () => {
    const res = computeSnapAlignment(MAIN, [target('ref', 37, 50, 60, 50)]);
    expect(res.dx).toBe(-3);
    expect(res.guides[0].relation).toBe('right');
    expect(res.guides[0].pos).toBe(97);
  });

  it('水平中线对水平中线：dy 把主拖卡拉向参考块（下方为正、上方为负）', () => {
    const below = computeSnapAlignment(MAIN, [target('ref', 25, 20, 20, 44)]);
    expect(below.dy).toBe(2);
    expect(below.dx).toBe(0);
    expect(below.guides[0].relation).toBe('centerY');
    expect(below.guides[0].orientation).toBe('horizontal');
    expect(below.guides[0].pos).toBe(42);

    const above = computeSnapAlignment(MAIN, [target('ref', 25, 14, 20, 50)]);
    expect(above.dy).toBe(-1);
    expect(above.guides[0].pos).toBe(39);
  });

  it('上边缘贴上边缘：主拖卡上边被拉到参考块上边', () => {
    const res = computeSnapAlignment(MAIN, [target('ref', 25, 3, 20, 100)]);
    expect(res.dy).toBe(3);
    expect(res.guides[0].relation).toBe('top');
    expect(res.guides[0].pos).toBe(3);
  });

  it('下边缘贴下边缘：参考块在上方时主拖卡被向上拉', () => {
    const res = computeSnapAlignment(MAIN, [target('ref', 25, 25, 20, 52)]);
    expect(res.dy).toBe(-3);
    expect(res.guides[0].relation).toBe('bottom');
    expect(res.guides[0].pos).toBe(77);
  });
});

describe('computeSnapAlignment：屏幕阈值与 zoom 换算', () => {
  it('屏幕距离等于阈值（默认 8px）吸附，略大于不吸附', () => {
    expect(SNAP_THRESHOLD_PX).toBe(8);
    const hit = computeSnapAlignment(MAIN, [target('ref', 8, 50, 60, 50)]);
    expect(hit.dx).toBe(8);
    expect(hit.guides).toHaveLength(1);

    const miss = computeSnapAlignment(MAIN, [target('ref', 8.5, 50, 60, 50)]);
    expect(miss.dx).toBe(0);
    expect(miss.guides).toHaveLength(0);
  });

  it('zoom=2 时画布坐标阈值 = 4：画布距离 4 吸附、5 不吸附', () => {
    const hit = computeSnapAlignment(MAIN, [target('ref', 4, 50, 60, 50)], { zoom: 2 });
    expect(hit.dx).toBe(4);

    const miss = computeSnapAlignment(MAIN, [target('ref', 5, 50, 60, 50)], { zoom: 2 });
    expect(miss.dx).toBe(0);
    expect(miss.guides).toHaveLength(0);
  });

  it('zoom=0.5 时画布坐标阈值 = 16：同一画布距离 zoom=1 不吸附、zoom=0.5 吸附', () => {
    const atZoom1 = computeSnapAlignment(MAIN, [target('ref', 10, 50, 40, 50)]);
    expect(atZoom1.dx).toBe(0);

    const atZoom05 = computeSnapAlignment(MAIN, [target('ref', 10, 50, 40, 50)], { zoom: 0.5 });
    expect(atZoom05.dx).toBe(10);
  });

  it('阈值像素可传入覆盖：thresholdPx=20 时画布距离 10 吸附', () => {
    const res = computeSnapAlignment(MAIN, [target('ref', 10, 50, 40, 50)], { thresholdPx: 20 });
    expect(res.dx).toBe(10);
  });
});

describe('computeSnapAlignment：双轴独立', () => {
  it('垂直与水平同时命中时同时修正并产生两条对齐线', () => {
    const res = computeSnapAlignment(MAIN, [target('ref', 3, 4, 100, 80)]);
    expect(res.dx).toBe(3);
    expect(res.dy).toBe(4);
    expect(res.guides).toHaveLength(2);
    const vertical = res.guides.find((g) => g.orientation === 'vertical');
    const horizontal = res.guides.find((g) => g.orientation === 'horizontal');
    expect(vertical?.relation).toBe('centerX');
    expect(horizontal?.relation).toBe('centerY');
  });

  it('两轴命中可来自不同参考块，各自取最近', () => {
    const res = computeSnapAlignment(MAIN, [
      target('xSource', 2, 200, 60, 50),
      target('ySource', 300, 5, 60, 50),
    ]);
    expect(res.dx).toBe(2);
    expect(res.dy).toBe(5);
    expect(res.guides.map((g) => g.targetId).sort()).toEqual(['xSource', 'ySource']);
  });
});

describe('computeSnapAlignment：多目标命中', () => {
  it('取屏幕距离最近者（与传入顺序无关）', () => {
    const res = computeSnapAlignment(MAIN, [
      target('far', 6, 50, 60, 50),
      target('near', 2, 50, 60, 50),
    ]);
    expect(res.dx).toBe(2);
    expect(res.guides[0].targetId).toBe('near');
  });

  it('跨对齐关系也取最近者：left 距离 1 胜过 centerX 距离 3', () => {
    const res = computeSnapAlignment(MAIN, [
      target('byCenter', -27, 50, 160, 50),
      target('byLeft', 1, 50, 60, 50),
    ]);
    expect(res.dx).toBe(1);
    expect(res.guides[0].targetId).toBe('byLeft');
    expect(res.guides[0].relation).toBe('left');
  });
});

describe('computeSnapAlignment：对齐线区间', () => {
  it('区间 = 正交方向两块投影的联合跨度：贯穿两块的长线（09-17 人工回归拍板）', () => {
    // y 向命中（centerY）：线段沿 x，主拖卡 [0,100] 与参考块 [40,140] 联合 [0,140]
    const res = computeSnapAlignment(MAIN, [target('ref', 40, -3, 100, 80)]);
    expect(res.guides).toEqual([
      { orientation: 'horizontal', pos: 37, from: 0, to: 140, targetId: 'ref', relation: 'centerY' },
    ]);
  });

  it('正交方向无重叠（两卡错开）时区间跨越两卡之间全部间隙，两端贴两卡外侧边缘', () => {
    // x 投影 [0,100] 与 [150,250] 无重叠：区间 = 联合跨度 [0,250]
    const res = computeSnapAlignment(MAIN, [target('ref', 150, -3, 100, 80)]);
    expect(res.guides).toEqual([
      { orientation: 'horizontal', pos: 37, from: 0, to: 250, targetId: 'ref', relation: 'centerY' },
    ]);
  });
});

describe('computeSnapAlignment：无命中', () => {
  it('远离所有参考块或参考块为空时返回零修正与空对齐线', () => {
    const far = computeSnapAlignment(MAIN, [target('ref', 500, 500, 100, 80)]);
    expect(far).toEqual({ dx: 0, dy: 0, guides: [] });

    const empty = computeSnapAlignment(MAIN, []);
    expect(empty).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe('collectSnapTargets：参考块收集', () => {
  it('排除被拖集合：一起拖动的多张卡互不为参考', () => {
    const nodes: SnapNodeLike[] = [
      { id: 'a', position: { x: 0, y: 0 }, measured: { width: 100, height: 80 } },
      { id: 'b', position: { x: 200, y: 0 }, measured: { width: 100, height: 80 } },
      { id: 'c', position: { x: 30, y: 40 }, measured: { width: 100, height: 80 } },
    ];
    expect(collectSnapTargets(nodes, ['a', 'b'])).toEqual([{ id: 'c', rect: rect(30, 40, 100, 80) }]);
  });

  it('groupFrame 伪节点整体矩形作为一个参考块，可被吸附命中', () => {
    const frame: SnapNodeLike = {
      id: 'g1',
      type: 'groupFrame',
      position: { x: 10, y: 20 },
      measured: { width: 200, height: 150 },
    };
    const card: SnapNodeLike = {
      id: 'c1',
      type: 'mediaNode',
      position: { x: 300, y: 40 },
      measured: { width: 100, height: 80 },
    };
    const targets = collectSnapTargets([card, frame], new Set(['dragging']));
    expect(targets).toEqual([
      { id: 'c1', rect: rect(300, 40, 100, 80) },
      { id: 'g1', rect: rect(10, 20, 200, 150) },
    ]);

    // 主拖卡左边距组框左边 3px（≤8px）→ 吸附到组框，对齐线归属 g1
    const res = computeSnapAlignment(rect(7, 300, 60, 50), targets);
    expect(res.dx).toBe(3);
    expect(res.guides[0].targetId).toBe('g1');
    expect(res.guides[0].relation).toBe('left');
  });

  it('无 measured 回退节点 width/height（measured 优先）；两者皆无则跳过', () => {
    const nodes: SnapNodeLike[] = [
      { id: 'n1', position: { x: 0, y: 0 }, width: 120, height: 90 },
      { id: 'n2', position: { x: 0, y: 0 }, width: 999, height: 999, measured: { width: 200, height: 150 } },
      { id: 'n3', position: { x: 0, y: 0 } },
    ];
    expect(collectSnapTargets(nodes, [])).toEqual([
      { id: 'n1', rect: rect(0, 0, 120, 90) },
      { id: 'n2', rect: rect(0, 0, 200, 150) },
    ]);
  });
});
