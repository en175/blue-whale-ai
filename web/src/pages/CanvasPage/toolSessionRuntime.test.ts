import { describe, expect, it } from 'vitest';
import { createToolSessionRuntime, type ToolSessionDefinition } from './toolSessionRuntime';
import { TOOL_SESSION_KINDS, type ToolSessionDeps } from './toolSessionCoordinator';

function legacyDeps(): ToolSessionDeps {
  return {
    activity: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, null])) as ToolSessionDeps['activity'],
    exits: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, () => {}])) as ToolSessionDeps['exits'],
    dismissGenPanels() {}, selectNode() {},
  };
}

const definition: ToolSessionDefinition<{ nodeId: string; format: string }, string, string> = {
  kind: 'audioVideoSplit',
  initialize: (nodeId) => ({ nodeId, format: 'm4a' }),
  target: (state) => state.nodeId,
  capture: (state) => state.format,
  submit: async () => {},
  onError() {},
};

it('面板选择隐藏保留绑定；空通知不退出，显式关闭后不由选中回弹，同卡可见重入保留内容', () => {
  const runtime = createToolSessionRuntime();
  let seed = 0;
  const panel = runtime.register({ ...definition, kind: 'videoEnhance', panel: 'preserve',
    initialize: (nodeId: string, previous?: { nodeId: string; format: string }) => previous?.nodeId === nodeId ? previous : { nodeId, format: `seed-${++seed}` },
  });
  panel.open('v1', legacyDeps());
  panel.edit((state) => ({ ...state, format: '4k' }));
  panel.open('v1', legacyDeps());
  expect(panel.getSnapshot().state?.format).toBe('4k');
  expect(panel.getSnapshot().visible).toBe(true);
  runtime.onSelectionChange({ soloId: null, multiSelect: false }, legacyDeps());
  expect(panel.getSnapshot().visible).toBe(true);
  runtime.onSelectionChange({ soloId: 'v2', multiSelect: false }, legacyDeps());
  expect(panel.getSnapshot().visible).toBe(false);
  expect(panel.getSnapshot().state?.nodeId).toBe('v1');
  runtime.onSelectionChange({ soloId: 'v1', multiSelect: false }, legacyDeps());
  expect(panel.getSnapshot().visible).toBe(true);
  panel.close();
  runtime.onSelectionChange({ soloId: 'v1', multiSelect: false }, legacyDeps());
  expect(panel.getSnapshot().state).toBeNull();
  expect(panel.getSnapshot().hidden).toBe(true);
  panel.open('v1', legacyDeps());
  expect(panel.getSnapshot().state?.format).toBe('seed-2');
});

it.each(['close', 'escape', 'pane', 'generation', 'editor'] as const)('面板 %s 退出由运行时处理，与编辑会话和其他面板互斥', (route) => {
  const runtime = createToolSessionRuntime();
  const panel = runtime.register({ ...definition, kind: 'videoEnhance', panel: 'reinitialize' });
  const frame = runtime.register({ ...definition, kind: 'frameInterpolation', panel: 'reinitialize' });
  const split = runtime.register(definition);
  split.open('source', legacyDeps());
  panel.open('a', legacyDeps());
  expect(split.getSnapshot().state).toBeNull();
  frame.open('b', legacyDeps());
  expect(panel.getSnapshot().state).toBeNull();
  expect(frame.getSnapshot().visible).toBe(true);
  runtime.onSelectionChange({ soloId: null, multiSelect: false }, legacyDeps());
  expect(frame.getSnapshot().visible).toBe(true);
  if (route === 'close') frame.close();
  if (route === 'escape') expect(runtime.onEscape(legacyDeps())).toBe(true);
  if (route === 'pane') expect(runtime.onPaneClick(legacyDeps())).toBe('consumed');
  if (route === 'generation') runtime.beforeGenPanel(legacyDeps());
  if (route === 'editor') split.open('source', legacyDeps());
  expect(frame.getSnapshot().state).toBeNull();
  runtime.onSelectionChange({ soloId: 'b', multiSelect: false }, legacyDeps());
  expect(frame.getSnapshot().visible).toBe(false);
});

describe('工具会话运行时公开接口', () => {
  it('进入、参数编辑、退出和同卡重开：状态只有运行时拥有，重开恢复默认参数', () => {
    const runtime = createToolSessionRuntime();
    const split = runtime.register(definition);
    split.open('v1', legacyDeps());
    split.edit((state) => ({ ...state, format: 'wav' }));
    expect(split.getSnapshot()).toEqual({ state: { nodeId: 'v1', format: 'wav' }, submitting: false });
    split.close();
    expect(split.getSnapshot()).toEqual({ state: null, submitting: false });
    split.open('v1', legacyDeps());
    expect(split.getSnapshot()).toEqual({ state: { nodeId: 'v1', format: 'm4a' }, submitting: false });
  });
  it('发送同步锁住当前界面，失败后可调整参数再次发送', async () => {
    const runtime = createToolSessionRuntime();
    const errors: string[] = [];
    let reject!: (error: Error) => void;
    const inputs: string[] = [];
    const split = runtime.register({ ...definition,
      submit: (input: string) => { inputs.push(input); return new Promise<void>((_, fail) => { reject = fail; }); },
      onError: () => { errors.push('创建失败'); },
    });
    split.open('v1', legacyDeps());
    expect(split.send()).toBe(true);
    expect(split.send()).toBe(false);
    expect(split.getSnapshot().submitting).toBe(true);
    reject(new Error('network'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual(['创建失败']);
    expect(split.getSnapshot().submitting).toBe(false);
    split.edit((state) => ({ ...state, format: 'wav' }));
    expect(split.send()).toBe(true);
    expect(inputs).toEqual(['m4a', 'wav']);
  });

  it.each(['close', 'reopen', 'switch', 'project'] as const)('%s 后的旧成功或失败不会改变新界面；合法任务仍收尾', async (change) => {
    for (const outcome of ['success', 'failure']) {
      const runtime = createToolSessionRuntime();
      runtime.setProject('p1');
      let finish!: () => void;
      let fail!: (error: Error) => void;
      const tasks: string[] = [];
      const errors: string[] = [];
      const split = runtime.register({ ...definition,
        submit: async (input: string, context) => {
          await new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
          context.close();
          tasks.push(input);
        },
        onError: () => { errors.push('旧错误'); },
      });
      split.open('v1', legacyDeps());
      split.send();
      if (change === 'switch') runtime.enterLegacy('audioTrim', legacyDeps(), () => {});
      else if (change === 'project') runtime.setProject('p2');
      else split.close();
      if (change !== 'close') {
        split.open('v1', legacyDeps());
        split.edit((state) => ({ ...state, format: 'wav' }));
      }
      if (outcome === 'success') finish(); else fail(new Error('network'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(split.getSnapshot()).toEqual({
        state: change === 'close' ? null : { nodeId: 'v1', format: 'wav' }, submitting: false,
      });
      expect(errors).toEqual([]);
      expect(tasks).toEqual(outcome === 'success' ? ['m4a'] : []);
    }
  });

  it('源卡删除清除已注册状态与参数，不把空选中当作删除', () => {
    const runtime = createToolSessionRuntime();
    const split = runtime.register(definition);
    split.open('v1', legacyDeps());
    runtime.reconcileSources(new Set(['v1']));
    expect(split.getSnapshot().state?.nodeId).toBe('v1');
    runtime.reconcileSources(new Set(['v2']));
    expect(split.getSnapshot()).toEqual({ state: null, submitting: false });
  });

});

it.each(['close', 'escape', 'selection', 'pane', 'generation'] as const)('公开接口 %s 退出丢弃编辑态，空选中保留会话', (route) => {
  const runtime = createToolSessionRuntime();
  const split = runtime.register(definition);
  split.open('v1', legacyDeps());
  runtime.onSelectionChange({ soloId: null, multiSelect: false }, legacyDeps());
  expect(split.getSnapshot().state?.nodeId).toBe('v1');
  if (route === 'close') split.close();
  if (route === 'escape') expect(runtime.onEscape(legacyDeps())).toBe(true);
  if (route === 'selection') runtime.onSelectionChange({ soloId: 'v2', multiSelect: false }, legacyDeps());
  if (route === 'pane') expect(runtime.onPaneClick(legacyDeps())).toBe('consumed');
  if (route === 'generation') runtime.beforeGenPanel(legacyDeps());
  expect(split.getSnapshot()).toEqual({ state: null, submitting: false });
});

it('工具的两种类型明确发送操作都在执行前同步锁住界面', () => {
  const runtime = createToolSessionRuntime();
  const inputs: string[] = [];
  const tool = runtime.register({ ...definition,
    capture: (_state: { nodeId: string; format: string }, request?: 'mask' | 'text') => request ?? null,
    submit: async (input: string) => { inputs.push(input); await new Promise(() => {}); },
  });
  tool.open('v1', legacyDeps());
  expect(tool.send('mask')).toBe(true);
  expect(tool.send('text')).toBe(false);
  expect(tool.getSnapshot().submitting).toBe(true);
  expect(inputs).toEqual(['mask']);
});

it.each([false, true])('发送即退出仍保留当前失败反馈；后来会话=%s 时旧失败静默', async (newSession) => {
  const runtime = createToolSessionRuntime();
  const errors: string[] = [];
  let reject!: (error: Error) => void;
  const tool = runtime.register({ ...definition,
    submit: async (_input, context) => {
      context.exitForSubmission();
      await new Promise<void>((_resolve, fail) => { reject = fail; });
    },
    onError: () => { errors.push('创建失败'); },
  });
  tool.open('v1', legacyDeps()); tool.send();
  expect(tool.getSnapshot()).toEqual({ state: null, submitting: false });
  if (newSession) tool.open('v1', legacyDeps());
  reject(new Error('network'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toEqual(newSession ? [] : ['创建失败']);
  expect(tool.getSnapshot().state).toEqual(newSession ? { nodeId: 'v1', format: 'm4a' } : null);
});

it('草稿工具门槛失败保留旧会话；成功先退出旧工具和关闭生成面板，再建卡与来源边', () => {
  const runtime = createToolSessionRuntime();
  const existing = runtime.register(definition);
  existing.open('v1', legacyDeps());
  const events: string[] = [];
  const draft = runtime.register({
    ...definition, kind: 'audioVideoMux',
    initialize: (id: string) => id === 'invalid' ? null : { nodeId: id, format: 'mp4' },
    opened: (state: { nodeId: string; format: string }) => {
      expect(existing.getSnapshot().state).toBeNull();
      events.push('create-card', 'audio-edge');
      return { ...state, nodeId: 'draft1' };
    },
  });
  const entryDeps = { ...legacyDeps(), dismissGenPanels: () => { events.push('close-panel'); } };
  expect(draft.open('invalid', entryDeps)).toBe(false);
  expect(existing.getSnapshot().state?.nodeId).toBe('v1');
  expect(events).toEqual([]);
  expect(draft.open('a1', entryDeps)).toBe(true);
  expect(events).toEqual(['close-panel', 'create-card', 'audio-edge']);
  expect(draft.getSnapshot().state?.nodeId).toBe('draft1');
});
