import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { applyDraggedNodesToGroups, type CanvasGroup } from './canvasGroups';

const node = (id: string, x: number, y: number, w = 200, h = 120): Node =>
  ({ id, type: 'mediaNode', position: { x, y }, measured: { width: w, height: h }, data: {} }) as Node;

const group = (id: string, x: number, y: number, w: number, h: number, excludedIds: string[] = []): CanvasGroup =>
  ({ id, box: { x, y, w, h }, excludedIds });

const positions = (nodes: Node[]): Map<string, { x: number; y: number }> =>
  new Map(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));

describe('applyDraggedNodesToGroups 拖拽落定的群组成员归属', () => {
  it('无组时原样返回', () => {
    const g: CanvasGroup[] = [];
    expect(applyDraggedNodesToGroups(g, [], [], new Map())).toBe(g);
  });

  it('已有组内成员居中拖动：box 跟随位移、成员保留', () => {
    const a = node('a', 100, 100);
    const groups = [group('g1', 50, 50, 400, 400)];
    const moved = node('a', 140, 130);
    const next = applyDraggedNodesToGroups(groups, [a], [moved], positions([moved]));
    expect(next[0]!.box).toEqual({ x: 50, y: 50, w: 400, h: 400 });
    expect(next[0]!.excludedIds).toEqual([]);
  });

  it('未成组成员拖到组框内 → 归入该组（不出现在 excludedIds）', () => {
    const a = node('a', 900, 900);
    const groups = [group('g1', 50, 50, 400, 400)];
    const moved = node('a', 150, 150);
    const next = applyDraggedNodesToGroups(groups, [a], [moved], positions([moved]));
    expect(next[0]!.excludedIds).not.toContain('a');
  });

  it('压住组框边缘 → 扩展 box 包住拖入节点', () => {
    const a = node('a', 900, 900);
    const groups = [group('g1', 50, 50, 200, 200)];
    const moved = node('a', 230, 100);
    const next = applyDraggedNodesToGroups(groups, [a], [moved], positions([moved]));
    expect(next[0]!.box.x).toBeLessThanOrEqual(50);
    expect(next[0]!.box.w).toBeGreaterThan(200);
  });
});
