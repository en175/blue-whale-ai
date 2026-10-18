// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Edge, Node } from '@xyflow/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import { createGenerationRuntime } from '../../generation/runtime';
import { createControlledHost } from '../../generation/recoveryTestKit';
import { createImageToolsTask } from '../../generation/imageTools';
import { useCanvasSave, type CanvasSaveHost } from '../document/useCanvasSave';
import { useCanvasNodeDeletion } from './useCanvasNodeDeletion';

const { saveCanvasDoc, putCanvasDocWithRecovery } = vi.hoisted(() => ({
  saveCanvasDoc: vi.fn(), putCanvasDocWithRecovery: vi.fn(),
}));
vi.mock('@/custom/api/canvas', async (importActual) => ({
  ...await importActual<typeof import('@/custom/api/canvas')>(), saveCanvasDoc,
}));
vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...await importActual<typeof import('@/custom/api/canvasRecovery')>(), putCanvasDocWithRecovery,
}));

const SID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = `gcr:${SID}:$target`;
const SOURCE: Node = { id: 'source', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '11' } };
const TARGET: Node = { id: 'cutout', type: 'mediaNode', position: { x: 50, y: 0 }, data: {
  genStatus: 'failed', jobId: '301', draft: true,
  imageCutout: { sourceAssetId: '11', lastInput: { source_asset_id: '11' } },
  generationRecovery: { protocolVersion: 1, submissionId: SID, outputKey: '$target' },
} };

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  saveCanvasDoc.mockReset().mockResolvedValue({ version: 2 });
  putCanvasDocWithRecovery.mockReset().mockImplementation(async (_projectId, _payload, _version, fields) => ({
    version: 3, recoveryReceipt: { commandId: fields.commandId, replayed: false,
      changes: [{ recoveryItemId: ITEM_ID, revision: 2, nodeBindingRevision: 1, state: 'removed' }] },
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

async function renderDeletion() {
  const record: GenerationRecoveryRecord = {
    submission_id: SID, target_node_id: TARGET.id, job_id: '301', task_type: 'image_cutout',
    binding_revision: 1, is_current: true, recovery_seed: null, previous_target_snapshot: null,
    job: { job_id: '301', type: 'image_cutout', status: 'failed', progress: 0, output_asset_ids: [],
      stored_error: null, created_at: '2026-10-14T00:00:00Z' },
    items: [{ recovery_item_id: ITEM_ID, output_key: '$target', node_id: TARGET.id,
      state: 'present', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
  };
  const mediaNodesRef = { current: [SOURCE, TARGET] };
  const edgesRef = { current: [{ id: 'wire', source: SOURCE.id, target: TARGET.id }] as Edge[] };
  const epoch = {};
  const { host } = createControlledHost({
    getProjectId: () => 'p1', getLoadEpoch: () => epoch,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 1, records: [record], next_cursor: null }),
  });
  host.getMediaNodes = () => mediaNodesRef.current.map((node) => ({ ...node, type: node.type ?? 'mediaNode' }));
  host.findNode = (id) => host.getMediaNodes().find((node) => node.id === id) ?? null;
  const runtime = createGenerationRuntime(host, { newId: () => '22222222-2222-4222-8222-222222222222' });
  runtime.register(createImageToolsTask());
  await runtime.recover('p1');
  const saveHost: CanvasSaveHost = {
    activeProjectRef: { current: 'p1' }, hydratedProjectRef: { current: 'p1' },
    textNodesRef: { current: [] }, mediaNodesRef, productNodesRef: { current: [] }, assetNodesRef: { current: [] },
    groupsRef: { current: [] }, edgesRef, draftErrorsRef: { current: new Map() }, versionRef: { current: 1 },
    lastSavedRef: { current: '' }, retainedRecoverySaveRef: { current: null }, pendingNodeIdsRef: { current: new Set() },
    savePromiseRef: { current: null }, generationRuntimeRef: { current: runtime },
    confirmedNonEmptyRef: { current: true }, emptyClearConflictRef: { current: false },
    emptyOverwriteRejectedRef: { current: false }, recoverySaveConflictRef: { current: false },
    viewportRef: { current: { x: 0, y: 0, zoom: 1 } },
    setSaveEpoch: () => {}, setSaveStatus: () => {}, setSaveBlocked: () => {}, setSavedAt: () => {},
    saveBlocked: false, submittingNodeId: null, audioMixInFlightRef: { current: false },
    currentId: 'p1', doc: {}, applyingRef: { current: false }, blockInvalidDraft: () => false, showToast: () => {},
    graph: { allNodes: () => [...mediaNodesRef.current] }, viewport: { x: 0, y: 0, zoom: 1 }, rollbackPendingNodes: () => {},
  };
  let deletion!: ReturnType<typeof useCanvasNodeDeletion>;
  let save!: ReturnType<typeof useCanvasSave>;
  function Probe() {
    const [mediaNodes, setMediaNodes] = useState(mediaNodesRef.current);
    const [edges, setEdges] = useState(edgesRef.current);
    mediaNodesRef.current = mediaNodes;
    edgesRef.current = edges;
    save = useCanvasSave({ ...saveHost, mediaNodes, edges });
    deletion = useCanvasNodeDeletion({
      currentId: 'p1', mediaNodesRef, edgesRef,
      textNodesRef: saveHost.textNodesRef, productNodesRef: saveHost.productNodesRef, assetNodesRef: saveHost.assetNodesRef,
      historyRef: { current: null }, generationRuntimeRef: saveHost.generationRuntimeRef,
      activeJobByNodeRef: { current: new Map() }, pendingNodeIdsRef: saveHost.pendingNodeIdsRef,
      isGeneratingNode: () => false, setMediaNodes, setEdges,
      setTextNodes: () => {}, setProductNodes: () => {}, setAssetNodes: () => {}, flushCanvasSave: save.flushCanvasSave,
    });
    return null;
  }
  await act(async () => { root.render(createElement(Probe)); });
  return { saveHost, runtime, remove: () => deletion.removeCanvasNodes([TARGET.id]), flush: () => save.flushCanvasSave('p1') };
}

it.each([false, true])('失败抠图卡删除立即排队保存删除后的节点和连线，在途保存=%s', async (inFlight) => {
  const { saveHost, runtime, remove, flush } = await renderDeletion();
  let finishFirst!: (value: { version: number }) => void;
  let first: Promise<boolean> | undefined;
  if (inFlight) {
    saveCanvasDoc.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    await act(async () => { first = flush(); });
    expect(saveCanvasDoc.mock.calls[0]?.[1].nodes.map((node: Node) => node.id)).toEqual(['source', 'cutout']);
  }
  await act(async () => { remove(); });
  if (inFlight) {
    expect(putCanvasDocWithRecovery).not.toHaveBeenCalled();
    await act(async () => { finishFirst({ version: 2 }); await first; await saveHost.savePromiseRef.current; });
  }
  expect(putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
  const [projectId, payload, version, fields] = putCanvasDocWithRecovery.mock.calls[0]!;
  expect(projectId).toBe('p1');
  expect(payload.nodes.map((node: Node) => node.id)).toEqual(['source']);
  expect(payload.edges).toEqual([]);
  expect(version).toBe(inFlight ? 2 : 1);
  expect(fields.recoveryChanges).toEqual([{ recoveryItemId: ITEM_ID, expectedRevision: 1, action: 'remove' }]);
  expect(runtime.composeSaveFields()).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(putCanvasDocWithRecovery).toHaveBeenCalledTimes(1);
  expect(saveCanvasDoc).toHaveBeenCalledTimes(inFlight ? 1 : 0);
  runtime.reset();
});
