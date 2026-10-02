import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { createAudioVideoSplitSession, type AudioVideoSplitSubmission } from './audioVideoSplitSession';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { TOOL_SESSION_KINDS, type ToolSessionDeps } from './toolSessionCoordinator';

const deps: ToolSessionDeps = {
  activity: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, null])) as ToolSessionDeps['activity'],
  exits: Object.fromEntries(TOOL_SESSION_KINDS.map((kind) => [kind, () => {}])) as ToolSessionDeps['exits'],
  dismissGenPanels() {}, selectNode() {},
};

describe('音视频分离工具定义契约', () => {
  it('发送冻结项目、源素材和格式，受理后先退出再把合法任务交给宿主', async () => {
    let projectId = 'p1';
    const source: Node = { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '5', fileName: '原素材' } };
    let accept!: (task: { job_id: string }) => void;
    const inputs: AudioVideoSplitSubmission[] = [];
    const cards: string[] = [];
    const runtime = createToolSessionRuntime();
    const split = runtime.register(createAudioVideoSplitSession(() => ({
      getProjectId: () => projectId,
      getSourceNode: () => source,
      createTask: (input) => { inputs.push(input); return new Promise((resolve) => { accept = resolve; }); },
      handoff: async (input, task) => {
        expect(split.getSnapshot().state).toBeNull();
        cards.push(`${input.projectId}/${input.source.data.fileName}/${task.job_id}/${input.payload.output_format}`);
      },
      warn() {}, error() {},
    })));
    split.open('v1', deps);
    split.edit((state) => ({ ...state, format: 'wav' }));
    split.send();
    projectId = 'p2'; source.data.fileName = '已改名'; source.data.assetId = '9';
    split.edit((state) => ({ ...state, format: 'mp3' }));
    accept({ job_id: 'j1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inputs[0].payload).toEqual({ source_asset_id: '5', output_format: 'wav' });
    expect(cards).toEqual(['p1/原素材/j1/wav']);
  });
});
