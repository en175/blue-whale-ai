// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../draftSpawn', () => ({ nextDraftPosition: (input: { dockTop: number }) => ({ x: 10, y: 20, dockTop: input.dockTop }) }));
vi.mock('../canvasPureNodeHelpers', () => ({ nodeBoxOf: () => ({ width: 1, height: 1 }) }));

import { useCanvasSpawn, type CanvasSpawnHost } from './useCanvasSpawn';
import { createCanvasGraph } from './useCanvasGraph';

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}
function buildGraph() {
  return createCanvasGraph({
    textNodesRef: ref<Node[]>([]),
    mediaNodesRef: ref<Node[]>([]),
    productNodesRef: ref<Node[]>([]),
    assetNodesRef: ref<Node[]>([]),
    setTextNodes: () => {},
    setMediaNodes: () => {},
    setProductNodes: () => {},
    setAssetNodes: () => {},
  });
}
function buildHost(over: Partial<CanvasSpawnHost> = {}): CanvasSpawnHost {
  return {
    graph: buildGraph(),
    ...over,
  };
}

type Captured = ReturnType<typeof useCanvasSpawn>;
let latest: Captured;

function Probe({ host }: { host: CanvasSpawnHost }) {
  latest = useCanvasSpawn(host);
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function render(host: CanvasSpawnHost) {
  await act(async () => { root.render(createElement(Probe, { host })); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it('registerSpawnPosition 后 spawnPosition 以注册值为中心抖动 ±80', async () => {
  const host = buildHost();
  await render(host);
  latest.registerSpawnPosition(() => ({ x: 1000, y: 1000 }));
  const pos = latest.spawnPosition();
  expect(pos.x).toBeGreaterThanOrEqual(920);
  expect(pos.x).toBeLessThanOrEqual(1080);
  expect(pos.y).toBeGreaterThanOrEqual(920);
  expect(pos.y).toBeLessThanOrEqual(1080);
});

it('未注册时 spawnPosition 以默认 (300,200) 为中心', async () => {
  await render(buildHost());
  const pos = latest.spawnPosition();
  expect(pos.x).toBeGreaterThanOrEqual(220);
  expect(pos.x).toBeLessThanOrEqual(380);
});

it('spawnNearScreen 用屏幕点求中心并交给 nextDraftPosition', async () => {
  const host = buildHost();
  await render(host);
  latest.registerSpawnPosition((pt) => ({ x: (pt?.x ?? 0) + 1, y: (pt?.y ?? 0) + 1 }));
  expect(latest.spawnNearScreen({ x: 100, y: 200 })).toMatchObject({ x: 10, y: 20, dockTop: 201 + 2000 });
});

it('spawnDraftPosition 以窗口底为 dockTop 求落点', async () => {
  await render(buildHost());
  expect(latest.spawnDraftPosition()).toMatchObject({ x: 10, y: 20 });
});
