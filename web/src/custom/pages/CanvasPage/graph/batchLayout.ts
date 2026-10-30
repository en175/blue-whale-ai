import type { Node } from '@xyflow/react';
import type { MediaContentSizeInput } from '../components/MediaNode/mediaContentSize';
import { MEDIA_CONTENT_LONG_SIDE_MAX, mediaContentBox } from '../components/MediaNode/mediaContentSize';
import type { SpawnBox } from './draftSpawn';

export interface BatchItemLayout {
  mediaType?: MediaContentSizeInput['mediaType'];
  width?: number;
  height?: number;
  ratio?: string;
}

export interface BatchAnchor {
  screen: { x: number; y: number };
  dockTop: number;
  anchor?: { x: number; y: number };
  placement?: 'stack' | 'drop';
}

export interface BatchLayoutOptions {
  anchor: BatchAnchor;
  items: BatchItemLayout[];
  nodes: SpawnBox[];
}

export interface BatchViewportInput {
  width: number;
  height: number;
}

export const BATCH_COLUMNS = 3;
export const BATCH_GAP = 48;
export const BATCH_NODE_FALLBACK_SIZE = { width: 320, height: 340 } as const;
export const BATCH_VIEWPORT_PADDING = 72;
export const BATCH_DOCK_RESERVE = 300;
export const MEDIA_NODE_CHROME_HEIGHT = 44;
export const BATCH_STEP = BATCH_GAP * 2;
export const UNKNOWN_SIZE_BOX = {
  width: MEDIA_CONTENT_LONG_SIDE_MAX,
  height: MEDIA_CONTENT_LONG_SIDE_MAX + MEDIA_NODE_CHROME_HEIGHT,
};

function mediaBoxOf(item: BatchItemLayout) {
  const known = (typeof item.width === 'number' && item.width > 0 && typeof item.height === 'number' && item.height > 0)
    || (typeof item.ratio === 'string' && item.ratio.includes(':'));
  if (item.mediaType !== 'audio' && !known) return UNKNOWN_SIZE_BOX;
  const content = mediaContentBox({
    mediaType: item.mediaType ?? 'image',
    width: item.width,
    height: item.height,
    ratio: item.ratio,
  });
  return { width: Math.ceil(content.width), height: Math.ceil(content.height) + MEDIA_NODE_CHROME_HEIGHT };
}

export function mediaNodeBoxOf(item: BatchItemLayout): SpawnBox {
  return { x: 0, y: 0, ...mediaBoxOf(item) };
}

export function batchNodeBoxOf(node: Node): SpawnBox {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (node.type === 'mediaNode') {
    const content = mediaBoxOf({
      mediaType: data.mediaType as BatchItemLayout['mediaType'],
      width: typeof data.width === 'number' ? data.width : undefined,
      height: typeof data.height === 'number' ? data.height : undefined,
      ratio: data.targetRatio as string | undefined,
    });
    return { x: node.position.x, y: node.position.y, ...content };
  }
  return {
    x: node.position.x,
    y: node.position.y,
    width: BATCH_NODE_FALLBACK_SIZE.width,
    height: BATCH_NODE_FALLBACK_SIZE.height,
  };
}

export function collides(box: SpawnBox, others: SpawnBox[]): boolean {
  return others.some(
    (other) =>
      box.x < other.x + other.width + BATCH_GAP &&
      box.x + box.width + BATCH_GAP > other.x &&
      box.y < other.y + other.height + BATCH_GAP &&
      box.y + box.height + BATCH_GAP > other.y,
  );
}

function rowHeightOf(items: BatchItemLayout[], start: number): number {
  let height = 0;
  for (let index = start; index < Math.min(start + BATCH_COLUMNS, items.length); index += 1) {
    height = Math.max(height, mediaNodeBoxOf(items[index]!).height);
  }
  return height;
}

function columnWidthOf(items: BatchItemLayout[]): number {
  return items.reduce((widest, item) => Math.max(widest, mediaNodeBoxOf(item).width), 0);
}

export function batchRowHeights(items: BatchItemLayout[]): number[] {
  const heights: number[] = [];
  for (let start = 0; start < items.length; start += BATCH_COLUMNS) heights.push(rowHeightOf(items, start));
  return heights;
}

export function placeBatchAt(
  origin: { x: number; y: number },
  items: BatchItemLayout[],
): Array<{ x: number; y: number }> {
  const columnWidth = columnWidthOf(items);
  const positions: Array<{ x: number; y: number }> = [];
  let top = origin.y;
  for (let start = 0; start < items.length; start += BATCH_COLUMNS) {
    const row = items.slice(start, start + BATCH_COLUMNS);
    row.forEach((_, column) => {
      positions.push({
        x: Math.round(origin.x + column * (columnWidth + BATCH_GAP)),
        y: Math.round(top),
      });
    });
    top += rowHeightOf(items, start) + BATCH_GAP;
  }
  return positions;
}

export function batchBoxAt(origin: { x: number; y: number }, items: BatchItemLayout[]): SpawnBox {
  const rows = batchRowHeights(items);
  const columns = Math.min(BATCH_COLUMNS, items.length);
  const width = columns * columnWidthOf(items) + BATCH_GAP * Math.max(columns - 1, 0);
  const height = rows.reduce((total, row) => total + row, 0) + BATCH_GAP * Math.max(rows.length - 1, 0);
  return { x: origin.x, y: origin.y, width, height };
}

export function resolveBatchOrigin(options: BatchLayoutOptions): { x: number; y: number } {
  const { anchor, items, nodes } = options;
  if (items.length === 0) return { x: Math.round(anchor.screen.x), y: Math.round(anchor.screen.y) };
  const box = batchBoxAt({ x: anchor.screen.x, y: 0 }, items);
  const band = nodes.filter(
    (node) => node.x < box.x + box.width + BATCH_GAP && node.x + node.width + BATCH_GAP > box.x,
  );
  if (anchor.placement === 'drop' && anchor.anchor) {
    let origin = { x: Math.round(anchor.anchor.x), y: Math.round(anchor.anchor.y) };
    while (collides(batchBoxAt(origin, items), nodes)) {
      origin = { x: origin.x, y: origin.y + BATCH_STEP };
    }
    return origin;
  }
  const top = Math.round(Math.min(anchor.screen.y, anchor.dockTop - BATCH_GAP - rowHeightOf(items, 0)));
  const below = band
    .filter((node) => node.y + node.height > top)
    .reduce((lowest, node) => Math.max(lowest, node.y + node.height + BATCH_GAP), top);
  let origin = { x: Math.round(anchor.screen.x), y: Math.round(below) };
  while (collides(batchBoxAt(origin, items), nodes)) {
    origin = { x: origin.x, y: origin.y + BATCH_STEP };
  }
  const prevBottom = band.reduce(
    (bottom, node) => Math.max(bottom, node.y + node.height),
    Number.NEGATIVE_INFINITY,
  );
  const prevLeft = Math.min(...band.map((node) => node.x));
  if (Number.isFinite(prevBottom) && prevBottom >= top) {
    const stacked = { x: Math.round(prevLeft), y: Math.round(prevBottom + BATCH_GAP) };
    if (!collides(batchBoxAt(stacked, items), nodes)) return stacked;
  }
  return origin;
}

export function layoutBatch(options: BatchLayoutOptions): Array<{ x: number; y: number }> {
  return placeBatchAt(resolveBatchOrigin(options), options.items);
}

export function batchViewportOf(
  positions: Array<{ x: number; y: number }>,
  items: BatchItemLayout[],
  container: BatchViewportInput,
  dockTop: number,
): { x: number; y: number; zoom: number } {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  positions.forEach((position, index) => {
    const box = mediaNodeBoxOf(items[index]!);
    left = Math.min(left, position.x);
    right = Math.max(right, position.x + box.width);
    top = Math.min(top, position.y);
    bottom = Math.max(bottom, position.y + box.height);
  });
  const available = Math.max(1, container.height - dockTop);
  const zoom = Math.max(
    0.1,
    Math.min(
      1,
      (container.width - BATCH_VIEWPORT_PADDING * 2) / Math.max(right - left, 1),
      (available - BATCH_VIEWPORT_PADDING * 2) / Math.max(bottom - top, 1),
    ),
  );
  return {
    x: Math.round(container.width / 2 - ((left + right) / 2) * zoom),
    y: Math.round(dockTop / 2 - ((top + bottom) / 2) * zoom),
    zoom: Number(zoom.toFixed(3)),
  };
}
