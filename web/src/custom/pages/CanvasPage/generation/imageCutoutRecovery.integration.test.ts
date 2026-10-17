// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { GenerationRecoveryItem, GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import type { JobDetail } from '@/custom/api/jobs';
import { useCanvasNodeDeletion } from '../hooks/chrome/useCanvasNodeDeletion';
import { createImageToolsTask } from './imageTools';
import { normalGenerationTask } from './normalGeneration';
import { createControlledHost, flush } from './recoveryTestKit';
import { createGenerationRuntime, type GenerationRuntime } from './runtime';

const PROJECT_ID = 'p1';
const NODE_ID = 'cutout-result';
const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = `gcr:${SUBMISSION_ID}:$target`;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

function failedRecord(state: GenerationRecoveryItem['state'], taskType = 'image_cutout'): GenerationRecoveryRecord {
  return {
    submission_id: SUBMISSION_ID, target_node_id: NODE_ID, job_id: '301', task_type: taskType,
    binding_revision: 1, is_current: true,
    job: { job_id: '301', type: taskType, status: 'failed', progress: 0, output_asset_ids: [], stored_error: null, created_at: '2026-10-14T00:00:00Z' },
    recovery_seed: null, previous_target_snapshot: null,
    items: [{ recovery_item_id: ITEM_ID, output_key: '$target', node_id: NODE_ID, state,
      revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
  };
}

function failedCard(): Node {
  return {
    id: NODE_ID, type: 'mediaNode', position: { x: 10, y: 20 },
    data: {
      jobId: '301', genStatus: 'failed', mediaType: 'image', draft: true,
      imageCutout: { sourceAssetId: '11', lastInput: { source_asset_id: '11', target_node_id: NODE_ID, scene: 'human' } },
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION_ID, outputKey: '$target' },
    },
  };
}

function setup(record: GenerationRecoveryRecord) {
  const epoch = {};
  const savedFields: Array<ReturnType<GenerationRuntime['composeSaveFields']>> = [];
  let runtime: GenerationRuntime;
  const saveCanvas = vi.fn(async () => {
    savedFields.push(runtime.composeSaveFields());
    return true;
  });
  const { host, nodes } = createControlledHost({
    getProjectId: () => PROJECT_ID,
    getLoadEpoch: () => epoch,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 3, records: [structuredClone(record)], next_cursor: null }),
    saveCanvas,
  });
  const fetchJobStatus = vi.fn(async (): Promise<JobDetail> => ({ job_id: '301', status: 'failed', progress: 0, asset: null }));
  runtime = createGenerationRuntime(host, {
    fetchJobStatus, newId: () => '22222222-2222-4222-8222-222222222222',
    setTimeout: () => 1, clearTimeout: () => {},
  });
  runtime.register(createImageToolsTask());
  runtime.register(normalGenerationTask);

  const removeCard = async () => {
    const mediaNodesRef = { current: [...nodes.values()].map(({ id, type, position, data }): Node => ({ id, type, position, data })) };
    let deletion: ReturnType<typeof useCanvasNodeDeletion>;
    function DeletionProbe() {
      deletion = useCanvasNodeDeletion({
        currentId: PROJECT_ID,
        mediaNodesRef,
        textNodesRef: { current: [] }, productNodesRef: { current: [] }, assetNodesRef: { current: [] }, edgesRef: { current: [] },
        historyRef: { current: null }, generationRuntimeRef: { current: runtime },
        activeJobByNodeRef: { current: new Map() }, pendingNodeIdsRef: { current: new Set() },
        isGeneratingNode: (id) => nodes.get(id)?.data.genStatus === 'generating',
        setMediaNodes: (update) => {
          mediaNodesRef.current = typeof update === 'function' ? update(mediaNodesRef.current) : update;
          nodes.clear();
          mediaNodesRef.current.forEach((node) => nodes.set(node.id, { ...node, type: node.type ?? 'mediaNode' }));
        },
        setTextNodes: () => {}, setProductNodes: () => {}, setAssetNodes: () => {}, setEdges: () => {},
        flushCanvasSave: saveCanvas,
      });
      return null;
    }
    await act(async () => { root.render(createElement(DeletionProbe)); });
    await act(async () => { deletion.removeCanvasNodes([NODE_ID]); });
  };

  return { record, host, nodes, runtime, savedFields, fetchJobStatus, removeCard };
}

describe('IKL1PD：失败抠图卡删除后的恢复与保存', () => {
  it('真实删除生成 remove，确认保存成功后连续三次刷新均不补卡或自动 restore', async () => {
    const record = failedRecord('present');
    const before = setup(record);
    before.nodes.set(NODE_ID, { ...failedCard(), type: 'mediaNode' });
    await before.runtime.recover(PROJECT_ID);
    await before.removeCard();
    expect(before.host.findNode(NODE_ID)).toBeNull();

    const fields = before.runtime.composeSaveFields();
    expect(fields?.recoveryChanges).toEqual([{ recoveryItemId: ITEM_ID, expectedRevision: 1, action: 'remove' }]);
    if (!fields) throw new Error('删除未生成恢复保存指令');
    before.runtime.onSaveReceipt({
      commandId: fields.commandId, replayed: false,
      changes: [{ recoveryItemId: ITEM_ID, revision: 2, nodeBindingRevision: 1, state: 'removed' }],
    });
    expect(before.runtime.composeSaveFields()).toBeNull();
    before.runtime.reset();

    record.items[0] = { ...record.items[0]!, state: 'removed', revision: 2 };
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const after = setup(record);
      await after.runtime.recover(PROJECT_ID);
      expect.soft(after.host.findNode(NODE_ID)).toBeNull();
      expect.soft(after.runtime.composeSaveFields()).toBeNull();
      expect.soft(after.savedFields).toEqual([]);
      expect.soft(after.fetchJobStatus).not.toHaveBeenCalled();
      after.runtime.reset();
    }
  });

  it.each(['removed', 'replaced', 'transferred'] as const)('目标为 %s 时，缺少旧快照和抠图身份也不得自动补卡', async (state) => {
    const { host, runtime, savedFields, fetchJobStatus } = setup(failedRecord(state));
    await runtime.recover(PROJECT_ID);
    expect.soft(host.findNode(NODE_ID)).toBeNull();
    expect.soft(runtime.composeSaveFields()).toBeNull();
    expect.soft(savedFields).toEqual([]);
    expect(fetchJobStatus).not.toHaveBeenCalled();
    runtime.reset();
  });

  it.each(['image', 'video', 'audio'])('IKL6DY：普通 %s 生成的已删除失败目标同样保持消失', async (taskType) => {
    const { host, runtime, savedFields } = setup(failedRecord('removed', taskType));
    await runtime.recover(PROJECT_ID);
    expect.soft(host.findNode(NODE_ID)).toBeNull();
    expect.soft(runtime.composeSaveFields()).toBeNull();
    expect.soft(savedFields).toEqual([]);
    runtime.reset();
  });

  it.each(['pending', 'present'] as const)('未删除的 %s 失败目标仍能补回', async (state) => {
    const { host, runtime } = setup(failedRecord(state));
    await runtime.recover(PROJECT_ID);
    expect(host.findNode(NODE_ID)?.data).toMatchObject({
      genStatus: 'failed', jobId: '301',
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION_ID, outputKey: '$target' },
    });
    expect(runtime.composeSaveFields()?.recoveryChanges.some((change) => change.action === 'restore') ?? false).toBe(false);
    runtime.reset();
  });

  it.each(['removed', 'replaced', 'transferred'] as const)('生成中目标为 %s 时既不补卡也不续轮询', async (state) => {
    const record = failedRecord(state);
    record.job = { ...record.job!, status: 'processing' };
    const { host, runtime, savedFields, fetchJobStatus } = setup(record);
    await runtime.recover(PROJECT_ID);
    expect(host.findNode(NODE_ID)).toBeNull();
    expect(savedFields).toEqual([]);
    expect(fetchJobStatus).not.toHaveBeenCalled();
    runtime.reset();
  });

  it.each(['pending', 'present'] as const)('未删除的 %s 生成中目标仍能补回并续轮询', async (state) => {
    const record = failedRecord(state);
    record.job = { ...record.job!, status: 'processing' };
    const { host, runtime, fetchJobStatus } = setup(record);
    fetchJobStatus.mockResolvedValue({ job_id: '301', status: 'processing', progress: 5, asset: null });
    await runtime.recover(PROJECT_ID);
    expect(host.findNode(NODE_ID)?.data.genStatus).toBe('generating');
    expect(fetchJobStatus).toHaveBeenCalled();
    runtime.reset();
  });

  it('显式放回已删除失败卡时，仍允许生成 restore 保存指令', async () => {
    const { nodes, runtime, savedFields } = setup(failedRecord('removed'));
    nodes.set(NODE_ID, { ...failedCard(), type: 'mediaNode' });
    await runtime.recover(PROJECT_ID);
    expect(savedFields).toEqual([]);
    expect(runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: ITEM_ID, expectedRevision: 1, action: 'restore' },
    ]);
    runtime.reset();
  });

  it.each(['removed', 'replaced', 'transferred'] as const)('目标为 %s 时仍应用同一记录的其他待处理输出', async (state) => {
    const record = failedRecord(state);
    record.job = { ...record.job!, status: 'succeeded', output_asset_ids: ['12'] };
    record.items.push({ recovery_item_id: `gcr:${SUBMISSION_ID}:primary`, output_key: 'primary', node_id: 'cutout-output',
      state: 'pending', revision: 0, node_binding_revision: 0, asset_id: '12', slot_id: null });
    const { host, runtime, fetchJobStatus } = setup(record);
    fetchJobStatus.mockResolvedValue({ job_id: '301', status: 'succeeded', progress: 100,
      asset: { id: '12', url: 'https://assets.example/cutout.png', type: 'image' } });
    await runtime.recover(PROJECT_ID);
    await flush();
    expect(host.findNode(NODE_ID)).toBeNull();
    expect(host.findNode('cutout-output')?.data).toMatchObject({ assetId: '12', src: 'https://assets.example/cutout.png' });
    expect(runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${SUBMISSION_ID}:primary`, expectedRevision: 0, action: 'apply' },
    ]);
    runtime.reset();
  });
});
