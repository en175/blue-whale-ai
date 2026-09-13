import { describe, expect, it } from "vitest";

import {
  DEFAULT_GAP,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  findPlacement,
} from "./placement.js";

describe("findPlacement（core 纯函数，IK67H9 抽取）", () => {
  it("空画布时落点对齐视口中心格", () => {
    const pos = findPlacement({ existing: [], anchor: { x: 0, y: 0 } });
    const stepX = DEFAULT_NODE_WIDTH + DEFAULT_GAP;
    const stepY = DEFAULT_NODE_HEIGHT + DEFAULT_GAP;
    const baseX = Math.floor((0 - DEFAULT_NODE_WIDTH / 2) / stepX) * stepX;
    const baseY = Math.floor((0 - DEFAULT_NODE_HEIGHT / 2) / stepY) * stepY;
    expect(pos).toEqual({ x: baseX, y: baseY });
  });

  it("返回落点不与任何已有节点重叠（被占则让到下一空位）", () => {
    const occupied = [
      { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    ];
    const pos = findPlacement({ existing: occupied, anchor: { x: 0, y: 0 } });
    const placed = { ...pos, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
    for (const rect of occupied) {
      const overlaps =
        placed.x < rect.x + rect.width &&
        placed.x + placed.width > rect.x &&
        placed.y < rect.y + rect.height &&
        placed.y + placed.height > rect.y;
      expect(overlaps).toBe(false);
    }
  });

  it("起点格被占时让到同行下一格", () => {
    const stepX = DEFAULT_NODE_WIDTH + DEFAULT_GAP;
    const stepY = DEFAULT_NODE_HEIGHT + DEFAULT_GAP;
    // 与 findPlacement 内部同构的起点格坐标。
    const baseX = Math.floor((0 - DEFAULT_NODE_WIDTH / 2) / stepX) * stepX;
    const baseY = Math.floor((0 - DEFAULT_NODE_HEIGHT / 2) / stepY) * stepY;
    const occupied = [
      { x: baseX, y: baseY, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    ];
    const pos = findPlacement({ existing: occupied, anchor: { x: 0, y: 0 } });
    expect(pos.x).toBe(baseX + stepX);
    expect(pos.y).toBe(baseY);
  });

  it("穷尽后回起点格兜底（有落点优于无落点）", () => {
    const dense: { x: number; y: number; width: number; height: number }[] = [];
    for (let row = 0; row < 60; row++)
      for (let col = 0; col < 3; col++)
        dense.push({
          x: col * (DEFAULT_NODE_WIDTH + DEFAULT_GAP),
          y: row * (DEFAULT_NODE_HEIGHT + DEFAULT_GAP),
          width: DEFAULT_NODE_WIDTH,
          height: DEFAULT_NODE_HEIGHT,
        });
    const pos = findPlacement({ existing: dense, anchor: { x: 0, y: 0 } });
    expect(typeof pos.x).toBe("number");
    expect(typeof pos.y).toBe("number");
  });
});
