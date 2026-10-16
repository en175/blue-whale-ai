// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRecoveryPage, GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import { createAudioMix, retryAudioMix, type JobDetail } from '@/custom/api/jobs';
import MediaNode from '../components/MediaNode';
import { audioMixTask, audioVideoMuxTask } from './mixMuxTasks';
import { createGenerationRuntime } from './runtime';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

vi.mock('@/custom/api/jobs', async importOriginal => ({
  ...await importOriginal<typeof import('@/custom/api/jobs')>(),
  createAudioMix: vi.fn(), retryAudioMix: vi.fn(),
}));

const SUBMISSION = '12345678-0000-4000-8000-000000000002';
const TARGET = 'audio-mix-501';
const itemId = (key: string) => `gcr:${SUBMISSION}:${key}`;
const seedSource = (nodeId: string) => ({ node_id: nodeId, x: 0, y: 0, width: 200, height: 200, name: nodeId });

function audioRecord(): GenerationRecoveryRecord {
  return {
    submission_id: SUBMISSION, target_node_id: TARGET, job_id: '501', task_type: 'audio_mix',
    binding_revision: 1, is_current: true,
    job: { job_id: '501', type: 'audio_mix', status: 'succeeded', progress: 100,
      output_asset_ids: ['777'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: {
      target: { role: 'result-placeholder', x: 40, y: 20, width: 320, height: 320, name: '混合结果.flac' },
      sources: [seedSource('source-on-canvas'), seedSource('source-only-in-library')],
    },
    previous_target_snapshot: null,
    items: [
      { recovery_item_id: itemId('$target'), output_key: '$target', node_id: TARGET,
        state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null },
      { recovery_item_id: itemId('primary'), output_key: 'primary', node_id: TARGET,
        state: 'pending', revision: 0, node_binding_revision: 1, asset_id: null, slot_id: null },
    ],
  };
}

function savedAudioNode(): RuntimeNodeView {
  return {
    id: TARGET, type: 'mediaNode', position: { x: 999, y: 77 }, width: 650, height: 310,
    data: { fileName: '用户保存的混合音轨.wav', mediaType: 'audio', width: 650, height: 310,
      duration: 23.4, audioMix: { format: 'wav' }, toolMode: 'select', src: '' },
  };
}

function setup(record = audioRecord(), initial: RuntimeNodeView[] = [], detail: JobDetail = {
  job_id: '501', status: 'succeeded', progress: 100, asset: null, output_assets: [],
}) {
  const nodes = new Map(initial.map(node => [node.id, node]));
  const edges: Array<{ source: string; target: string }> = [];
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const epoch = {};
  const save = vi.fn(async () => true);
  const toast = vi.fn();
  const page: GenerationRecoveryPage = { protocol_version: 1, canvas_version: 3, records: [record], next_cursor: null };
  const host: GenerationRuntimeHost = {
    getProjectId: () => '1', getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()], findNode: id => nodes.get(id) ?? null,
    patchNode: (id, patch) => { const node = nodes.get(id); if (node) nodes.set(id, { ...node, data: { ...node.data, ...patch } }); },
    insertMediaNode: node => { nodes.set(node.id, node); }, removeMediaNode: id => { nodes.delete(id); },
    getEdges: () => edges, addEdge: (source, target) => { edges.push({ source, target }); },
    getActiveJob: id => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); },
    clearActiveJob: id => { owners.delete(id); },
    isLocallyRemoved: id => removed.has(id), markLocallyRemoved: id => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: () => 'terminal', settleCancelled: () => {}, saveCanvas: save,
    fetchRecoveryPage: async () => page, toast, openRechargeForCreditsError: () => false,
    addAuthResume: () => {}, rememberAsset: () => {},
  };
  const runtime = createGenerationRuntime(host, { fetchJobStatus: async () => detail });
  runtime.register(audioMixTask);
  runtime.register(audioVideoMuxTask);
  const recover = async () => {
    await runtime.recover('1');
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { runtime, nodes, edges, removed, save, toast, recover };
}

let root: Root | undefined;
let mount: HTMLDivElement | undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  mount?.remove();
  mount = undefined;
  vi.restoreAllMocks();
});

async function renderRecovered(node: RuntimeNodeView) {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  await act(async () => {
    root!.render(<ReactFlowProvider><MediaNode
      id={node.id} data={node.data} type="mediaNode" selected
      dragging={false} zIndex={1} selectable deletable draggable isConnectable
      positionAbsoluteX={node.position.x} positionAbsoluteY={node.position.y}
    /></ReactFlowProvider>);
  });
  return mount;
}

describe('IKJNVQ 音频混合缺产物恢复', () => {
  it('实际 audioMixTask 经公开 recover 补回音频混合卡，不错误转换或重发', async () => {
    const kit = setup();
    await kit.recover();
    expect(kit.nodes.get(TARGET)).toMatchObject({
      position: { x: 40, y: 20 },
      data: { mediaType: 'audio', src: '', fileName: '混合结果.flac',
        jobId: '501', audioMix: { format: 'flac' }, toolMode: 'select', progress: 100 },
    });
    expect(kit.nodes.get(TARGET)?.data.genStatus).toBeUndefined();
    expect(kit.toast).toHaveBeenCalledWith('warn', '生成结果当前不可用，原卡已保留，请核对素材');
    expect(kit.runtime.composeSaveFields()).toBeNull();
    expect(kit.removed.size).toBe(0);
    expect(kit.save).not.toHaveBeenCalled();
    expect(createAudioMix).not.toHaveBeenCalled();
    expect(retryAudioMix).not.toHaveBeenCalled();
  });

  it('实际 MediaNode 显示音频图标与适用菜单，占位宽高不显示成分辨率', async () => {
    const kit = setup();
    await kit.recover();
    const card = await renderRecovered(kit.nodes.get(TARGET)!);
    const title = card.querySelector('[data-testid="media-title"]')!;
    expect(title.querySelector('.lucide-audio-lines')).not.toBeNull();
    expect(title.textContent).toBe('混合结果.flac');
    expect(card.querySelector('[data-testid="media-content"]')).toMatchObject({
      style: { width: '480px', height: '240px' },
    });
    await act(async () => {
      card.querySelector('[data-media-type="audio"]')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 }),
      );
    });
    expect(document.body.textContent).toContain('添加到聊天');
    expect(document.body.textContent).toContain('创建副本');
    expect(document.body.textContent).toContain('删除');
    expect(document.body.textContent).not.toContain('Seedance合规校验');
  });

  it.each(['existing', 'snapshot'] as const)('%s 的保存编辑优先，真实音频时长保留且不显示宽高', async mode => {
    const record = audioRecord();
    const saved = savedAudioNode();
    if (mode === 'snapshot') record.previous_target_snapshot = { ...saved };
    const kit = setup(record, mode === 'existing' ? [saved] : []);
    await kit.recover();
    const recovered = kit.nodes.get(TARGET)!;
    expect(recovered).toMatchObject({
      position: { x: 999, y: 77 }, data: { fileName: '用户保存的混合音轨.wav', mediaType: 'audio',
        width: 650, height: 310, audioMix: { format: 'wav' }, duration: 23.4 },
    });
    const card = await renderRecovered(recovered);
    expect(card.querySelector('[data-testid="media-title"]')?.textContent).toBe('用户保存的混合音轨.wav23s');
    expect(kit.runtime.composeSaveFields()).toBeNull();
  });

  it('重复恢复只补一张卡与在场来源线，不虚构素材库来源卡', async () => {
    const source: RuntimeNodeView = {
      id: 'source-on-canvas', type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'audio' },
    };
    const kit = setup(audioRecord(), [source]);
    await kit.recover();
    await kit.recover();
    kit.runtime.reset();
    await kit.recover();
    expect([...kit.nodes.keys()]).toEqual(['source-on-canvas', TARGET]);
    expect(kit.edges).toEqual([{ source: 'source-on-canvas', target: TARGET }]);
    expect(kit.runtime.composeSaveFields()).toBeNull();
    expect(kit.removed.size).toBe(0);
  });

  it('已有目标与可靠来源关系保留，缺产物不借其他资产', async () => {
    const record = audioRecord();
    record.items[1]!.asset_id = '777';
    const saved = savedAudioNode();
    saved.data.src = 'https://example.test/user-edit.wav';
    const kit = setup(record, [saved,
      { id: 'source-on-canvas', type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'audio' } },
    ], {
      job_id: '501', status: 'succeeded', progress: 100,
      asset: { id: '778', url: 'https://example.test/unrelated.flac', type: 'audio' },
    });
    kit.edges.push({ source: 'source-on-canvas', target: TARGET });
    await kit.recover();
    expect(kit.nodes.get(TARGET)?.data.src).toBe('https://example.test/user-edit.wav');
    expect(kit.nodes.get(TARGET)?.data.assetId).toBeUndefined();
    expect(kit.edges).toEqual([{ source: 'source-on-canvas', target: TARGET }]);
    expect(kit.runtime.composeSaveFields()).toBeNull();
    expect(kit.toast).toHaveBeenCalledWith('warn', expect.any(String));
    expect(kit.save).not.toHaveBeenCalled();
  });

  it('空 primary 从唯一可信同源音频恢复，原卡普通编辑继续优先', async () => {
    const kit = setup(audioRecord(), [savedAudioNode()], {
      job_id: '501', status: 'succeeded', progress: 100,
      asset: { id: '777', url: 'https://example.test/mix.flac', type: 'audio', duration: 24 },
    });
    await kit.recover();
    expect(kit.nodes.get(TARGET)).toMatchObject({ position: { x: 999, y: 77 }, data: {
      fileName: '用户保存的混合音轨.wav', width: 650, height: 310, mediaType: 'audio',
      audioMix: { format: 'wav' }, src: 'https://example.test/mix.flac', assetId: '777', duration: 24,
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION, outputKey: 'primary' },
    } });
    expect(kit.runtime.composeSaveFields()?.recoveryChanges.map(change => change.action)).toEqual(['replaceTarget', 'apply']);
    expect(kit.toast).not.toHaveBeenCalled();
  });

  it('音视频合成合法快照的既有身份仍可恢复，保存编辑继续优先', async () => {
    const record = audioRecord();
    record.task_type = 'audio_video_mux';
    record.job!.type = 'audio_video_mux';
    record.recovery_seed!.target.role = 'draft';
    record.previous_target_snapshot = {
      id: TARGET, type: 'mediaNode', position: { x: 600, y: 40 }, width: 640, height: 360,
      data: { fileName: '用户保存的合成视频', mediaType: 'video', width: 640, height: 360,
        audioVideoMux: { sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: false,
          sync: 'video', video: { assetId: '5', nodeId: 'v1', name: '夜景.mp4' } } },
    };
    const kit = setup(record);
    await kit.recover();
    expect(kit.nodes.get(TARGET)).toMatchObject({ position: { x: 600, y: 40 }, data: {
      fileName: '用户保存的合成视频', mediaType: 'video', width: 640, height: 360,
      audioVideoMux: { sourceNodeId: 'a1', sourceAssetId: '8', sync: 'video' },
    } });
    expect(kit.runtime.composeSaveFields()).toBeNull();
  });
});
