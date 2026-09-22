/* IKGOT8 擦除遮罩纯逻辑测试（vitest 纯 node 环境，无 jsdom）：
 * 显示坐标→源图自然分辨率换算（取整/钳位/像素对齐）、笔迹与框的并集叠加、
 * 橡皮差集（只减已涂区）、撤销/重做小栈（含框固化后状态）、
 * 栅格化输出尺寸=自然分辨率与黑白语义锁死（涂区=白 255=擦除、未涂=黑 0=保留）。
 * 规格见 docs/specs/2026-09-18-image-erase-mediakit.md「Implementation Decisions 前端·遮罩模型」。
 * 黑白方向的依据说明：火山官方 PDF（/tmp/mediakit-erase-api.txt）仅说 mask_url 为
 * 「黑白遮罩图，指定需要擦除的任意形状区域」，未规定白/黑哪侧代表擦除；本模块按
 * 修复类接口通行惯例取「白=擦除区域、黑=保留区域」，用常量锁死语义，见模块头注释。 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_MASK_EDIT,
  MASK_PIXEL_ERASED,
  MASK_PIXEL_KEPT,
  applyMaskOp,
  canRedoMaskEdit,
  canUndoMaskEdit,
  displayPointToNatural,
  displayRadiusToNatural,
  displayRectToNatural,
  rasterizeMask,
  redoMaskEdit,
  undoMaskEdit,
  type MaskCoordinateSpace,
  type MaskOp,
  type MaskPoint,
  type MaskRasterSink,
  type MaskRectOp,
  type MaskStrokeOp,
} from './eraseMask';

/* ============ 测试辅助（就地构造，不依赖环境） ============ */

function pt(x: number, y: number): MaskPoint {
  return { x, y };
}

function paintStroke(points: MaskPoint[], radius: number): MaskStrokeOp {
  return { kind: 'stroke', erase: false, points, radius };
}

function eraseStroke(points: MaskPoint[], radius: number): MaskStrokeOp {
  return { kind: 'stroke', erase: true, points, radius };
}

function paintRect(x1: number, y1: number, x2: number, y2: number): MaskRectOp {
  return { kind: 'rect', erase: false, from: pt(x1, y1), to: pt(x2, y2) };
}

function eraseRect(x1: number, y1: number, x2: number, y2: number): MaskRectOp {
  return { kind: 'rect', erase: true, from: pt(x1, y1), to: pt(x2, y2) };
}

/** 坐标空间：displayWidth×displayHeight 显示区域 → naturalWidth×naturalHeight 源图自然分辨率 */
function spaceOf(dw: number, dh: number, nw: number, nh: number): MaskCoordinateSpace {
  return { displayWidth: dw, displayHeight: dh, naturalWidth: nw, naturalHeight: nh };
}

const IDENTITY = spaceOf(100, 100, 100, 100); // 显示尺寸=自然分辨率（换算恒等基准）
const DOUBLE = spaceOf(100, 100, 200, 200); // 2 倍放大（小卡大图）
const FRACTIONAL = spaceOf(300, 200, 1000, 666); // 非整比例（取整路径）

/* 记录型 sink：断言栅格化发出的指令序列（外部可观察行为） */
type RecordedCall =
  | { kind: 'fillRect'; x: number; y: number; width: number; height: number; value: number }
  | { kind: 'strokePath'; points: MaskPoint[]; radius: number; value: number };

function recorderSink(): { sink: MaskRasterSink; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    sink: {
      fillRect: (x, y, width, height, value) => {
        calls.push({ kind: 'fillRect', x, y, width, height, value });
      },
      strokePath: (points, radius, value) => {
        calls.push({ kind: 'strokePath', points: points.map((p) => ({ ...p })), radius, value });
      },
    },
  };
}

/* 内存光栅 sink：Uint8Array 网格 + 像素中心采样（中心 (i+0.5, j+0.5) 距折线 ≤ 半径即覆盖），
 * 独立于产品代码实现，用于断言最终黑白像素。 */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolyline(px: number, py: number, points: readonly MaskPoint[]) {
  if (points.length === 1) return Math.hypot(px - points[0].x, py - points[0].y);
  let min = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    min = Math.min(min, distToSegment(px, py, a.x, a.y, b.x, b.y));
  }
  return min;
}

function memoryGrid(width: number, height: number) {
  const pixels = new Uint8Array(width * height);
  const sink: MaskRasterSink = {
    fillRect: (x, y, w, h, value) => {
      for (let j = y; j < y + h; j += 1) {
        for (let i = x; i < x + w; i += 1) {
          if (i >= 0 && i < width && j >= 0 && j < height) pixels[j * width + i] = value;
        }
      }
    },
    strokePath: (points, radius, value) => {
      if (points.length === 0) return;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      for (let j = Math.max(0, Math.floor(Math.min(...ys) - radius - 1)); j <= Math.min(height - 1, Math.ceil(Math.max(...ys) + radius)); j += 1) {
        for (let i = Math.max(0, Math.floor(Math.min(...xs) - radius - 1)); i <= Math.min(width - 1, Math.ceil(Math.max(...xs) + radius)); i += 1) {
          if (distToPolyline(i + 0.5, j + 0.5, points) <= radius) pixels[j * width + i] = value;
        }
      }
    },
  };
  return {
    sink,
    valueAt(x: number, y: number) {
      return pixels[y * width + x];
    },
    paintedCount() {
      let n = 0;
      for (const v of pixels) if (v === 255) n += 1;
      return n;
    },
  };
}

/** 便捷：把操作序列光栅到 naturalWidth×naturalHeight 内存网格 */
function rasterizeToGrid(ops: readonly MaskOp[], space: MaskCoordinateSpace) {
  const grid = memoryGrid(space.naturalWidth, space.naturalHeight);
  rasterizeMask(ops, space, grid.sink);
  return grid;
}

/* ============ 黑白语义锁死 ============ */

describe('遮罩黑白语义（官方 PDF 未规定方向，常量锁死口径）', () => {
  it('常量：涂区=白 255=擦除（MASK_PIXEL_ERASED），未涂=黑 0=保留（MASK_PIXEL_KEPT）', () => {
    expect(MASK_PIXEL_ERASED).toBe(255);
    expect(MASK_PIXEL_KEPT).toBe(0);
  });

  it('涂一个框：框内像素=255、框外=0', () => {
    const grid = rasterizeToGrid([paintRect(10, 10, 30, 25)], IDENTITY);
    expect(grid.valueAt(10, 10)).toBe(255); // 框内左上
    expect(grid.valueAt(29, 24)).toBe(255); // 框内右下（不含边界外）
    expect(grid.valueAt(9, 10)).toBe(0); // 框左侧
    expect(grid.valueAt(30, 10)).toBe(0); // 框右边界外
    expect(grid.valueAt(10, 25)).toBe(0); // 框下边界外
  });
});

/* ============ 坐标换算 ============ */

describe('displayPointToNatural：显示坐标→自然分辨率像素', () => {
  it('显示尺寸=自然分辨率时四舍五入后原样返回', () => {
    expect(displayPointToNatural(pt(10.4, 20.6), IDENTITY)).toEqual(pt(10, 21));
    expect(displayPointToNatural(pt(0, 99.7), IDENTITY)).toEqual(pt(0, 100));
  });

  it('2 倍放大：按比例换算', () => {
    expect(displayPointToNatural(pt(50, 30), DOUBLE)).toEqual(pt(100, 60));
  });

  it('非整比例：四舍五入到最近自然像素（100/300×1000=333.33→333；50/200×666=166.5→167）', () => {
    expect(displayPointToNatural(pt(100, 50), FRACTIONAL)).toEqual(pt(333, 167));
  });

  it('越界钳位到 [0, 自然分辨率]', () => {
    expect(displayPointToNatural(pt(-8, -3), DOUBLE)).toEqual(pt(0, 0));
    expect(displayPointToNatural(pt(150, 120), DOUBLE)).toEqual(pt(200, 200));
  });

  it('像素对齐：同一显示比例点在不同卡片尺寸下映射到同一自然像素', () => {
    // 显示区域 25% 处：100 宽卡上的 (25,25) 与 200 宽卡上的 (50,50) → 同一自然像素
    const smallCard = spaceOf(100, 100, 200, 200);
    const largeCard = spaceOf(200, 200, 200, 200);
    expect(displayPointToNatural(pt(25, 25), smallCard)).toEqual(pt(50, 50));
    expect(displayPointToNatural(pt(50, 50), largeCard)).toEqual(pt(50, 50));
  });
});

describe('displayRadiusToNatural：笔刷半径换算', () => {
  it('2 倍放大：半径加倍', () => {
    expect(displayRadiusToNatural(4, DOUBLE)).toBe(8);
  });

  it('恒等空间：原样', () => {
    expect(displayRadiusToNatural(7, IDENTITY)).toBe(7);
  });

  it('非整比例：按横轴比例四舍五入（3×1000/300=10）', () => {
    expect(displayRadiusToNatural(3, FRACTIONAL)).toBe(10);
  });
});

describe('displayRectToNatural：框换算为整数像素矩形', () => {
  it('对角乱序（右下→左上）归一为正向矩形', () => {
    expect(displayRectToNatural(paintRect(70, 60, 10, 20), IDENTITY)).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 40,
    });
  });

  it('2 倍放大：两端各自换算，宽高为整数像素差', () => {
    expect(displayRectToNatural(paintRect(10, 10, 30, 25), DOUBLE)).toEqual({
      x: 20,
      y: 20,
      width: 40,
      height: 30,
    });
  });

  it('非整比例：两端各自取整（1→3.33→3、2→6.67→7，宽 4）', () => {
    expect(displayRectToNatural(paintRect(1, 1, 2, 2), FRACTIONAL)).toEqual({
      x: 3,
      y: 3,
      width: 4,
      height: 4,
    });
  });

  it('越界端点钳位到自然分辨率边界', () => {
    expect(displayRectToNatural(paintRect(-10, -5, 60, 80), DOUBLE)).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 160,
    });
  });
});

/* ============ 栅格化 ============ */

describe('rasterizeMask：指令序列与输出尺寸', () => {
  it('空遮罩：只发一条全图铺黑（保留色）指令', () => {
    const rec = recorderSink();
    rasterizeMask([], DOUBLE, rec.sink);
    expect(rec.calls).toEqual([
      { kind: 'fillRect', x: 0, y: 0, width: 200, height: 200, value: MASK_PIXEL_KEPT },
    ]);
  });

  it('首指令铺满 naturalWidth×naturalHeight：输出尺寸严格等于源图自然分辨率', () => {
    const rec = recorderSink();
    rasterizeMask([paintRect(10, 10, 30, 25)], FRACTIONAL, rec.sink);
    expect(rec.calls[0]).toEqual({
      kind: 'fillRect',
      x: 0,
      y: 0,
      width: 1000,
      height: 666,
      value: MASK_PIXEL_KEPT,
    });
  });

  it('框图元：先换算成自然分辨率整数像素矩形，再以擦除色（白）发出', () => {
    const rec = recorderSink();
    rasterizeMask([paintRect(10, 10, 30, 25)], DOUBLE, rec.sink);
    expect(rec.calls).toEqual([
      { kind: 'fillRect', x: 0, y: 0, width: 200, height: 200, value: 0 },
      { kind: 'fillRect', x: 20, y: 20, width: 40, height: 30, value: 255 },
    ]);
  });

  it('笔迹图元：折线与半径换算成自然分辨率坐标后发出', () => {
    const rec = recorderSink();
    rasterizeMask([paintStroke([pt(50, 50), pt(60, 60)], 4)], DOUBLE, rec.sink);
    expect(rec.calls).toEqual([
      { kind: 'fillRect', x: 0, y: 0, width: 200, height: 200, value: 0 },
      {
        kind: 'strokePath',
        points: [pt(100, 100), pt(120, 120)],
        radius: 8,
        value: 255,
      },
    ]);
  });

  it('橡皮图元：以保留色（黑）发出同形态指令', () => {
    const rec = recorderSink();
    rasterizeMask([eraseStroke([pt(50, 50)], 4)], DOUBLE, rec.sink);
    expect(rec.calls[1]).toEqual({
      kind: 'strokePath',
      points: [pt(100, 100)],
      radius: 8,
      value: 0,
    });
  });

  it('指令按操作顺序发出：涂→擦依次执行（后写覆盖先写）', () => {
    const rec = recorderSink();
    rasterizeMask([paintRect(10, 10, 30, 30), eraseStroke([pt(20, 20)], 3)], IDENTITY, rec.sink);
    expect(rec.calls.map((c) => c.value)).toEqual([0, 255, 0]);
  });

  it('空折线的笔迹不发指令', () => {
    const rec = recorderSink();
    rasterizeMask([paintStroke([], 5)], IDENTITY, rec.sink);
    expect(rec.calls).toHaveLength(1);
  });
});

describe('rasterizeMask：并集叠加', () => {
  it('多个不相交框并集：各自区域涂白', () => {
    const grid = rasterizeToGrid([paintRect(10, 10, 20, 20), paintRect(50, 50, 70, 70)], IDENTITY);
    expect(grid.valueAt(15, 15)).toBe(255);
    expect(grid.valueAt(60, 60)).toBe(255);
    expect(grid.valueAt(35, 35)).toBe(0); // 两框之间
    expect(grid.paintedCount()).toBe(10 * 10 + 20 * 20);
  });

  it('多笔不相交笔迹并集：各自圆盘涂白', () => {
    const grid = rasterizeToGrid(
      [paintStroke([pt(20, 20)], 3), paintStroke([pt(60, 60)], 2)],
      IDENTITY,
    );
    expect(grid.valueAt(20, 20)).toBe(255); // 第一笔圆心
    expect(grid.valueAt(60, 60)).toBe(255); // 第二笔圆心
    expect(grid.valueAt(40, 40)).toBe(0); // 两笔之间
    expect(grid.paintedCount()).toBeGreaterThan(0);
  });

  it('重叠笔迹幂等：并集不重复计数', () => {
    const once = rasterizeToGrid([paintStroke([pt(30, 30)], 5)], IDENTITY);
    const twice = rasterizeToGrid(
      [paintStroke([pt(30, 30)], 5), paintStroke([pt(30, 30)], 5)],
      IDENTITY,
    );
    expect(twice.paintedCount()).toBe(once.paintedCount());
  });

  it('框与笔迹混用并集', () => {
    const grid = rasterizeToGrid([paintRect(10, 10, 30, 30), paintStroke([pt(60, 60)], 4)], IDENTITY);
    expect(grid.valueAt(20, 20)).toBe(255);
    expect(grid.valueAt(60, 60)).toBe(255);
    expect(grid.valueAt(45, 45)).toBe(0);
  });

  it('显示尺寸≠自然分辨率时并集落在自然分辨率像素上', () => {
    // 2 倍空间：显示框 (10,10)-(30,25) → 自然像素 (20,20)-(60,50)
    const grid = rasterizeToGrid([paintRect(10, 10, 30, 25)], DOUBLE);
    expect(grid.valueAt(20, 20)).toBe(255);
    expect(grid.valueAt(59, 49)).toBe(255);
    expect(grid.valueAt(19, 20)).toBe(0);
    expect(grid.valueAt(60, 49)).toBe(0);
  });
});

/* ============ 橡皮 ============ */

describe('橡皮：从并集中减去，不产生新涂区', () => {
  it('橡皮笔迹擦掉涂区的重叠部分，环带保留', () => {
    const grid = rasterizeToGrid(
      [paintStroke([pt(30, 30)], 5), eraseStroke([pt(30, 30)], 2)],
      IDENTITY,
    );
    // 像素(30,30) 中心距(30,30)≈0.71：涂后 255、被半径 2 橡皮擦回 0
    expect(grid.valueAt(30, 30)).toBe(0);
    // 像素(34,30) 中心距≈4.53：在涂区(≤5)内、橡皮(>2)外 → 保留 255
    expect(grid.valueAt(34, 30)).toBe(255);
  });

  it('橡皮作用在空白区域不产生任何涂区（全图仍全黑）', () => {
    const grid = rasterizeToGrid([eraseStroke([pt(50, 50)], 3)], IDENTITY);
    expect(grid.paintedCount()).toBe(0);
  });

  it('擦掉的区域可以再涂回来', () => {
    const grid = rasterizeToGrid(
      [paintStroke([pt(30, 30)], 3), eraseStroke([pt(30, 30)], 3), paintStroke([pt(30, 30)], 3)],
      IDENTITY,
    );
    expect(grid.valueAt(30, 30)).toBe(255);
  });

  it('橡皮框从涂框中减去重叠区', () => {
    const grid = rasterizeToGrid(
      [paintRect(10, 10, 40, 40), eraseRect(20, 20, 30, 30)],
      IDENTITY,
    );
    expect(grid.valueAt(15, 15)).toBe(255); // 只在涂框内
    expect(grid.valueAt(25, 25)).toBe(0); // 涂框与橡皮框重叠
    expect(grid.valueAt(45, 45)).toBe(0); // 两框之外
  });
});

/* ============ 撤销 / 重做 ============ */

describe('撤销/重做：独立小栈（只作用于未发送的遮罩编辑）', () => {
  /** 编辑序列：框 → 涂笔迹 → 橡皮（全部显示坐标，恒等空间） */
  const RECT = paintRect(10, 10, 30, 30);
  const STROKE = paintStroke([pt(60, 60)], 3);
  const ERASER = eraseStroke([pt(60, 60)], 2);

  it('逐步撤销：每步光栅结果回退到上一状态', () => {
    const s1 = applyMaskOp(EMPTY_MASK_EDIT, RECT);
    const s2 = applyMaskOp(s1, STROKE);
    const s3 = applyMaskOp(s2, ERASER);

    const g3 = rasterizeToGrid(s3.ops, IDENTITY);
    expect(g3.valueAt(20, 20)).toBe(255); // 框仍在
    expect(g3.valueAt(60, 60)).toBe(0); // 笔迹圆心已被橡皮擦掉

    const g2 = rasterizeToGrid(undoMaskEdit(s3).ops, IDENTITY);
    expect(g2.valueAt(20, 20)).toBe(255);
    expect(g2.valueAt(60, 60)).toBe(255); // 撤销橡皮 → 笔迹恢复

    const g1 = rasterizeToGrid(undoMaskEdit(undoMaskEdit(s3)).ops, IDENTITY);
    expect(g1.valueAt(20, 20)).toBe(255);
    expect(g1.valueAt(60, 60)).toBe(0); // 撤销笔迹 → 只剩框
  });

  it('撤销含框固化后的状态：框落笔即固化、可整体撤销消失', () => {
    const s1 = applyMaskOp(EMPTY_MASK_EDIT, RECT);
    expect(rasterizeToGrid(s1.ops, IDENTITY).valueAt(20, 20)).toBe(255);
    const undone = undoMaskEdit(s1);
    expect(undone.ops).toHaveLength(0);
    expect(rasterizeToGrid(undone.ops, IDENTITY).paintedCount()).toBe(0);
  });

  it('撤销到空后再撤销不崩溃且状态不变（重做栈保留、仍可重做）', () => {
    const empty = undoMaskEdit(applyMaskOp(EMPTY_MASK_EDIT, RECT));
    const again = undoMaskEdit(empty);
    expect(again).toEqual(empty);
    expect(canRedoMaskEdit(again)).toBe(true);
  });

  it('逐步重做：任意序列可完整重放', () => {
    const s3 = applyMaskOp(
      applyMaskOp(applyMaskOp(EMPTY_MASK_EDIT, RECT), STROKE),
      ERASER,
    );
    const target = rasterizeToGrid(s3.ops, IDENTITY);

    let state = undoMaskEdit(undoMaskEdit(undoMaskEdit(s3))); // 撤空
    state = redoMaskEdit(state); // 恢复框
    expect(rasterizeToGrid(state.ops, IDENTITY).valueAt(60, 60)).toBe(0);
    state = redoMaskEdit(state); // 恢复框+笔迹
    expect(rasterizeToGrid(state.ops, IDENTITY).valueAt(60, 60)).toBe(255);
    state = redoMaskEdit(state); // 恢复框+笔迹+橡皮
    const replayed = rasterizeToGrid(state.ops, IDENTITY);
    expect(replayed.valueAt(20, 20)).toBe(target.valueAt(20, 20));
    expect(replayed.valueAt(60, 60)).toBe(target.valueAt(60, 60));
    expect(replayed.paintedCount()).toBe(target.paintedCount());
  });

  it('重做栈空后再重做不崩溃且状态不变', () => {
    const state = redoMaskEdit(applyMaskOp(EMPTY_MASK_EDIT, RECT));
    expect(state.ops).toHaveLength(1);
  });

  it('撤销后落新笔会清空重做栈（不能再重做）', () => {
    const s2 = applyMaskOp(applyMaskOp(EMPTY_MASK_EDIT, RECT), STROKE);
    const undone = undoMaskEdit(s2);
    expect(canRedoMaskEdit(undone)).toBe(true);
    const forked = applyMaskOp(undone, paintRect(5, 5, 6, 6));
    expect(canRedoMaskEdit(forked)).toBe(false);
    expect(forked.ops).toHaveLength(2);
    // 光栅 = 框 + 新框（笔迹已被放弃）
    const grid = rasterizeToGrid(forked.ops, IDENTITY);
    expect(grid.valueAt(20, 20)).toBe(255);
    expect(grid.valueAt(5, 5)).toBe(255);
    expect(grid.valueAt(60, 60)).toBe(0);
  });

  it('canUndo/canRedo 全程正确', () => {
    expect(canUndoMaskEdit(EMPTY_MASK_EDIT)).toBe(false);
    expect(canRedoMaskEdit(EMPTY_MASK_EDIT)).toBe(false);
    const s1 = applyMaskOp(EMPTY_MASK_EDIT, RECT);
    expect(canUndoMaskEdit(s1)).toBe(true);
    expect(canRedoMaskEdit(s1)).toBe(false);
    const undone = undoMaskEdit(s1);
    expect(canUndoMaskEdit(undone)).toBe(false);
    expect(canRedoMaskEdit(undone)).toBe(true);
    const redone = redoMaskEdit(undone);
    expect(canUndoMaskEdit(redone)).toBe(true);
    expect(canRedoMaskEdit(redone)).toBe(false);
  });

  it('状态不可变：apply/undo/redo 均返回新状态，不改原对象', () => {
    const s1 = applyMaskOp(EMPTY_MASK_EDIT, RECT);
    const s2 = applyMaskOp(s1, STROKE);
    const undone = undoMaskEdit(s2);
    // 原 s1 不受后续编辑影响
    expect(s1.ops).toHaveLength(1);
    expect(s2.ops).toHaveLength(2);
    expect(undone.ops).toHaveLength(1);
    expect(undone).not.toBe(s1);
    expect(EMPTY_MASK_EDIT.ops).toHaveLength(0);
  });
});
