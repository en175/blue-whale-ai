// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SnapshotAsset } from '@/api/projects';
import { useCanvasDoc } from './useCanvasDoc';

const fetchSnapshot = vi.hoisted(() => vi.fn());
vi.mock('@/api/projects', () => ({ fetchProjectSnapshot: fetchSnapshot }));
vi.mock('@/api/canvas', () => ({ fetchCanvasDoc: vi.fn() }));

function snapshot(projectId: string, version: number | null) {
  return {
    assets: {},
    canvas: {
      version,
      viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      nodes: JSON.stringify([{ id: `${projectId}-node`, type: 'mediaNode', position: { x: 0, y: 0 }, data: {} }]),
      edges: '[]',
    },
  };
}

let root: Root;
let container: HTMLDivElement;
let visibleNodeIds: string[] = [];
let visibleLoadFailed = false;
let visibleAssets: Record<string, SnapshotAsset> = {};
let upsertAssetsFn: ((items: SnapshotAsset[]) => void) | undefined;
let renderedDocs: Array<{ projectId: string; nodeIds: string[] }> = [];
function Probe({ projectId }: { projectId: string }) {
  const { doc, loadFailed, assets, upsertAssets } = useCanvasDoc(projectId);
  visibleNodeIds = doc?.nodes.map((node) => node.id) ?? [];
  visibleLoadFailed = loadFailed;
  visibleAssets = assets;
  upsertAssetsFn = upsertAssets;
  renderedDocs.push({ projectId, nodeIds: visibleNodeIds });
  return null;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  fetchSnapshot.mockReset();
  visibleNodeIds = [];
  visibleLoadFailed = false;
  visibleAssets = {};
  upsertAssetsFn = undefined;
  renderedDocs = [];
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

it('A→B→A 时 B 的迟到快照不能覆盖当前 A 文档', async () => {
  let resolveB!: (value: ReturnType<typeof snapshot>) => void;
  fetchSnapshot
    .mockResolvedValueOnce(snapshot('p1', 1))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }))
    .mockResolvedValueOnce(snapshot('p1', 2));

  await act(async () => { root.render(createElement(Probe, { projectId: 'p1' })); });
  expect(visibleNodeIds).toEqual(['p1-node']);
  await act(async () => { root.render(createElement(Probe, { projectId: 'p2' })); });
  await act(async () => { root.render(createElement(Probe, { projectId: 'p1' })); });
  expect(visibleNodeIds).toEqual(['p1-node']);
  await act(async () => { resolveB(snapshot('p2', 7)); });
  expect(visibleNodeIds).toEqual(['p1-node']);
});

it('读取失败与成功加载的无版本画布分开标记', async () => {
  fetchSnapshot.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { root.render(createElement(Probe, { projectId: 'p1' })); });
  expect(visibleLoadFailed).toBe(true);
  expect(visibleNodeIds).toEqual([]);

  fetchSnapshot.mockResolvedValueOnce(snapshot('p2', null));
  await act(async () => { root.render(createElement(Probe, { projectId: 'p2' })); });
  expect(visibleLoadFailed).toBe(false);
  expect(visibleNodeIds).toEqual(['p2-node']);
});

it('切换项目后的首帧不暴露上一个项目的文档', async () => {
  fetchSnapshot.mockResolvedValueOnce(snapshot('p1', 1));
  fetchSnapshot.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { root.render(createElement(Probe, { projectId: 'p1' })); });
  expect(visibleNodeIds).toEqual(['p1-node']);

  await act(async () => { root.render(createElement(Probe, { projectId: 'p2' })); });
  expect(renderedDocs.filter((entry) => entry.projectId === 'p2')).toEqual([
    { projectId: 'p2', nodeIds: [] },
    { projectId: 'p2', nodeIds: [] },
  ]);
});

it('upsertAssets 在 URL 不变时也会合并 material_status', async () => {
  fetchSnapshot.mockResolvedValueOnce({
    assets: {
      '526': {
        asset_id: 526,
        type: 'image',
        access_url: 'https://cdn.example/a.png',
        width: 10,
        height: 10,
        material_id: null,
        material_status: null,
      },
    },
    canvas: {
      version: 1,
      viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      nodes: JSON.stringify([{ id: 'p1-node', type: 'mediaNode', position: { x: 0, y: 0 }, data: {} }]),
      edges: '[]',
    },
  });
  await act(async () => { root.render(createElement(Probe, { projectId: 'p1' })); });
  expect(visibleAssets['526']?.material_status).toBeNull();

  await act(async () => {
    upsertAssetsFn?.([{
      asset_id: 526,
      type: 'image',
      access_url: 'https://cdn.example/a.png',
      width: 10,
      height: 10,
      material_id: 'asset-20260820153209-6c9z8',
      material_status: 'Active',
    }]);
  });
  expect(visibleAssets['526']).toMatchObject({
    material_id: 'asset-20260820153209-6c9z8',
    material_status: 'Active',
  });
});
