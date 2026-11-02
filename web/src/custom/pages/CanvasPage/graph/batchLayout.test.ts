import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  BATCH_COLUMNS,
  BATCH_GAP,
  batchNodeBoxOf,
  batchViewportOf,
  collides,
  layoutBatch,
  mediaNodeBoxOf,
  placeBatchAt,
  resolveBatchOrigin,
} from './batchLayout';
import type { BatchItemLayout } from './batchLayout';
import type { SpawnBox } from './draftSpawn';

const box = (x: number, y: number, width: number, height: number): SpawnBox => ({ x, y, width, height });

const landscape: BatchItemLayout = { mediaType: 'image', width: 1600, height: 900 };
const portrait: BatchItemLayout = { mediaType: 'image', width: 900, height: 1600 };
const square: BatchItemLayout = { mediaType: 'image', width: 1000, height: 1000 };

const renderedBoxes = (positions: Array<{ x: number; y: number }>, items: BatchItemLayout[]): SpawnBox[] =>
  positions.map((position, index) => {
    const size = mediaNodeBoxOf(items[index]!);
    return { x: position.x, y: position.y, width: size.width, height: size.height };
  });

const stackAnchor = (screen = { x: 1000, y: 800 }) => ({
  screen,
  dockTop: Number.POSITIVE_INFINITY,
  placement: 'stack' as const,
});

describe('mediaNodeBoxOf', () => {
  it('保持显示比例且按画布显示边界上限缩放，不按文件分辨率放大', () => {
    const widest = mediaNodeBoxOf({ mediaType: 'image', width: 4000, height: 1000 });
    expect(widest.width).toBeLessThanOrEqual(840);
    expect(widest.width / (widest.height - 44)).toBeCloseTo(4, 2);
    expect(mediaNodeBoxOf(landscape).width).toBeGreaterThan(mediaNodeBoxOf(landscape).height - 44);
  });

  it('尺寸未知时按最大显示边界预留，已知后不超出预留', () => {
    const reserved = mediaNodeBoxOf({ mediaType: 'image' });
    expect(reserved).toEqual({ x: 0, y: 0, width: 840, height: 840 + 44 });
    expect(mediaNodeBoxOf(landscape).width).toBeLessThanOrEqual(reserved.width);
    expect(mediaNodeBoxOf(portrait).height).toBeLessThanOrEqual(reserved.height);
  });
});

describe('placeBatchAt', () => {
  it('按输入顺序从左到右、从上到下排列，最多 3 列', () => {
    const items = [landscape, portrait, square, square, square];
    const positions = placeBatchAt({ x: 0, y: 0 }, items);
    expect(positions).toHaveLength(5);
    expect(BATCH_COLUMNS).toBe(3);
    expect(positions[1]!.y).toBe(positions[0]!.y);
    expect(positions[2]!.y).toBe(positions[0]!.y);
    const firstRowBottom = Math.max(...items.slice(0, 3).map((item) => mediaNodeBoxOf(item).height));
    expect(positions[3]!.y).toBe(firstRowBottom + BATCH_GAP);
    expect(positions[3]!.x).toBe(positions[0]!.x);
    expect(positions[4]!.y).toBe(positions[3]!.y);
    expect(positions[4]!.x).toBeGreaterThan(positions[3]!.x);
    expect(positions[0]!.x).toBeLessThan(positions[1]!.x);
    expect(positions[1]!.x).toBeLessThan(positions[2]!.x);
  });

  it('节点边界至少保留 48 画布单位间距', () => {
    const items = [landscape, portrait, square, portrait, landscape];
    const boxes = renderedBoxes(placeBatchAt({ x: 0, y: 0 }, items), items);
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        expect(collides(boxes[left]!, [boxes[right]!])).toBe(false);
      }
    }
    expect(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.width)).toBe(BATCH_GAP);
  });
});

describe('resolveBatchOrigin', () => {
  it('空画布完全从当前视口位置开始', () => {
    const items = [landscape, portrait, square];
    const origin = resolveBatchOrigin({ anchor: stackAnchor(), items, nodes: [] });
    expect(origin).toEqual({ x: 1000, y: 800 });
  });

  it('已有内容时上一批整体下方开始、左侧对齐，不补上一批空位', () => {
    const first = [landscape, portrait, square];
    const firstBoxes = renderedBoxes(layoutBatch({ anchor: stackAnchor(), items: first, nodes: [] }), first);
    const second = [square, portrait];
    const origin = resolveBatchOrigin({
      anchor: stackAnchor(),
      items: second,
      nodes: firstBoxes,
    });
    const firstBottom = Math.max(...firstBoxes.map((item) => item.y + item.height));
    expect(origin.x).toBe(Math.min(...firstBoxes.map((item) => item.x)));
    expect(origin.y).toBe(firstBottom + BATCH_GAP);
  });

  it('下方被占用时整批继续向下避开已有节点', () => {
    const items = [square, square];
    const first = renderedBoxes(layoutBatch({ anchor: stackAnchor(), items, nodes: [] }), items);
    const blocker = box(first[0]!.x, first[0]!.y + first[0]!.height + BATCH_GAP + 10, 320, 340);
    const positions = layoutBatch({ anchor: stackAnchor(), items, nodes: [...first, blocker] });
    const boxes = renderedBoxes(positions, items);
    expect(collides(boxes[0]!, [...first, blocker])).toBe(false);
    expect(collides(boxes[1]!, [...first, blocker])).toBe(false);
  });

  it('拖放到指定位置时以落点为起点，重叠则向下避开', () => {
    const items = [square];
    const occupied = box(500, 500, 320, 340);
    const origin = resolveBatchOrigin({
      anchor: { screen: { x: 1000, y: 1000 }, dockTop: Number.POSITIVE_INFINITY, placement: 'drop', anchor: { x: 520, y: 510 } },
      items,
      nodes: [occupied],
    });
    expect(origin.x).toBe(520);
    expect(origin.y).toBeGreaterThan(510);
    expect(collides(renderedBoxes([origin], items)[0]!, [occupied])).toBe(false);
  });
});

describe('batchNodeBoxOf', () => {
  it('与排布尺寸一致', () => {
    const node = { id: 'a', type: 'mediaNode', position: { x: 10, y: 20 }, data: landscape } as Node;
    expect(batchNodeBoxOf(node)).toEqual({ ...mediaNodeBoxOf(landscape), x: 10, y: 20 });
  });
});

describe('batchViewportOf', () => {
  it('整批可见且不超过原始缩放', () => {
    const items = [landscape, portrait, square, square];
    const positions = placeBatchAt({ x: 2000, y: 2000 }, items);
    const viewport = batchViewportOf(positions, items, { width: 1440, height: 900 }, 600);
    expect(viewport.zoom).toBeLessThanOrEqual(1);
    expect(viewport.zoom).toBeGreaterThan(0);
    const boxes = renderedBoxes(positions, items);
    const screenLeft = (Math.min(...boxes.map((item) => item.x)) * viewport.zoom) + viewport.x;
    const screenRight = (Math.max(...boxes.map((item) => item.x + item.width)) * viewport.zoom) + viewport.x;
    const screenTop = (Math.min(...boxes.map((item) => item.y)) * viewport.zoom) + viewport.y;
    expect(screenLeft).toBeGreaterThanOrEqual(0);
    expect(screenRight).toBeLessThanOrEqual(1440);
    expect(screenTop).toBeGreaterThanOrEqual(0);
  });
});
