import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { createSceneSplitSession, type SceneSplitSubmission } from './sceneSplitSession';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { createAudioVideoSplitSession } from './audioVideoSplitSession';

const deps = { dismissGenPanels() {}, selectNode() {} };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('场景切分工具定义契约', () => {
  it.each(['close', 'escape', 'selection', 'pane', 'source', 'generation'] as const)('%s 完整清理粒度与界面锁，重开恢复标准且未发送不建任务', (route) => {
    const runtime = createToolSessionRuntime();
    const tasks: SceneSplitSubmission[] = [];
    const split = runtime.register(createSceneSplitSession(() => ({
      getProjectId: () => 'p1', getSourceNode: () => ({ id: 'v1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '6' } }),
      newTargetId: () => 'scene-split-1', isSending: () => false,
      runTask: async (input) => { tasks.push(input); }, warn() {}, error() {},
    })));
    split.open('v1', deps);
    split.edit((state) => ({ ...state, granularity: 'fine' }));
    runtime.onSelectionChange({ soloId: null, multiSelect: false });
    expect(split.getSnapshot().state?.granularity).toBe('fine');
    if (route === 'close') split.close();
    if (route === 'escape') runtime.onEscape();
    if (route === 'selection') runtime.onSelectionChange({ soloId: 'v2', multiSelect: false });
    if (route === 'pane') runtime.onPaneClick();
    if (route === 'source') runtime.reconcileSources(new Set());
    if (route === 'generation') runtime.beforeGenPanel();
    expect(split.getSnapshot()).toEqual({ state: null, submitting: false });
    split.open('v1', deps);
    expect(split.getSnapshot()).toEqual({ state: { nodeId: 'v1', granularity: 'standard' }, submitting: false });
    expect(tasks).toEqual([]);
  });

  it.each(['normal', 'reopen', 'switch', 'project'] as const)('%s 的延迟失败继续交付宿主，只有本次有效反馈提示一次', async (route) => {
    const runtime = createToolSessionRuntime();
    runtime.setProject('p1');
    const errors: string[] = [];
    const failedCards: string[] = [];
    let reject!: (error: Error) => void;
    const other = runtime.register(createAudioVideoSplitSession(() => ({
      getProjectId: () => 'p1', getSourceNode: () => ({ id: 'v1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '6' } }),
      // IKJJR3：分离会话提交 = 同步 startTask（受理归运行时）
      startTask: () => true,
      warn() {}, error() {},
    })));
    const split = runtime.register(createSceneSplitSession(() => ({
      getProjectId: () => 'p1', getSourceNode: () => ({ id: 'v1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId: '6' } }),
      newTargetId: () => 'scene-split-1', isSending: () => false,
      runTask: async (input) => {
        try { await new Promise<void>((_, fail) => { reject = fail; }); }
        catch (error) { failedCards.push(input.payload.target_node_id); throw error; }
      }, warn() {}, error: (message) => { errors.push(message); },
    })));
    split.open('v1', deps);
    split.send();
    expect(split.getSnapshot().state).toBeNull();
    if (route === 'reopen') { split.open('v1', deps); split.edit((state) => ({ ...state, granularity: 'fine' })); }
    if (route === 'switch') { other.open('v1', deps); other.send(); }
    if (route === 'project') runtime.setProject('p2');
    reject(new Error('network')); await flush();
    expect(failedCards).toEqual(['scene-split-1']);
    expect(errors).toEqual(route === 'normal' ? ['场景切分任务创建失败，请重试'] : []);
    expect(split.getSnapshot()).toEqual({ state: route === 'reopen' ? { nodeId: 'v1', granularity: 'fine' } : null, submitting: false });
    if (route === 'switch') {
      expect(other.getSnapshot()).toEqual({ state: null, submitting: false }); // 同步交接完成
    }
  });

  it('同步退出后交付冻结项目、源素材、粒度与目标卡，关闭重开不释放任务锁', async () => {
    let projectId = 'p1';
    let sending = false;
    const source: Node = { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '6', fileName: '源视频' } };
    const inputs: SceneSplitSubmission[] = [];
    let accept!: () => void;
    const runtime = createToolSessionRuntime();
    const split = runtime.register(createSceneSplitSession(() => ({
      getProjectId: () => projectId, getSourceNode: () => source,
      newTargetId: () => 'scene-split-1', isSending: () => sending,
      runTask: async (input) => {
        expect(split.getSnapshot()).toEqual({ state: null, submitting: false });
        sending = true; inputs.push(input);
        await new Promise<void>((resolve) => { accept = resolve; });
        sending = false;
      },
      warn() {}, error() {},
    })));
    split.open('v1', deps);
    split.edit((state) => ({ ...state, granularity: 'coarse' }));
    expect(split.send()).toBe(true);
    projectId = 'p2'; source.data.assetId = '9'; source.position.x = 900;
    split.open('v1', deps);
    expect(split.getSnapshot()).toEqual({ state: { nodeId: 'v1', granularity: 'standard' }, submitting: false });
    expect(split.send()).toBe(false);
    expect(inputs).toEqual([{ projectId: 'p1', source: { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '6', fileName: '源视频' } }, payload: { source_asset_id: '6', target_node_id: 'scene-split-1', granularity: 'coarse' } }]);
    accept(); await flush();
    expect(split.getSnapshot().state?.granularity).toBe('standard');
    expect(split.send()).toBe(true);
    accept(); await flush();
  });
});
