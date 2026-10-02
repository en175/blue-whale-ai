import { expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { TOOL_SESSION_KINDS, type ToolSessionDeps } from './toolSessionCoordinator';
import { createCutoutSession, createOutpaintSession, type OutpaintFrozenInput, type CutoutSubmission } from './imageToolSessions';

const deps: ToolSessionDeps = {
  activity: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, null])) as ToolSessionDeps['activity'],
  exits: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, () => {}])) as ToolSessionDeps['exits'],
  dismissGenPanels() {}, selectNode() {},
};
const source: Node = { id: 'i1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '5', mediaType: 'image', width: 600, height: 600 } };

it('抠图默认参数不残留；发送冻结项目、来源与主体描边参数，受理后退出再交接', async () => {
  let accept!: (task: { job_id: string }) => void;
  const inputs: CutoutSubmission[] = [];
  const runtime = createToolSessionRuntime();
  const tool = runtime.register(createCutoutSession(() => ({
    getProjectId: () => 'p1', getSourceNode: () => source, newTargetId: () => 'cutout1',
    createTask: (input) => { inputs.push(input); return new Promise((resolve) => { accept = resolve; }); },
    handoff: async (_input, _task, skipSelect) => { expect(tool.getSnapshot().state).toBeNull(); expect(skipSelect).toBe(false); },
    warn() {}, error() {},
  })));
  tool.open('i1', deps);
  expect(tool.getSnapshot().state).toEqual({ nodeId: 'i1', scene: 'general', needContour: false, contourSize: 10, needCropBackground: false });
  tool.edit((state) => ({ ...state, scene: 'human', needContour: true, contourSize: 20, needCropBackground: true }));
  expect(tool.send()).toBe(true);
  expect(tool.getSnapshot().state?.nodeId).toBe('i1');
  accept({ job_id: 'j1' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(inputs[0].projectId).toBe('p1');
  expect(inputs[0].payload).toEqual({ source_asset_id: '5', target_node_id: 'cutout1', cutout_scene: 'human', need_contour: true, contour_size: 20, contour_color: '#FFFFFF', need_crop_background: true });
  tool.open('i1', deps);
  expect(tool.getSnapshot().state?.scene).toBe('general');
});

it('扩图从零开始；非零发送冻结比例，先准备结果卡并启动请求，再退出编辑', async () => {
  const runtime = createToolSessionRuntime();
  const prepared: OutpaintFrozenInput[] = [];
  let accept!: () => void;
  let pickCleared = false;
  const tool = runtime.register(createOutpaintSession(() => ({
    getProjectId: () => 'p1', getSourceNode: () => source,
    clearPickState: () => { pickCleared = true; },
    prepareTask: (input) => { prepared.push(input); return { projectId: input.projectId, source: input.source, targetNodeId: 'expanded1', payload: { source_asset_id: '5', target_node_id: 'expanded1', expand_top: 0, expand_bottom: 0, expand_left: 0, expand_right: 0.25 } }; },
    startTask: () => {
      expect(tool.getSnapshot().state?.nodeId).toBe('i1');
      return new Promise<void>((resolve) => { accept = resolve; });
    },
    warn() {}, error() {},
  })));
  tool.open('i1', deps);
  expect(pickCleared).toBe(true);
  expect(tool.send()).toBe(false);
  tool.edit((state) => ({ ...state, expands: { top: 0, bottom: 0, left: 0, right: 70 } }));
  expect(tool.send()).toBe(true);
  expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
  expect(prepared[0].ratios).toEqual({ top: 0, bottom: 0, left: 0, right: 0.25 });
  accept();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

it.each(['cutout', 'outpaint'] as const)('%s 公共事件：源卡点击保留，其他卡点击消费/选中新卡，空选中与多选不误退', (kind) => {
  const runtime = createToolSessionRuntime();
  const selected: string[] = [];
  const currentDeps = { ...deps, selectNode: (id: string) => { selected.push(id); } };
  const tool = kind === 'cutout'
    ? runtime.register(createCutoutSession(() => ({ getProjectId: () => 'p1', getSourceNode: () => source, newTargetId: () => 'c1', createTask: async () => ({ job_id: 'j1' }), handoff: async () => {}, warn() {}, error() {} })))
    : runtime.register(createOutpaintSession(() => ({ getProjectId: () => 'p1', getSourceNode: () => source, clearPickState() {}, prepareTask: () => null, startTask: async () => {}, warn() {}, error() {} })));
  tool.open('i1', currentDeps);
  expect(runtime.onNodeClick('i1', currentDeps)).toBe('consumed');
  expect(tool.getSnapshot().state?.nodeId).toBe('i1');
  expect(runtime.onSelectionChange({ soloId: null, multiSelect: false }, currentDeps)).toBe(true);
  expect(runtime.onSelectionChange({ soloId: 'other', multiSelect: true }, currentDeps)).toBe(true);
  expect(tool.getSnapshot().state?.nodeId).toBe('i1');
  expect(runtime.onEscape(currentDeps)).toBe(false);
  expect(runtime.onNodeClick('other', currentDeps)).toBe('consumed');
  expect(tool.getSnapshot().state).toBeNull();
  expect(selected).toEqual(['other']);
});

it.each([
  ['reopen', 'success'], ['project', 'success'], ['other-tool', 'success'],
  ['reopen', 'failure'], ['project', 'failure'], ['other-tool', 'failure'],
] as const)('抠图 %s 后旧 %s 不关闭新会话或清新锁；合法受理继续交接冻结来源', async (later, outcome) => {
  const runtime = createToolSessionRuntime();
  runtime.setProject('p1');
  let projectId = 'p1';
  const mutableSource = { ...source, position: { ...source.position }, data: { ...source.data } };
  let accept!: (task: { job_id: string }) => void;
  let reject!: (error: Error) => void;
  const errors: string[] = [];
  const handed: Array<{ input: CutoutSubmission; skipSelect: boolean }> = [];
  const tool = runtime.register(createCutoutSession(() => ({
    getProjectId: () => projectId, getSourceNode: () => mutableSource, newTargetId: () => 'c1',
    createTask: () => new Promise((resolve, fail) => { accept = resolve; reject = fail; }),
    handoff: async (input, _task, skipSelect) => { handed.push({ input, skipSelect }); },
    warn() {}, error: (message) => { errors.push(message); },
  })));
  tool.open('i1', deps);
  tool.send();
  const acceptFirst = accept;
  const rejectFirst = reject;
  if (later === 'project') { projectId = 'p2'; runtime.setProject('p2'); }
  if (later === 'other-tool') runtime.enterLegacy('crop', deps, () => {});
  if (later === 'reopen') {
    tool.open('i1', deps);
    tool.edit((state) => ({ ...state, contourSize: 30 }));
    tool.send();
  }
  mutableSource.position.x = 999;
  mutableSource.data.assetId = '99';
  if (outcome === 'success') acceptFirst({ job_id: 'j1' });
  else rejectFirst(new Error('旧失败'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toEqual([]);
  if (outcome === 'success') {
    expect(handed[0].input.projectId).toBe('p1');
    expect(handed[0].input.source.position.x).toBe(400);
    expect(handed[0].input.payload.source_asset_id).toBe('5');
    expect(handed[0].skipSelect).toBe(true);
  } else expect(handed).toEqual([]);
  if (later === 'reopen') expect(tool.getSnapshot()).toMatchObject({ state: { contourSize: 30 }, submitting: true });
});

it.each(['project', 'other-tool'] as const)('扩图发送即退后 %s 使旧失败反馈失效，任务收到冻结项目与参数', async (later) => {
  const runtime = createToolSessionRuntime();
  runtime.setProject('p1');
  let projectId = 'p1';
  let reject!: (error: Error) => void;
  const errors: string[] = [];
  const tool = runtime.register(createOutpaintSession(() => ({
    getProjectId: () => projectId, getSourceNode: () => source, clearPickState() {},
    prepareTask: (input) => ({ ...input, targetNodeId: 'o1', payload: { source_asset_id: input.sourceAssetId, target_node_id: 'o1', expand_top: 0, expand_bottom: 0, expand_left: 0, expand_right: input.ratios.right } }),
    startTask: (input) => {
      expect(input.projectId).toBe('p1');
      expect(input.payload.expand_right).toBe(0.25);
      return new Promise<void>((_accept, fail) => { reject = fail; });
    },
    warn() {}, error: (message) => { errors.push(message); },
  })));
  tool.open('i1', deps);
  tool.edit((state) => ({ ...state, expands: { top: 0, bottom: 0, left: 0, right: 70 } }));
  tool.send();
  expect(tool.getSnapshot().state).toBeNull();
  if (later === 'project') { projectId = 'p2'; runtime.setProject('p2'); }
  else runtime.enterLegacy('crop', deps, () => {});
  reject(new Error('旧扩图失败'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toEqual([]);
});
