import { expect, it } from 'vitest';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { type ToolSessionDeps } from './toolSessionCoordinator';
import { createSmartMattingSession, type SmartMattingSubmission } from './smartMattingSession';

const deps: ToolSessionDeps = {

  dismissGenPanels() {}, selectNode() {},
};

it.each([false, true])('抠像发送先退出；在途任务锁不随界面关闭释放，后来会话=%s 时旧失败静默', async (reopen) => {
  let sending = false;
  let fail!: (error: Error) => void;
  const inputs: SmartMattingSubmission[] = [];
  const errors: string[] = [];
  const runtime = createToolSessionRuntime();
  const tool = runtime.register(createSmartMattingSession(() => ({
    getProjectId: () => 'p1',
    getSourceNode: () => ({ id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '5' } }),
    newTargetId: () => 'matting1', newClientToken: () => 'token1', isSending: () => sending,
    runTask: async (input) => {
      expect(tool.getSnapshot().state).toBeNull();
      inputs.push(input); sending = true;
      try { await new Promise<void>((_resolve, reject) => { fail = reject; }); }
      finally { sending = false; }
    },
    warn() {}, error: (message) => { errors.push(message); },
  })));
  tool.open({ nodeId: 'v1', mode: 'greenscreen' }, deps);
  tool.edit((state) => ({ ...state, format: 'MP4', backgroundColor: 'black' }));
  expect(tool.send()).toBe(true);
  if (reopen) {
    tool.open({ nodeId: 'v1', mode: 'portrait' }, deps);
    expect(tool.send()).toBe(false);
  }
  expect(sending).toBe(true);
  fail(new Error('network'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(inputs[0].payload).toEqual({ source_asset_id: '5', target_node_id: 'matting1', mode: 'greenscreen', format: 'MP4', background_color: 'black' });
  expect(inputs[0].clientToken).toBe('token1');
  expect(errors).toEqual(reopen ? [] : ['智能抠像任务创建失败，请重试']);
  expect(sending).toBe(false);
  expect(tool.getSnapshot().state).toEqual(reopen ? { nodeId: 'v1', mode: 'portrait', format: 'WEBM', backgroundColor: 'white' } : null);
});
