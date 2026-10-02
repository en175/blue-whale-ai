import type { Node } from '@xyflow/react';
import { ApiError } from '@/api/http';
import { describe, expect, it } from 'vitest';
import { createToolSessionRuntime, type LegacyToolSessionDeps } from './toolSessionRuntime';
import { createImageEnhanceSession, createFrameInterpolationSession, createVideoEnhanceSession, type PanelToolHost, type VideoEnhanceSubmission } from './panelToolSessions';

const deps: LegacyToolSessionDeps = { activity: {}, exits: {}, dismissGenPanels() {}, selectNode() {} };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  let projectId = 'p1';
  const nodes: Node[] = [{ id: 'a', position: { x: 0, y: 0 }, data: { draft: true, videoEnhance: { sourceAssetId: '5', lastParams: { resolution: '1080p' } } } }];
  const errors: string[] = [];
  const inputs: VideoEnhanceSubmission[] = [];
  const pending: { resolve(): void; reject(error: unknown): void }[] = [];
  const host: PanelToolHost = {
    getProjectId: () => projectId, getNode: (id) => nodes.find((node) => node.id === id), getNodes: () => nodes,
    canOpen: () => true, activate() {}, isValidTarget: () => true, isFrameInFlight: () => false,
    warn: (message) => errors.push(message), error: (message) => errors.push(message), httpError: (message) => errors.push(message),
    startImage: async () => {}, startFrame: async () => true,
    startVideo: (input) => { inputs.push(input); return new Promise<void>((resolve, reject) => pending.push({ resolve, reject })); },
  };
  const runtime = createToolSessionRuntime(); runtime.setProject('p1');
  const video = runtime.register(createVideoEnhanceSession(() => host));
  return { runtime, video, host, nodes, errors, inputs, pending, setProject: (id: string) => { projectId = id; runtime.setProject(id); } };
}

describe('HD 面板通过运行时的提交契约', () => {
  it('可见同卡重入保留 seed 和提交锁，门槛拒绝仍保留原面板', () => {
    const { video, host } = setup();
    video.open('a', deps);
    const seed = video.getSnapshot().state?.seed;
    video.send('2k');
    expect(video.open('a', deps)).toBe(true);
    expect(video.getSnapshot().state?.seed).toBe(seed);
    expect(video.getSnapshot().submitting).toBe(true);
    host.canOpen = () => false;
    expect(video.open('a', deps)).toBe(false);
    expect(video.getSnapshot().state?.seed).toBe(seed);
  });
  it('捕获项目、来源和参数；失败保留面板，可再次发送，受理后关闭', async () => {
    const { video, nodes, inputs, pending, errors } = setup();
    video.open('a', deps); video.send('2k');
    (nodes[0]!.data.videoEnhance as { sourceAssetId: string }).sourceAssetId = '9';
    expect(inputs[0]?.payload).toEqual({ source_asset_id: '5', target_node_id: 'a', resolution: '2k' });
    expect(inputs[0]?.projectId).toBe('p1');
    expect(video.send('4k')).toBe(false);
    pending[0]!.reject(new Error('network')); await flush();
    expect(errors).toEqual(['HD 高清任务创建失败，请重试']);
    expect(video.getSnapshot().visible).toBe(true);
    expect(video.getSnapshot().submitting).toBe(false);
    video.send('4k'); pending[1]!.resolve(); await flush();
    expect(video.getSnapshot().visible).toBe(false);
  });
  it('当前有效 HD HTTP 失败保留原 HTTP 与画布两路提示，后来会话不接收这两路旧错误', async () => {
    for (const reopen of [false, true]) {
      const { video, pending, errors } = setup();
      video.open('a', deps); video.send('2k');
      if (reopen) { video.close(); video.open('a', deps); }
      pending[0]!.reject(new ApiError(400, '输入超出限制')); await flush();
      expect(errors).toEqual(reopen ? [] : ['输入超出限制', '输入超出限制']);
    }
  });
  it.each(['close', 'reopen', 'switch', 'project'] as const)('%s 后旧成功/失败不关闭新界面、不解新锁、不弹旧错误', async (change) => {
    for (const success of [true, false]) {
      const { runtime, video, pending, errors, setProject } = setup();
      video.open('a', deps); video.send('2k');
      if (change === 'project') setProject('p2');
      else if (change === 'switch') runtime.enterLegacy('audioMix', deps, () => {});
      else video.close();
      if (change !== 'close') { video.open('a', deps); video.send('4k'); }
      if (success) pending[0]!.resolve(); else pending[0]!.reject(new Error('old'));
      await flush();
      expect(errors).toEqual([]);
      expect(video.getSnapshot().visible).toBe(change !== 'close');
      expect(video.getSnapshot().submitting).toBe(change !== 'close');
    }
  });
});

it('高清发送即退出仍接收有效失败；同卡重开后旧失败不提示，原任务继续收尾', async () => {
  for (const reopen of [false, true]) {
    const { runtime, host, nodes, errors } = setup();
    nodes[0]!.data.imageEnhance = { sourceAssetId: '5' };
    let reject!: (error: unknown) => void;
    host.startImage = () => new Promise<void>((_resolve, fail) => { reject = fail; });
    const image = runtime.register(createImageEnhanceSession(() => host));
    image.open('a', deps);
    expect(image.send({ version_tier: 'lite', multiple: 2, generative_enhance_mode: 'fidelity_first', enable_correct_color: true })).toBe(true);
    expect(image.getSnapshot().visible).toBe(false);
    if (reopen) image.open('a', deps);
    reject(new Error('network')); await flush();
    expect(errors).toEqual(reopen ? [] : ['创建任务失败']);
    expect(image.getSnapshot().visible).toBe(reopen);
  }
});

it('插帧每次重入新身份、按卡重算在途；旧成功保留新面板，合法任务释放自己的在途锁', async () => {
  const { runtime, host, nodes } = setup();
  const inFlight = new Set<string>();
  nodes[0]!.data.frameInterpolation = { sourceAssetId: '5', lastParams: { fps: 60 } };
  nodes.push({ id: 'b', position: { x: 0, y: 0 }, data: { frameInterpolation: { sourceAssetId: '7', lastParams: { fps: 30 } } } });
  let resolve!: () => void;
  host.isFrameInFlight = (id) => inFlight.has(id);
  host.startFrame = async (input) => {
    inFlight.add(input.nodeId);
    await new Promise<void>((done) => { resolve = done; });
    inFlight.delete(input.nodeId);
    runtime.reconcileSources(new Set(['a', 'b']));
    return true;
  };
  const frame = runtime.register(createFrameInterpolationSession(() => host));
  frame.open('a', deps); frame.send(60);
  frame.close(); frame.open('a', deps);
  expect(frame.getSnapshot().state?.inFlight).toBe(true);
  expect(frame.send(120)).toBe(false);
  frame.open('b', deps);
  expect(frame.getSnapshot().state?.inFlight).toBe(false);
  expect(frame.getSnapshot().state?.seed.initialFps).toBe(30);
  frame.open('a', deps);
  resolve(); await flush();
  expect(frame.getSnapshot().visible).toBe(true);
  expect(frame.getSnapshot().submitting).toBe(false);
  expect(frame.getSnapshot().state?.inFlight).toBe(false);
  expect(inFlight.size).toBe(0);
});

it('三个面板身份删除即解绑；来源素材删除保留目标', () => {
  for (const kind of ['image', 'video', 'frame'] as const) {
    const { runtime, host, nodes, errors } = setup();
    nodes[0]!.data.imageEnhance = { sourceAssetId: '5' };
    nodes[0]!.data.frameInterpolation = { sourceAssetId: '5' };
    nodes.push({ id: 'source', position: { x: 0, y: 0 }, data: { assetId: '5', width: 1600, height: 900 } });
    host.isValidTarget = (id, panelKind) => Boolean(nodes.find((node) => node.id === id)?.data[panelKind]);
    const request = kind === 'image'
      ? runtime.register(createImageEnhanceSession(() => host))
      : kind === 'video' ? runtime.register(createVideoEnhanceSession(() => host))
        : runtime.register(createFrameInterpolationSession(() => host));
    request.open('a', deps);
    nodes.pop();
    runtime.reconcileSources(new Set(['a']));
    expect(request.getSnapshot().visible).toBe(true);
    // 源资产只在冻结输入中，运行时按派生目标的身份判断解绑。
    delete nodes[0]!.data.imageEnhance; delete nodes[0]!.data.videoEnhance; delete nodes[0]!.data.frameInterpolation;
    runtime.reconcileSources(new Set(['a']));
    expect(request.getSnapshot().state).toBeNull();
    expect(errors).toEqual([]);
  }
});

it.each(['close', 'reopen', 'switch', 'project'] as const)('插帧 %s 后旧成功/失败不干扰界面；任务在途锁独立释放', async (change) => {
  for (const success of [true, false]) {
    const { runtime, host, nodes, errors, setProject } = setup();
    nodes[0]!.data.frameInterpolation = { sourceAssetId: '5' };
    const inFlight = new Set<string>();
    const completed: string[] = [];
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    host.isFrameInFlight = (id) => inFlight.has(id);
    host.startFrame = async (input) => {
      inFlight.add(input.nodeId);
      try {
        await new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
        completed.push(input.nodeId); return true;
      } finally {
        inFlight.delete(input.nodeId);
        runtime.reconcileSources(new Set(['a']));
      }
    };
    const frame = runtime.register(createFrameInterpolationSession(() => host));
    frame.open('a', deps); frame.send(60);
    if (change === 'switch') runtime.enterLegacy('audioMix', deps, () => {});
    else if (change === 'project') setProject('p2');
    else frame.close();
    expect(inFlight.has('a')).toBe(true);
    if (change === 'reopen') frame.open('a', deps);
    if (success) finish(); else fail(new Error('old'));
    await flush();
    expect(errors).toEqual([]);
    expect(inFlight.size).toBe(0);
    expect(completed).toEqual(success ? ['a'] : []);
    expect(frame.getSnapshot().visible).toBe(change === 'reopen');
    expect(frame.getSnapshot().state?.inFlight ?? false).toBe(false);
  }
});

it('会话有效时高清、HD 和插帧的 401 都交登录层，不弹面板错误', async () => {
  const { runtime, host, nodes, errors } = setup();
  nodes[0]!.data.imageEnhance = { sourceAssetId: '5' };
  nodes[0]!.data.frameInterpolation = { sourceAssetId: '5' };
  host.startImage = host.startVideo = async () => { throw new ApiError(401, '未登录'); };
  host.startFrame = async () => { throw new ApiError(401, '未登录'); };
  const image = runtime.register(createImageEnhanceSession(() => host));
  image.open('a', deps); image.send({ version_tier: 'pro', multiple: 2, generative_enhance_mode: 'generative_first', enable_correct_color: false });
  await flush();
  const video = runtime.register(createVideoEnhanceSession(() => host));
  video.open('a', deps); video.send('2k'); await flush();
  const frame = runtime.register(createFrameInterpolationSession(() => host));
  frame.open('a', deps); frame.send(60); await flush();
  expect(errors).toEqual([]);
  expect(frame.getSnapshot().visible).toBe(true);
  expect(frame.getSnapshot().submitting).toBe(false);
});
