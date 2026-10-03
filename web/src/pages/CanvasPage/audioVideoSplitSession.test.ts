import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { createAudioVideoSplitSession, type AudioVideoSplitSubmission } from './audioVideoSplitSession';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { type ToolSessionDeps } from './toolSessionCoordinator';

const deps: ToolSessionDeps = {

  dismissGenPanels() {}, selectNode() {},
};

describe('音视频分离工具定义契约', () => {
  it('发送冻结项目、源素材和格式，提交点先退出再同步交接运行时', async () => {
    let projectId = 'p1';
    const source: Node = { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '5', fileName: '原素材' } };
    const inputs: AudioVideoSplitSubmission[] = [];
    const cards: string[] = [];
    const runtime = createToolSessionRuntime();
    // IKJJR3：会话提交 = 退会话后同步 startTask（受理归生成任务运行时，无在途受理窗口）
    const split = runtime.register(createAudioVideoSplitSession(() => ({
      getProjectId: () => projectId,
      getSourceNode: () => source,
      startTask: (input) => {
        expect(split.getSnapshot().state).toBeNull();
        inputs.push(input);
        cards.push(`${input.projectId}/${input.source.data.fileName}/${input.payload.output_format}`);
        return true;
      },
      warn() {}, error() {},
    })));
    split.open('v1', deps);
    split.edit((state) => ({ ...state, format: 'wav' }));
    split.send();
    projectId = 'p2'; source.data.fileName = '已改名'; source.data.assetId = '9';
    expect(inputs[0].payload).toEqual({ source_asset_id: '5', output_format: 'wav' });
    expect(cards).toEqual(['p1/原素材/wav']);
  });
});
