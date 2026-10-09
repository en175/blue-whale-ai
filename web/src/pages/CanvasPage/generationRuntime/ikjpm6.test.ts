import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retryAudioMix, retryAudioVideoMux } from '@/api/jobs';
import {
  NODE_ID, SRC_ID, MUX_NODE_ID, SID_B, SID_C,
  flush, conflict, bindingView, setupRecoveryScenario,
} from './recoveryTestKit';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  createAudioVideoMux: vi.fn(),
  retryAudioVideoMux: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

beforeEach(() => { vi.resetAllMocks(); });

describe('保护专属重试的完整绑定重放（IKJPM6）', () => {
  it('结果未知后仅合法移动/改名/调整尺寸与来源编辑再重试：submission_id、幂等键与完整绑定原样重放，卡片编辑保留', async () => {
    const ctx = setupRecoveryScenario({ withSourceWire: true, muxAsDraft: true });
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(new Error('网络超时，结果未知'));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ genStatus: 'failed' });

    ctx.nodes.set(NODE_ID, { ...ctx.nodes.get(NODE_ID)!, position: { x: 50, y: 60 } });
    ctx.host.patchNode(NODE_ID, { fileName: '新名字.mp3', width: 480, height: 240 });
    ctx.nodes.set(SRC_ID, { ...ctx.nodes.get(SRC_ID)!, position: { x: 11, y: 22 } });
    ctx.host.patchNode(SRC_ID, { fileName: '改名原声.mp3' });

    vi.mocked(retryAudioMix).mockRejectedValueOnce(new Error('网络超时，结果未知'));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();

    ctx.host.patchNode(NODE_ID, { fileName: '最终名字.mp3' });
    vi.mocked(retryAudioMix).mockResolvedValueOnce({
      job_id: '501', status: 'queued', replayed: true,
      canvas_binding: bindingView(SID_B, NODE_ID, '501', 2),
    });
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();

    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(3);
    const first = ctx.retryCall(0);
    expect(first).toMatchObject({ projectId: '1', jobId: '501', key: SID_B });
    expect(first.binding).toEqual({
      protocol_version: 1, submission_id: SID_B, target_node_id: NODE_ID,
      expected_binding_revision: 1,
      recovery_seed: {
        target: { role: 'result-placeholder', x: 5, y: 6, width: 320, height: 320, name: '用户改名.mp3' },
        sources: [{ node_id: SRC_ID, x: 1, y: 2, width: 300, height: 80, name: '原声.mp3' }],
      },
    });
    for (const replay of [ctx.retryCall(1), ctx.retryCall(2)]) {
      expect(replay.key).toBe(SID_B);
      expect(replay.binding).toEqual(first.binding);
    }
    expect(ctx.nodes.get(NODE_ID)).toMatchObject({ position: { x: 50, y: 60 } });
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({
      fileName: '最终名字.mp3', width: 480, height: 240, genStatus: 'generating', jobId: '501',
    });
    expect(ctx.nodes.get(SRC_ID)).toMatchObject({ position: { x: 11, y: 22 } });
    expect(ctx.nodes.get(SRC_ID)?.data).toMatchObject({ fileName: '改名原声.mp3' });
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_B });
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(2);
  });

  it('未编辑的同意图重放（正常对照）：两次请求完全一致，按已受理重放契约接续原任务', async () => {
    const ctx = setupRecoveryScenario({ withSourceWire: true, muxAsDraft: true });
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(new Error('网络超时，结果未知'));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    vi.mocked(retryAudioMix).mockResolvedValueOnce({
      job_id: '501', status: 'queued', replayed: true,
      canvas_binding: bindingView(SID_B, NODE_ID, '501', 2),
    });
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const first = ctx.retryCall(0);
    const replay = ctx.retryCall(1);
    expect(replay.key).toBe(SID_B);
    expect(replay.binding).toEqual(first.binding);
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(2);
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_B });
  });

  it('已送达的明确 409 归属冲突：不自动重发、版本只前进、意图作废；复核编辑后再发为新身份并按当前卡重建种子', async () => {
    const ctx = setupRecoveryScenario({ withSourceWire: true, muxAsDraft: true });
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(conflict(3));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(1);
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(3);
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({
      genStatus: 'failed', errorText: '卡片归属已变化，请复核后再发送', fileName: '用户改名.mp3',
    });

    ctx.nodes.set(NODE_ID, { ...ctx.nodes.get(NODE_ID)!, position: { x: 90, y: 99 } });
    ctx.host.patchNode(NODE_ID, { fileName: '复核后.mp3' });
    ctx.nextSubmission();
    vi.mocked(retryAudioMix).mockResolvedValueOnce({
      job_id: '501', status: 'queued', replayed: false,
      canvas_binding: bindingView(SID_C, NODE_ID, '501', 4),
    });
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const call = ctx.retryCall(1);
    expect(call.key).toBe(SID_C);
    expect(call.binding).toMatchObject({
      submission_id: SID_C, target_node_id: NODE_ID, expected_binding_revision: 3,
      recovery_seed: { target: { x: 90, y: 99, name: '复核后.mp3' } },
    });
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(2);
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_C });
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(4);
  });

  it('音视频合成同款：结果未知后移动/改名再重放，完整绑定冻结，jobId 复用语义不变', async () => {
    const ctx = setupRecoveryScenario({ withSourceWire: true, muxAsDraft: true });
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioVideoMux).mockRejectedValueOnce(new Error('网络超时，丢回执'));
    expect(ctx.runtime.retry(MUX_NODE_ID)).toBe(true);
    await flush();
    expect(ctx.nodes.get(MUX_NODE_ID)?.data).toMatchObject({ genStatus: 'failed' });

    ctx.nodes.set(MUX_NODE_ID, { ...ctx.nodes.get(MUX_NODE_ID)!, position: { x: 150, y: 160 } });
    ctx.host.patchNode(MUX_NODE_ID, { fileName: '合成新名.mp4' });
    vi.mocked(retryAudioVideoMux).mockResolvedValueOnce({
      job_id: '601', status: 'queued', replayed: true,
      canvas_binding: bindingView(SID_B, MUX_NODE_ID, '601', 2),
    });
    expect(ctx.runtime.retry(MUX_NODE_ID)).toBe(true);
    await flush();

    expect(vi.mocked(retryAudioVideoMux).mock.calls).toHaveLength(2);
    const first = ctx.muxRetryCall(0);
    const replay = ctx.muxRetryCall(1);
    expect(first).toMatchObject({ projectId: '1', jobId: '601', key: SID_B });
    expect(first.binding).toMatchObject({
      submission_id: SID_B, target_node_id: MUX_NODE_ID, expected_binding_revision: 1,
      recovery_seed: { target: { role: 'draft', x: 15, y: 16, name: '合成草稿.mp4' } },
    });
    expect(replay.key).toBe(SID_B);
    expect(replay.binding).toEqual(first.binding);
    expect(ctx.nodes.get(MUX_NODE_ID)).toMatchObject({ position: { x: 150, y: 160 } });
    expect(ctx.nodes.get(MUX_NODE_ID)?.data).toMatchObject({ fileName: '合成新名.mp4', genStatus: 'generating', jobId: '601' });
    expect(ctx.runtime.statusOf(MUX_NODE_ID)).toMatchObject({ phase: 'generating', jobId: '601', submissionId: SID_B });
  });
});
