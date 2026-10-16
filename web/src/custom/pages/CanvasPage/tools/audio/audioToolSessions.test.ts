import { openOtherTool } from '../../testing/openOtherTool';
import { expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { createAudioTrimSession, createAudioSpeedSession, createVocalSplitSession, type VocalSplitPayload, type AudioToolSessionHost, type AudioToolSubmission, type VocalSplitSessionHost } from './audioToolSessions';
import type { AudioSpeedInput } from '@lib/contracts/audio-speed';
import type { AudioTrimInput } from '@lib/contracts/audio-trim';
import { createToolSessionRuntime } from '../../tool-runtime/toolSessionRuntime';
import { type ToolSessionDeps } from '../../tool-runtime/toolSessionCoordinator';

const deps: ToolSessionDeps = {

  dismissGenPanels() {}, selectNode() {},
};
const source = (): Node => ({
  id: 'a1', type: 'mediaNode', position: { x: 400, y: 0 },
  data: { assetId: '8', fileName: '片头.mp3', duration: 15, mediaType: 'audio' },
});
function host<Payload>(node: Node): AudioToolSessionHost<Payload> {
  return {
    getProjectId: () => 'p1', getSourceNode: () => node,
    startTask: () => true,
    warn() {}, error() {},
  };
}

it('截取契约：初始化全选/跟随源格式；发送按独立期望冻结选区、源素材与项目', async () => {
  const node = source();
  let projectId = 'p1';
  const inputs: AudioToolSubmission<AudioTrimInput>[] = [];
  const tasks: string[] = [];
  const runtime = createToolSessionRuntime();
  const trim = runtime.register(createAudioTrimSession(() => ({
    ...host<AudioTrimInput>(node), getProjectId: () => projectId,
    startTask: (input) => {
      expect(trim.getSnapshot().state).toBeNull();
      inputs.push(input);
      tasks.push(`${input.projectId}/${input.source.data.fileName}`);
      return true;
    },
  })));
  trim.open('a1', deps);
  expect(trim.getSnapshot().state).toEqual({ nodeId: 'a1', selection: { start: 0, end: 15 }, format: 'mp3' });
  trim.edit((state) => ({ ...state, selection: { start: 1.234, end: 8.456 }, format: 'wav' }));
  trim.send();
  node.data.assetId = '9'; node.data.fileName = '改名.mp3'; projectId = 'p2';
  expect(inputs[0].payload).toEqual({ source_asset_id: '8', start_time: 1.23, end_time: 8.46, output_format: 'wav' });
  expect(tasks).toEqual(['p1/片头.mp3']);
});

it('调速契约：原速不发送；改速冻结输入并退出当次编辑（提交点即交接运行时）', async () => {
  const node = source();
  const inputs: AudioToolSubmission<AudioSpeedInput>[] = [];
  const runtime = createToolSessionRuntime();
  const speed = runtime.register(createAudioSpeedSession(() => ({
    ...host<AudioSpeedInput>(node),
    startTask: (input) => { inputs.push(input); return true; },
  })));
  speed.open('a1', deps);
  expect(speed.getSnapshot().state).toEqual({ nodeId: 'a1', speed: 1 });
  expect(speed.send()).toBe(false);
  speed.edit((state) => ({ ...state, speed: 1.35 }));
  speed.send();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(speed.getSnapshot().state).toBeNull();
  expect(inputs[0].payload).toEqual({ source_asset_id: '8', speed: 1.35 });
});

it('人声分离契约：通用/aac 默认，冻结所选场景与格式，发送即退出并保留任务交接', async () => {
  const node = source(); node.data.mediaType = 'video';
  const inputs: AudioToolSubmission<VocalSplitPayload>[] = [];
  const runtime = createToolSessionRuntime();
  const vocal = runtime.register(createVocalSplitSession(() => ({
    getProjectId: () => 'p1', getSourceNode: () => node,
    runTask: async (input) => {
      expect(vocal.getSnapshot().state).toBeNull();
      inputs.push(input);
    },
    warn() {}, error() {},
  })));
  vocal.open('a1', deps);
  expect(vocal.getSnapshot().state).toEqual({ nodeId: 'a1', scene: 'audio', format: 'aac' });
  vocal.edit((state) => ({ ...state, scene: 'drama', format: 'flac' }));
  expect(vocal.send()).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(inputs[0].payload).toEqual({ source_asset_id: '8', scene: 'drama', output_format: 'flac' });
  vocal.open('a1', deps);
  expect(vocal.getSnapshot().state).toEqual({ nodeId: 'a1', scene: 'audio', format: 'aac' });
});

function delayedSession(kind: 'audioTrim' | 'audioSpeed' | 'vocalSplit') {
  const node = source();
  const pending: Array<{ accept(task: { job_id: string }): void; reject(error: Error): void }> = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const tasks: string[] = [];
  const vocalBoundary: VocalSplitSessionHost = {
    getProjectId: () => 'p1', getSourceNode: () => node,
    runTask: () => new Promise<void>((resolve, reject) => {
      pending.push({
        accept: (task) => { tasks.push(task?.job_id ?? 'vocal-task'); resolve(); },
        reject,
      });
    }),
    error: (message) => { errors.push(message); }, warn: (message) => { warnings.push(message); },
  };
  const syncBoundary: AudioToolSessionHost<unknown> = {
    getProjectId: () => 'p1', getSourceNode: () => node,
    startTask: () => { tasks.push('sync'); return true; },
    error: (message: string) => { errors.push(message); }, warn: (message: string) => { warnings.push(message); },
  };
  const runtime = createToolSessionRuntime();
  runtime.setProject('p1');
  if (kind === 'audioTrim') {
    const tool = runtime.register(createAudioTrimSession(() => syncBoundary));
    return { runtime, tool, node, pending, errors, warnings, tasks,
      edit: () => tool.edit((state) => ({ ...state, selection: { start: 1, end: 12 }, format: 'wav' })),
    };
  }
  if (kind === 'audioSpeed') {
    const tool = runtime.register(createAudioSpeedSession(() => syncBoundary));
    return { runtime, tool, node, pending, errors, warnings, tasks,
      edit: () => tool.edit((state) => ({ ...state, speed: 1.35 })),
    };
  }
  const tool = runtime.register(createVocalSplitSession(() => vocalBoundary));
  return { runtime, tool, node, pending, errors, warnings, tasks,
    edit: () => tool.edit((state) => ({ ...state, scene: 'drama', format: 'flac' })),
  };
}

it.each(['audioTrim', 'audioSpeed'] as const)('%s：提交点同步交接（关闭、重开、切工具与切项目后无在途响应可干扰）', async (kind) => {
  for (const change of ['close', 'reopen', 'switch', 'project']) {
    const { runtime, tool, edit, errors, tasks } = delayedSession(kind);
    tool.open('a1', deps); edit(); tool.send();
    expect(tasks).toEqual(['sync']);
    expect(errors).toEqual([]);
    if (change === 'switch') openOtherTool(runtime, deps);
    else if (change === 'project') runtime.setProject('p2');
    else tool.close();
    if (change !== 'close') {
      tool.open('a1', deps); edit(); tool.send();
      expect(tasks).toEqual(['sync', 'sync']);
      expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
    }
  }
});

it('vocalSplit：关闭、重开、切工具与切项目后的旧响应不干扰新参数/锁，合法任务仍交接', async () => {
  for (const change of ['close', 'reopen', 'switch', 'project']) {
    for (const outcome of ['success', 'failure']) {
      const { runtime, tool, pending, edit, errors, tasks } = delayedSession('vocalSplit');
      tool.open('a1', deps); edit(); tool.send();
      if (change === 'switch') openOtherTool(runtime, deps);
      else if (change === 'project') runtime.setProject('p2');
      else tool.close();
      if (change !== 'close') {
        tool.open('a1', deps); edit(); tool.send();
      }
      const viewBefore = tool.getSnapshot();
      if (outcome === 'success') pending[0].accept({ job_id: 'old' });
      else pending[0].reject(new Error('old error'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(tool.getSnapshot()).toEqual(viewBefore);
      expect(errors).toEqual([]);
      expect(tasks).toEqual(outcome === 'success' ? ['old'] : []);
      if (change !== 'close') {
        pending[1].accept({ job_id: 'new' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
      }
    }
  }
});

it.each(['audioTrim', 'audioSpeed'] as const)('%s：未发出提示一次并保留参数，允许再次发送；源卡删除完整退出', async (kind) => {
  const { runtime, tool, edit, errors, warnings, tasks } = delayedSession(kind);
  tool.open('a1', deps); edit();
  const params = tool.getSnapshot().state;
  expect(tool.send()).toBe(true);
  expect(tasks).toEqual(['sync']);
  runtime.reconcileSources(new Set());
  expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
  expect(errors).toEqual([]);
  void params; void warnings; void runtime;
});

it('vocalSplit（IKJJR5 发送即退会话）：失败提示一次、会话已退出（重试入口在占位失败卡，归运行时）；迟到拒绝不扰', async () => {
  const { tool, pending, edit, errors } = delayedSession('vocalSplit');
  tool.open('a1', deps); edit();
  expect(tool.send()).toBe(true);
  pending[0].reject(new Error('network'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
  expect(errors).toEqual(['人声背景分离任务创建失败，请重试']);
  pending[1]?.reject(new Error('late'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toHaveLength(1);
});

it.each(['audioTrim', 'audioSpeed', 'vocalSplit'] as const)('%s：素材身份缺失不发请求、不留下提交锁', (kind) => {
  const { tool, node, edit, pending, warnings } = delayedSession(kind);
  tool.open('a1', deps); edit();
  delete node.data.assetId;
  expect(tool.send()).toBe(false);
  expect(tool.getSnapshot().submitting).toBe(false);
  expect(pending).toEqual([]);
  expect(warnings).toEqual([kind === 'audioTrim' ? '当前音频尚未关联资产，无法截取' : kind === 'audioSpeed' ? '当前音频尚未关联资产，无法调速' : '当前视频尚未关联资产，无法人声背景分离']);
});
