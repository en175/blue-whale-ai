import { describe, it, expect } from "vitest";
import {
  findPlacement,
  pickReferenceDropTarget,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_GAP,
} from "./placement";

const W = DEFAULT_NODE_WIDTH; // 200
const H = DEFAULT_NODE_HEIGHT; // 200
const GAP = DEFAULT_GAP; // 24
const SX = W + GAP; // 步长 X = 224
const SY = H + GAP; // 步长 Y = 224

/** anchor → 中心格左上角（对齐 findPlacement 内部 base 计算）。 */
function centerCell(anchor: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.floor((anchor.x - W / 2) / SX) * SX,
    y: Math.floor((anchor.y - H / 2) / SY) * SY,
  };
}

describe("findPlacement / 视口中心锚 (D2)", () => {
  it("无已有节点：落点 = 中心格（节点中心对齐 anchor）", () => {
    const anchor = { x: 1000, y: 500 };
    const p = findPlacement({ existing: [], anchor });
    expect(p).toEqual(centerCell(anchor));
  });

  it("中心格被占：落到同行右边下一空格", () => {
    const anchor = { x: 1000, y: 500 };
    const base = centerCell(anchor);
    const occupied = [{ x: base.x, y: base.y, width: W, height: H }];
    const p = findPlacement({ existing: occupied, anchor });
    expect(p).toEqual({ x: base.x + SX, y: base.y });
  });

  it("同行填满 maxPerRow：换行（y + 步长 Y，x 回中心列）", () => {
    const anchor = { x: 1000, y: 500 };
    const maxPerRow = 3;
    const base = centerCell(anchor);
    const row = [0, 1, 2].map((c) => ({
      x: base.x + c * SX,
      y: base.y,
      width: W,
      height: H,
    }));
    const p = findPlacement({ existing: row, anchor, maxPerRow });
    expect(p).toEqual({ x: base.x, y: base.y + SY });
  });

  it("落点绝不与已有节点矩形相交（不覆盖硬约束）", () => {
    const anchor = { x: 0, y: 0 };
    const base = centerCell(anchor);
    const existing = [
      { x: base.x, y: base.y, width: W, height: H },
      { x: base.x + SX, y: base.y, width: W, height: H },
      { x: base.x - SX, y: base.y, width: W, height: H },
      { x: base.x, y: base.y + SY, width: W, height: H },
    ];
    const p = findPlacement({ existing, anchor });
    for (const e of existing) {
      const overlap =
        p.x < e.x + e.width &&
        p.x + W > e.x &&
        p.y < e.y + e.height &&
        p.y + H > e.y;
      expect(overlap).toBe(false);
    }
  });

  it("多图连续放置：依次落点两两不重叠（模拟批量生成 N 张）", () => {
    const anchor = { x: 500, y: 500 };
    const placed: { x: number; y: number; width: number; height: number }[] =
      [];
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const p = findPlacement({ existing: placed, anchor });
      points.push(p);
      placed.push({ x: p.x, y: p.y, width: W, height: H });
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const overlap =
          a.x < b.x + W && a.x + W > b.x && a.y < b.y + H && a.y + H > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it("矩形节点（16:9 356x200）：步长按宽/高分别计算", () => {
    const nw = 356;
    const nh = 200;
    const gap = 24;
    const stepX = nw + gap; // 380
    const stepY = nh + gap; // 224
    const anchor = { x: 0, y: 0 };
    const baseX = Math.floor((anchor.x - nw / 2) / stepX) * stepX;
    const baseY = Math.floor((anchor.y - nh / 2) / stepY) * stepY;
    const occupied = [{ x: baseX, y: baseY, width: nw, height: nh }];
    const p = findPlacement({
      existing: occupied,
      anchor,
      nodeWidth: nw,
      nodeHeight: nh,
      gap,
    });
    expect(p).toEqual({ x: baseX + stepX, y: baseY });
  });
});

describe("pickReferenceDropTarget（IK55VT 通道一：画布拖素材上参考卡落槽）", () => {
  it("图片素材（有 assetId）拖到参考卡上 → 返回参考卡 id", () => {
    expect(
      pickReferenceDropTarget({ kind: "image", assetId: "9" }, [
        { id: "n_img2", kind: "image" },
        { id: "r1", kind: "reference" },
      ]),
    ).toBe("r1");
  });

  it("无 assetId 的占位图片节点 → null（生成中不可落槽）", () => {
    expect(
      pickReferenceDropTarget({ kind: "image" }, [
        { id: "r1", kind: "reference" },
      ]),
    ).toBeNull();
  });

  it("非图片 kind（video/audio/text/reference）→ null", () => {
    for (const kind of ["video", "audio", "text", "reference"]) {
      expect(
        pickReferenceDropTarget({ kind, assetId: "9" }, [
          { id: "r1", kind: "reference" },
        ]),
      ).toBeNull();
    }
  });

  it("相交候选中无参考卡 → null", () => {
    expect(
      pickReferenceDropTarget({ kind: "image", assetId: "9" }, [
        { id: "n_img2", kind: "image" },
      ]),
    ).toBeNull();
  });
});
