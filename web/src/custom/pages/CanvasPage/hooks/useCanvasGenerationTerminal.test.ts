import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { AUDIO_SPEED_NODE_PREFIX } from '../tools/audio/audioSpeed';
import { AUDIO_TRIM_NODE_PREFIX } from '../tools/audio/audioTrim';
import { MEDIA_EXTRACT_NODE_PREFIX } from '../mediaExtract';
import { VOCAL_SPLIT_NODE_PREFIX, VOCAL_SPLIT_TRACK_NODE_PREFIX } from '../tools/audio/vocalSplit';
import {
  useCanvasGenerationTerminal,
  type CanvasGenerationTerminalHandles,
  type CanvasGenerationTerminalHost,
  type JobTerminalDetail,
} from './useCanvasGenerationTerminal';

const NODE_ID = 'node-1';
const OTHER_NODE_ID = 'node-2';
const JOB_ID = 7;

function mediaNode(id: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data };
}

function detail(status: string, extra: Record<string, unknown> = {}): JobTerminalDetail {
  return { status, ...extra } as unknown as JobTerminalDetail;
}

interface ProbeBag {
  handles: CanvasGenerationTerminalHandles | null;
  host: CanvasGenerationTerminalHost;
  removed: Set<string>;
  locallyRemoved: Set<string>;
  settled: Set<string>;
  pendingDelete: Set<string>;
  activeJob: Map<string, string>;
  nodes: Node[];
  edges: Edge[];
  addedEdges: Array<{ source: string; target: string }>;
  attached: string[];
  flushCalls: string[];
  patches: Array<{ nodeId: string; patch: Record<string, unknown> }>;
  toasts: Array<{ type: string; msg: string }>;
  upserts: unknown[][];
  removedAudioMix: string[];
}

let bag: ProbeBag;

function createBag(initialNodes: Node[]): ProbeBag {
  const next: ProbeBag = {
    handles: null,
    host: null as unknown as CanvasGenerationTerminalHost,
    removed: new Set<string>(),
    locallyRemoved: new Set<string>(),
    settled: new Set<string>(),
    pendingDelete: new Set<string>(),
    activeJob: new Map<string, string>(),
    nodes: initialNodes,
    edges: [],
    addedEdges: [],
    attached: [],
    flushCalls: [],
    patches: [],
    toasts: [],
    upserts: [],
    removedAudioMix: [],
  };
  const mediaNodesRef: CanvasGenerationTerminalHost['mediaNodesRef'] = { current: initialNodes };
  const host: CanvasGenerationTerminalHost = {
    mediaNodesRef,
    locallyRemovedGenerationNodesRef: { current: next.locallyRemoved },
    pendingDeleteJobNodesRef: { current: next.pendingDelete },
    settledExtractNodesRef: { current: next.settled },
    activeJobByNodeRef: { current: next.activeJob },
    generationRuntimeRef: { current: null },
    setMediaNodes: ((updater: unknown) => {
      next.nodes = typeof updater === 'function'
        ? (updater as (prev: Node[]) => Node[])(next.nodes)
        : (updater as Node[]);
      mediaNodesRef.current = next.nodes;
      const removed = initialNodes.filter((n) => !next.nodes.some((m) => m.id === n.id));
      removed.forEach((n) => next.removed.add(n.id));
    }) as CanvasGenerationTerminalHost['setMediaNodes'],
    upsertAssets: (items) => { next.upserts.push(items as unknown[]); },
    patchMediaNode: (nodeId, patch) => { next.patches.push({ nodeId, patch }); },
    removeAudioMixCardNow: (nodeId) => {
      next.removedAudioMix.push(nodeId);
      next.removed.add(nodeId);
    },
    showToast: (type, msg) => { next.toasts.push({ type, msg }); },
    edgesRef: { current: next.edges },
    textNodesRef: { current: [] },
    productNodesRef: { current: [] },
    assetNodesRef: { current: [] },
    currentId: 'project-1',
    attachCallbacks: (n) => { next.attached.push(n.id); return n; },
    addCanvasEdge: (source, target) => {
      next.addedEdges.push({ source, target });
      next.edges.push({ id: `e-${source}-${target}`, source, target });
    },
    nodeBoxOf: (n) => ({ x: n.position.x, y: n.position.y, width: 320, height: 340 }),
    flushCanvasSave: async (projectId) => { next.flushCalls.push(projectId); return true; },
  };
  next.host = host;
  return next;
}

function Probe({ probe }: { probe: ProbeBag }) {
  probe.handles = useCanvasGenerationTerminal(probe.host);
  return null;
}

function mount(initialNodes: Node[]): void {
  bag = createBag(initialNodes);
  renderToString(createElement(Probe, { probe: bag }));
}

function handles(): CanvasGenerationTerminalHandles {
  if (!bag.handles) throw new Error('hook 尚未挂载');
  return bag.handles;
}

function lastPatch(): Record<string, unknown> {
  return bag.patches[bag.patches.length - 1].patch;
}

function patchesFor(nodeId: string): Array<Record<string, unknown>> {
  return bag.patches.filter((p) => p.nodeId === nodeId).map((p) => p.patch);
}

describe('jobResponseGuarded 迟到响应防线', () => {
  it('节点已被本地删除时丢弃响应', async () => {
    await mount([mediaNode(NODE_ID)]);
    bag.activeJob.set(NODE_ID, String(JOB_ID));
    bag.locallyRemoved.add(NODE_ID);
    expect(handles().jobResponseGuarded(NODE_ID, JOB_ID)).toBe(false);
  });

  it('节点已离开画布时丢弃响应', async () => {
    await mount([mediaNode(OTHER_NODE_ID)]);
    bag.activeJob.set(NODE_ID, String(JOB_ID));
    expect(handles().jobResponseGuarded(NODE_ID, JOB_ID)).toBe(false);
  });

  it('活跃任务已被新任务接管时丢弃旧响应', async () => {
    await mount([mediaNode(NODE_ID)]);
    bag.activeJob.set(NODE_ID, '99');
    expect(handles().jobResponseGuarded(NODE_ID, JOB_ID)).toBe(false);
  });

  it('节点在场上且活跃任务号一致时放行', async () => {
    await mount([mediaNode(NODE_ID)]);
    bag.activeJob.set(NODE_ID, String(JOB_ID));
    expect(handles().jobResponseGuarded(NODE_ID, JOB_ID)).toBe(true);
  });
});

describe('rememberGeneratedAsset 产物字典回填', () => {
  it('缺少 id 或 url 时不写入', async () => {
    await mount([mediaNode(NODE_ID)]);
    handles().rememberGeneratedAsset({ id: '3' }, 'image');
    handles().rememberGeneratedAsset({ url: 'https://a/1.png' }, 'image');
    handles().rememberGeneratedAsset(null, 'image');
    expect(bag.upserts).toHaveLength(0);
  });

  it('资产 type 非媒体类型时回落 fallbackType', async () => {
    await mount([mediaNode(NODE_ID)]);
    handles().rememberGeneratedAsset({ id: '3', url: 'https://a/1.bin', type: 'document' }, 'video');
    expect(bag.upserts[0][0]).toMatchObject({ asset_id: 3, type: 'video', access_url: 'https://a/1.bin' });
  });

  it('宽高缺失时写入 null', async () => {
    await mount([mediaNode(NODE_ID)]);
    handles().rememberGeneratedAsset({ id: '3', url: 'https://a/1.png', type: 'image' }, 'image');
    expect(bag.upserts[0][0]).toMatchObject({ width: null, height: null, material_id: null, material_status: null });
  });
});

describe('settleCancelledNode 取消终态收敛', () => {
  it('删除意图登记优先：移除节点并标记防复活', async () => {
    await mount([mediaNode(NODE_ID)]);
    bag.pendingDelete.add(NODE_ID);
    handles().settleCancelledNode(NODE_ID);
    expect(bag.removed.has(NODE_ID)).toBe(true);
    expect(bag.locallyRemoved.has(NODE_ID)).toBe(true);
    expect(bag.pendingDelete.has(NODE_ID)).toBe(false);
  });

  it('音频混合卡走专用移除入口', async () => {
    await mount([mediaNode('audio-mix-1')]);
    bag.pendingDelete.add('audio-mix-1');
    handles().settleCancelledNode('audio-mix-1');
    expect(bag.removedAudioMix).toEqual(['audio-mix-1']);
  });

  it('草稿卡回待生成态，未自定义名称时恢复草稿名', async () => {
    await mount([mediaNode('audio-mix-1', { draft: true, mediaType: 'audio' })]);
    handles().settleCancelledNode('audio-mix-1');
    expect(lastPatch()).toMatchObject({ genStatus: 'draft', fileName: '音频草稿' });
  });

  it('已自定义名称的草稿卡回退时保留名称', async () => {
    await mount([mediaNode('audio-mix-1', { draft: true, mediaType: 'audio', customName: true })]);
    handles().settleCancelledNode('audio-mix-1');
    expect(lastPatch().fileName).toBeUndefined();
    expect(lastPatch().genStatus).toBe('draft');
  });

  it('有旧素材的成品卡恢复成品态', async () => {
    await mount([mediaNode('audio-mix-1', { jobId: 3, src: 'https://a/1.mp4' })]);
    handles().settleCancelledNode('audio-mix-1');
    expect(lastPatch()).toMatchObject({ genStatus: undefined, progress: undefined, errorText: undefined });
    expect(bag.removed.has('audio-mix-1')).toBe(false);
  });

  it('无内容可保留的占位卡移除并标记防复活', async () => {
    await mount([mediaNode('audio-mix-1', { jobId: 3, src: 'blob:preview' })]);
    handles().settleCancelledNode('audio-mix-1');
    expect(bag.removed.has('audio-mix-1')).toBe(true);
    expect(bag.locallyRemoved.has('audio-mix-1')).toBe(true);
  });

  it('节点不存在时静默返回', async () => {
    await mount([mediaNode(OTHER_NODE_ID)]);
    handles().settleCancelledNode(NODE_ID);
    expect(bag.patches).toHaveLength(0);
  });
});

describe('applyJobTerminal 家族分流终态', () => {
  it('场景切分成功但缺段返回时按失败口径兜底', async () => {
    await mount([mediaNode(NODE_ID, { sceneSplit: {} })]);
    expect(handles().applyJobTerminal(NODE_ID, JOB_ID, detail('succeeded'))).toBe('terminal');
    expect(lastPatch()).toMatchObject({ genStatus: 'failed', progress: 100 });
  });

  it('场景切分失败落失败态与家族文案', async () => {
    await mount([mediaNode(NODE_ID, { sceneSplit: {} })]);
    expect(handles().applyJobTerminal(NODE_ID, JOB_ID, detail('failed'))).toBe('terminal');
    expect(lastPatch()).toMatchObject({ genStatus: 'failed', errorText: '场景切分失败，请重试' });
  });

  it('智能抠像成功就地转成品视频卡并冻结透明标记', async () => {
    await mount([mediaNode(NODE_ID, { smartMatting: { lastInput: { format: 'WEBM' } } })]);
    expect(handles().applyJobTerminal(NODE_ID, JOB_ID, detail('succeeded', {
      asset: { id: '9', url: 'https://a/9.webm' },
    }))).toBe('terminal');
    expect(lastPatch()).toMatchObject({
      genStatus: undefined, mediaType: 'video', assetId: '9', transparentOutput: true, smartMatting: undefined,
    });
  });

  it('智能抠像 MP4 产物不设透明标记', async () => {
    await mount([mediaNode(NODE_ID, { smartMatting: { lastInput: { format: 'MP4' } } })]);
    handles().applyJobTerminal(NODE_ID, JOB_ID, detail('succeeded', { asset: { id: '9', url: 'https://a/9.mp4' } }));
    expect(lastPatch().transparentOutput).toBeUndefined();
  });

  it('智能抠像失败落家族文案', async () => {
    await mount([mediaNode(NODE_ID, { smartMatting: {} })]);
    handles().applyJobTerminal(NODE_ID, JOB_ID, detail('failed'));
    expect(lastPatch()).toMatchObject({ genStatus: 'failed' });
    expect(lastPatch().errorText).toBeTruthy();
  });

  const placeholderFamilies = [
    { label: '音频抽取', id: () => `${MEDIA_EXTRACT_NODE_PREFIX}7`, duration: 12, recordsAsset: true },
    { label: '音频截取', id: () => `${AUDIO_TRIM_NODE_PREFIX}7`, duration: 8, recordsAsset: true },
    { label: '音频调速', id: () => `${AUDIO_SPEED_NODE_PREFIX}7`, duration: 6, recordsAsset: false },
  ];

  for (const family of placeholderFamilies) {
    it(`${family.label}成功写成品字段并登记已收敛`, async () => {
      const nodeId = family.id();
      await mount([mediaNode(nodeId, { fileName: '源音频' })]);
      expect(handles().applyJobTerminal(nodeId, JOB_ID, detail('succeeded', {
        asset: { id: '5', url: 'https://a/5.mp3', duration: family.duration },
      }))).toBe('terminal');
      expect(lastPatch()).toMatchObject({ genStatus: undefined, assetId: '5', src: 'https://a/5.mp3' });
      expect(bag.settled.has(nodeId)).toBe(true);
      expect(bag.upserts).toHaveLength(family.recordsAsset ? 1 : 0);
    });

    it(`${family.label}失败落失败态`, async () => {
      const nodeId = family.id();
      await mount([mediaNode(nodeId, { fileName: '源音频' })]);
      handles().applyJobTerminal(nodeId, JOB_ID, detail('failed'));
      expect(lastPatch()).toMatchObject({ genStatus: 'failed' });
      expect(bag.settled.has(nodeId)).toBe(true);
    });

    it(`${family.label}取消落已取消态`, async () => {
      const nodeId = family.id();
      await mount([mediaNode(nodeId, { fileName: '源音频' })]);
      handles().applyJobTerminal(nodeId, JOB_ID, detail('cancelled'));
      expect(lastPatch()).toMatchObject({ genStatus: 'cancelled' });
      expect(bag.removed.has(nodeId)).toBe(false);
    });
  }

  it('音频混合成功写成品字段并清理取消待办标记', async () => {
    await mount([mediaNode('audio-mix-1', {})]);
    expect(handles().applyJobTerminal('audio-mix-1', JOB_ID, detail('succeeded', {
      asset: { id: '6', url: 'https://a/6.mp3' },
    }))).toBe('terminal');
    expect(lastPatch()).toMatchObject({ genStatus: undefined, assetId: '6', audioMixCancelPending: undefined });
  });

  it('音频混合在删除等待期失败时移除卡片', async () => {
    await mount([mediaNode('audio-mix-1', {})]);
    bag.pendingDelete.add('audio-mix-1');
    expect(handles().applyJobTerminal('audio-mix-1', JOB_ID, detail('failed'))).toBe('terminal');
    expect(bag.removedAudioMix).toEqual(['audio-mix-1']);
  });

  it('音频混合在删除等待期成功时停止删除并提示', async () => {
    await mount([mediaNode('audio-mix-1', {})]);
    bag.pendingDelete.add('audio-mix-1');
    expect(handles().applyJobTerminal('audio-mix-1', JOB_ID, detail('succeeded', {
      asset: { id: '6', url: 'https://a/6.mp3' },
    }))).toBe('terminal');
    expect(bag.removed.has('audio-mix-1')).toBe(false);
    expect(bag.toasts.at(-1)?.msg).toContain('已停止删除');
  });

  it('音频混合取消落已取消态且不移除卡片', async () => {
    await mount([mediaNode('audio-mix-1', {})]);
    expect(handles().applyJobTerminal('audio-mix-1', JOB_ID, detail('cancelled'))).toBe('terminal');
    expect(lastPatch()).toMatchObject({ genStatus: 'cancelled' });
    expect(bag.removed.has('audio-mix-1')).toBe(false);
  });

  it('人声分离成功但轨道结果缺失时保留占位卡停生成中', async () => {
    const nodeId = `${VOCAL_SPLIT_NODE_PREFIX}7`;
    await mount([mediaNode(nodeId, {})]);
    expect(handles().applyJobTerminal(nodeId, JOB_ID, detail('succeeded'))).toBe('terminal');
    expect(lastPatch()).toMatchObject({ genStatus: undefined, progress: 100 });
    expect(bag.settled.has(nodeId)).toBe(true);
  });

  it('人声分离失败落失败态', async () => {
    const nodeId = `${VOCAL_SPLIT_NODE_PREFIX}7`;
    await mount([mediaNode(nodeId, {})]);
    handles().applyJobTerminal(nodeId, JOB_ID, detail('failed'));
    expect(lastPatch()).toMatchObject({ genStatus: 'failed' });
  });

  it('通用成功回填产物字段并清理插帧身份', async () => {
    await mount([mediaNode(NODE_ID, { frameInterpolation: {}, mediaType: 'video' })]);
    expect(handles().applyJobTerminal(NODE_ID, JOB_ID, detail('succeeded', {
      asset: { id: '11', url: 'https://a/11.mp4', type: 'video', width: 1280, height: 720 },
    }))).toBe('terminal');
    expect(lastPatch()).toMatchObject({
      genStatus: undefined, src: 'https://a/11.mp4', assetId: '11',
      width: 1280, height: 720, frameInterpolation: undefined,
    });
    expect(bag.upserts).toHaveLength(1);
  });

  it('通用成功在删除等待期停止删除并提示', async () => {
    await mount([mediaNode(NODE_ID, { mediaType: 'video' })]);
    bag.pendingDelete.add(NODE_ID);
    handles().applyJobTerminal(NODE_ID, JOB_ID, detail('succeeded', { asset: { id: '11', url: 'https://a/11.mp4' } }));
    expect(bag.removed.has(NODE_ID)).toBe(false);
    expect(bag.toasts.at(-1)?.msg).toContain('已停止删除');
  });

  it('通用失败落失败态并带走失败码', async () => {
    await mount([mediaNode(NODE_ID, { mediaType: 'video' })]);
    handles().applyJobTerminal(NODE_ID, JOB_ID, detail('failed', {
      error: { code: 'RATIO', msg: '比例不符' },
    }));
    expect(lastPatch()).toMatchObject({ genStatus: 'failed', errorText: '比例不符', errorCode: 'RATIO' });
  });

  it('通用失败在删除等待期移除卡片', async () => {
    await mount([mediaNode(NODE_ID, { mediaType: 'video' })]);
    bag.pendingDelete.add(NODE_ID);
    handles().applyJobTerminal(NODE_ID, JOB_ID, detail('failed'));
    expect(bag.removed.has(NODE_ID)).toBe(true);
  });

  it('核对中锁定为处理中且不改预扣', async () => {
    await mount([mediaNode(NODE_ID, { mediaType: 'video' })]);
    expect(handles().applyJobTerminal(NODE_ID, JOB_ID, detail('checking'))).toBe('processing');
    expect(lastPatch()).toMatchObject({ genStatus: 'checking' });
  });

  it('通用取消经收敛回待生成态', async () => {
    await mount([mediaNode(NODE_ID, { draft: true, mediaType: 'video' })]);
    expect(handles().applyJobTerminal(NODE_ID, JOB_ID, detail('cancelled'))).toBe('terminal');
    expect(lastPatch()).toMatchObject({ genStatus: 'draft' });
  });

  it('节点已删除时按终态返回不再续链', async () => {
    await mount([mediaNode(OTHER_NODE_ID)]);
    expect(handles().applyJobTerminal(NODE_ID, JOB_ID, detail('succeeded'))).toBe('terminal');
    expect(bag.patches).toHaveLength(0);
  });

  it('清理超时的成功任务回写文本签名且旧任务不清除更晚编辑', async () => {
    await mount([mediaNode(NODE_ID, { mediaType: 'image' })]);
    handles().applyJobTerminal(NODE_ID, JOB_ID, detail('succeeded', {
      asset: { id: '11', url: 'https://a/11.png' },
      text_input_signature: 'sig-1',
    }));
    expect(patchesFor(NODE_ID).at(-1)).toMatchObject({ usedInputSignature: 'sig-1', usedInputJobId: JOB_ID });
  });
});

describe('fanOutVocalSplitTracks 人声分离轨卡扇出', () => {
  const VOCAL_ID = `${VOCAL_SPLIT_NODE_PREFIX}42`;

  it('按轨道结果扇出成品轨卡、拉来源边并落库', async () => {
    await mount([
      mediaNode(VOCAL_ID, { vocalSplit: { lastInput: { output_format: 'MP3' } }, fileName: '来源(人声背景分离)' }),
      mediaNode('src-1', { assetId: 'a1' }),
    ]);
    bag.edges.push({ id: `e-src-1-${VOCAL_ID}`, source: 'src-1', target: VOCAL_ID });
    handles().fanOutVocalSplitTracks(VOCAL_ID, detail('succeeded', {
      tracks: [
        { track_type: 'voice', asset_id: 't1', url: 'https://a/voice.mp3', duration: 10 },
        { track_type: 'background', asset_id: 't2', url: 'https://a/bg.mp3', duration: 20 },
      ],
    }));
    const ids = bag.nodes.map((n) => n.id);
    expect(ids).toContain(`${VOCAL_SPLIT_TRACK_NODE_PREFIX}42-voice`);
    expect(ids).toContain(`${VOCAL_SPLIT_TRACK_NODE_PREFIX}42-background`);
    expect(ids).not.toContain(VOCAL_ID);
    expect(bag.locallyRemoved.has(VOCAL_ID)).toBe(true);
    expect(bag.addedEdges).toHaveLength(2);
    expect(bag.addedEdges.every((e) => e.source === 'src-1')).toBe(true);
    expect(bag.flushCalls).toEqual(['project-1']);
  });

  it('轨道结果缺失时保留占位卡停生成中', async () => {
    await mount([mediaNode(VOCAL_ID, { vocalSplit: { lastInput: { output_format: 'MP3' } } })]);
    handles().fanOutVocalSplitTracks(VOCAL_ID, detail('succeeded'));
    expect(lastPatch()).toMatchObject({ genStatus: undefined, progress: 100 });
    expect(bag.nodes.map((n) => n.id)).toContain(VOCAL_ID);
  });

  it('占位卡不在场上时静默返回', async () => {
    await mount([mediaNode(OTHER_NODE_ID)]);
    handles().fanOutVocalSplitTracks(VOCAL_ID, detail('succeeded', {
      tracks: [{ track_type: 'voice', asset_id: 't1', url: 'https://a/voice.mp3', duration: 10 }],
    }));
    expect(bag.patches).toHaveLength(0);
    expect(bag.nodes.map((n) => n.id)).not.toContain(VOCAL_ID);
  });
});

describe('fanOutSceneSplitSegments 场景切分段卡扇出', () => {
  const PLACEHOLDER = 'scene-split-9';
  const SEGMENTS = [
    { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: 's1' },
    { segment_index: 2, start_time: 15, end_time: 46, segment_asset_id: 's2' },
  ];
  const OUTPUT_ASSETS = [
    { id: 's1', url: 'https://a/s1.mp4', width: 640, height: 360 },
    { id: 's2', url: 'https://a/s2.mp4', width: 640, height: 360 },
  ];

  it('按段结果在源卡右侧扇出段卡、拉来源边并落库', async () => {
    await mount([
      mediaNode(PLACEHOLDER, { sceneSplit: { sourceAssetId: 'a1' } }),
      mediaNode('src-1', { assetId: 'a1' }),
    ]);
    handles().fanOutSceneSplitSegments(PLACEHOLDER, JOB_ID, detail('succeeded', {
      result: { segments: SEGMENTS },
      output_assets: OUTPUT_ASSETS,
    }));
    const segs = bag.nodes.filter((n) => n.id.startsWith('scene-segment-'));
    expect(segs).toHaveLength(2);
    expect(bag.nodes.map((n) => n.id)).not.toContain(PLACEHOLDER);
    expect(bag.locallyRemoved.has(PLACEHOLDER)).toBe(true);
    expect(bag.addedEdges).toHaveLength(2);
    expect(bag.addedEdges.every((e) => e.source === 'src-1')).toBe(true);
    expect(bag.upserts).toHaveLength(2);
    expect(bag.flushCalls).toEqual(['project-1']);
  });

  it('段结果为空时按失败口径兜底', async () => {
    await mount([mediaNode(PLACEHOLDER, { sceneSplit: {} })]);
    handles().fanOutSceneSplitSegments(PLACEHOLDER, JOB_ID, detail('succeeded', { result: { segments: [] } }));
    expect(lastPatch()).toMatchObject({ genStatus: 'failed', progress: 100 });
  });

  it('占位卡不在场上时静默返回', async () => {
    await mount([mediaNode(OTHER_NODE_ID)]);
    handles().fanOutSceneSplitSegments(PLACEHOLDER, JOB_ID, detail('succeeded', {
      result: { segments: SEGMENTS },
      output_assets: OUTPUT_ASSETS,
    }));
    expect(bag.patches).toHaveLength(0);
    expect(bag.nodes.map((n) => n.id)).not.toContain(PLACEHOLDER);
  });
});
