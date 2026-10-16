import { expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import type { VideoSubtitleEraseInput } from '../video/videoSubtitleErase';
import type { MaskOp } from './eraseMask';
import { createToolSessionRuntime } from '../../toolSessionRuntime';
import { type ToolSessionDeps } from '../../toolSessionCoordinator';
import { createImageEraseSession, createSubtitleEraseSession, beginSubtitleBox, moveSubtitleBox, endSubtitleBox, beginEraseStroke, moveEraseStroke, endEraseStroke, type ImageEraseTaskSubmission, type ImageEraseHost } from './maskToolSessions';

const deps: ToolSessionDeps = {

  dismissGenPanels() {}, selectNode() {},
};
const source: Node = { id: 'img', type: 'mediaNode', position: { x: 100, y: 200 }, data: { assetId: '5', width: 600, height: 600 } };
function eraseHost(): ImageEraseHost {
  return {
    getProjectId: () => 'p1', getSourceNode: () => source, newTargetId: () => 'result1',
    encodeMask: async () => null, uploadMask: async () => ({ asset_id: 'mask1' }),
    createTask: async () => ({ job_id: 'j1' }), handoff: async () => {}, warn() {}, error() {},
  };
}

it('擦除公开编辑：同一事件序列同步落笔，关闭清空遮罩/活笔/重做栈并保留笔刷半径', () => {
  const runtime = createToolSessionRuntime();
  const erase = runtime.register(createImageEraseSession(eraseHost));
  erase.open('img', deps);
  erase.edit((state) => ({ ...state, brushRadius: 40 }));
  erase.edit((state) => beginEraseStroke(state, { x: 2, y: 3 }));
  erase.edit((state) => moveEraseStroke(state, { x: 4, y: 5 }));
  erase.edit(endEraseStroke);
  expect(erase.getSnapshot().state?.mask.ops).toEqual([{ kind: 'stroke', erase: false, radius: 40, points: [{ x: 2, y: 3 }, { x: 4, y: 5 }] }]);
  erase.close();
  erase.open('img', deps);
  expect(erase.getSnapshot().state).toEqual({ nodeId: 'img', tool: 'brush', brushRadius: 40, mask: { ops: [], redoStack: [] }, liveOp: null, points: [] });
});

it('擦除发送在编码前锁住并冻结项目、源素材与已落笔遮罩；旧编码成功继续合法任务交接', async () => {
  const node = { ...source, position: { ...source.position }, data: { ...source.data } };
  let projectId = 'p1';
  let encode!: (file: File | null) => void;
  const tasks: ImageEraseTaskSubmission[] = [];
  const masks: Array<readonly MaskOp[]> = [];
  const runtime = createToolSessionRuntime();
  const erase = runtime.register(createImageEraseSession(() => ({
    ...eraseHost(), getSourceNode: () => node, getProjectId: () => projectId,
    encodeMask: (ops) => { masks.push(ops); return new Promise((resolve) => { encode = resolve; }); },
    uploadMask: async (_file, project) => { expect(project).toBe('p1'); return { asset_id: 'mask1' }; },
    createTask: async (input) => { tasks.push(input); return { job_id: 'j1' }; },
    handoff: async (_input, _task, skipSelect) => { expect(skipSelect).toBe(true); },
  })));
  erase.open('img', deps);
  erase.edit((state) => beginEraseStroke(state, { x: 2, y: 3 })); erase.edit(endEraseStroke);
  expect(erase.send('mask')).toBe(true);
  expect(erase.getSnapshot().submitting).toBe(true);
  expect(erase.send('mask')).toBe(false);
  erase.close(); erase.open('img', deps);
  projectId = 'p2'; node.data.assetId = '9'; node.position.x = 999;
  encode(new File(['mask'], 'mask.png', { type: 'image/png' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(tasks[0].projectId).toBe('p1');
  expect(tasks[0].source.position.x).toBe(100);
  expect(tasks[0].payload).toEqual({ source_asset_id: '5', target_node_id: 'result1', erase_scene: 'selected_area_erase', mask_asset_id: 'mask1' });
  expect(masks[0]).toEqual([{ kind: 'stroke', erase: false, radius: 20, points: [{ x: 2, y: 3 }] }]);
  expect(erase.getSnapshot().state?.mask.ops).toEqual([]);
});

it('去字幕框选必框、smart保持零框语义；发送冻结归一化框集合，受理后再退出', async () => {
  const runtime = createToolSessionRuntime();
  const inputs: VideoSubtitleEraseInput[] = [];
  const tool = runtime.register(createSubtitleEraseSession(() => ({
    getProjectId: () => 'p1', getSourceNode: () => source, newTargetId: () => 'subtitle1',
    startTask: ({ payload }) => { inputs.push(payload); expect(tool.getSnapshot().state).toBeNull(); return true; },
    warn() {}, error() {},
  })));
  tool.open({ nodeId: 'img', mode: 'box' }, deps);
  expect(tool.send()).toBe(false);
  tool.edit((state) => beginSubtitleBox(state, { x: 0, y: 0 }, () => {}));
  tool.edit((state) => moveSubtitleBox(state, { x: 140, y: 140 }));
  tool.edit(endSubtitleBox);
  tool.send();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(inputs[0]).toEqual({ source_asset_id: '5', target_node_id: 'subtitle1', detect_mode: 'subtitle_smart', erase_boxes: [{ top_left_x: 0, top_left_y: 0, bottom_right_x: 0.5, bottom_right_y: 0.5 }] });
  tool.open({ nodeId: 'img', mode: 'smart' }, deps); tool.send();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(inputs[1].erase_boxes).toEqual([]);
});
