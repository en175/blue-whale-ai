// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiMocks, canvasDocMock, flowProps, mediaNodes, renderPage, unmountPage,
} from './testing/canvasPageTestHarness';

const recoveryPageMock = vi.hoisted(() => ({ current: null as null | { records: unknown[] } }));
vi.mock('@/app/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('@/app/api/canvasRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/canvasRecovery')>();
  const fetchPage = vi.fn(async (_projectId: string, _options?: { limit?: number; cursor?: string | null }) => recoveryPageMock.current ?? {
    protocol_version: 1, canvas_version: null, records: [], next_cursor: null,
  });
  return {
    ...actual,
    fetchGenerationRecoveryPage: fetchPage,
    generationRecoveryPageOptions: (projectId: string, options: { limit?: number; cursor?: string | null } = {}) => ({
      ...actual.generationRecoveryPageOptions(projectId, options),
      queryFn: () => fetchPage(projectId, options),
    }),
    resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
  };
});

const sourceCard = {
  id: 'source', type: 'mediaNode', position: { x: 0, y: 0 },
  data: { src: 'https://audio.test/source.mp3', mediaType: 'audio', assetId: '1' },
};
const generatingCard = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'mediaNode', position: { x: 600, y: 0 },
  data: {
    src: '', fileName: '混合结果.mp3', mediaType: 'audio', genStatus: 'generating',
    progress: 0, jobId: '73', audioMix: { format: 'mp3' }, ...extra,
  },
});

function seed(nodes: Array<Record<string, unknown>> = [sourceCard, generatingCard('audio-mix-73')]) {
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes,
      edges: [{ id: 'mix-edge', source: 'source', target: 'audio-mix-73', data: { origin: 'audio-mix' } }] },
    assets: {}, refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  recoveryPageMock.current = null;
  apiMocks.fetchJobs.mockResolvedValue({ records: [], total: 0, size: 20, current: 1 });
});
afterEach(async () => { await unmountPage(); vi.clearAllMocks(); });

describe('IKJJR4 混合任务：刷新恢复与失败重试', () => {
  it('历史在卡任务经水合即时续轮询，终态在原卡回填', async () => {
    seed();
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: '73', status: 'succeeded', progress: 100,
      asset: { id: '88', url: 'https://audio.test/result.mp3', type: 'audio', duration: 12.5 },
    });
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('73'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const card = mediaNodes().find((node) => node.id === 'audio-mix-73');
    expect(card?.data).toMatchObject({
      genStatus: undefined, src: 'https://audio.test/result.mp3', assetId: '88', duration: 12.5,
    });
  });

  it('受理回执丢失的新协议任务经恢复扫描补卡（种子定位/家族卡形态）并续轮询', async () => {
    seed([sourceCard]);
    recoveryPageMock.current = {
      records: [{
        submission_id: '11111111-1111-4111-8111-111111111111',
        target_node_id: 'audio-mix-9001-1',
        job_id: '73', task_type: 'audio_mix', binding_revision: 1, is_current: true,
        job: { job_id: '73', type: 'audio_mix', status: 'processing', progress: 40, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        recovery_seed: { target: { role: 'result-placeholder', x: 640, y: 80, width: 480, height: 284, name: '混合结果.flac' }, sources: [] },
        previous_target_snapshot: null,
        items: [{ recovery_item_id: 'gcr:sub:$target', output_key: '$target', node_id: 'audio-mix-9001-1', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
      }],
    };
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'processing', progress: 40, asset: null });
    await renderPage();
    await vi.waitFor(() => {
      const card = mediaNodes().find((node) => node.id === 'audio-mix-9001-1');
      expect(card).toBeTruthy();
    });
    const card = mediaNodes().find((node) => node.id === 'audio-mix-9001-1')!;
    expect(card.data).toMatchObject({
      fileName: '混合结果.flac', mediaType: 'audio', genStatus: 'generating', jobId: '73',
      audioMix: { format: 'flac' },
    });
    expect(card.position).toEqual({ x: 640, y: 80 });
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalled());
  });

  it('恢复记录中卡已在画布：直接续轮询（重复扫描不双链、不重复建卡）', async () => {
    seed();
    recoveryPageMock.current = {
      records: [{
        submission_id: '11111111-1111-4111-8111-111111111111',
        target_node_id: 'audio-mix-73',
        job_id: '73', task_type: 'audio_mix', binding_revision: 1, is_current: true,
        job: { job_id: '73', type: 'audio_mix', status: 'processing', progress: 40, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        recovery_seed: { target: { role: 'result-placeholder', x: 640, y: 80, width: 480, height: 284, name: '混合结果.mp3' }, sources: [] },
        previous_target_snapshot: null,
        items: [],
      }],
    };
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'processing', progress: 40, asset: null });
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('73'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(mediaNodes().filter((node) => node.id === 'audio-mix-73')).toHaveLength(1);
    expect(apiMocks.fetchJobStatus.mock.calls.filter((call) => call[0] === '73').length).toBeGreaterThanOrEqual(1);
  });

  it('历史失败卡（无受理关联）重试走原协议：不带 canvas_binding、复用同 jobId、卡回生成中', async () => {
    seed([sourceCard, generatingCard('audio-mix-73', { genStatus: 'failed', errorText: '供应商任务失败' })]);
    apiMocks.retryAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', replayed: false });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    const onRetry = mediaNodes().find((node) => node.id === 'audio-mix-73')!.data.onRetryJob as (id: string) => void;
    await act(async () => { onRetry('audio-mix-73'); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(apiMocks.retryAudioMix).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryAudioMix.mock.calls[0]?.slice(0, 2)).toEqual(['p1', '73']);
    expect(apiMocks.retryAudioMix.mock.calls[0]?.[4]).toBeUndefined();
    expect(mediaNodes().find((node) => node.id === 'audio-mix-73')?.data.genStatus).toBe('generating');
    expect(mediaNodes().filter((node) => node.id === 'audio-mix-73')).toHaveLength(1);
  });

  it('新协议失败卡（marker）重试携 canvas_binding：新 submission_id 独立身份、目标为原卡', async () => {
    seed([sourceCard, generatingCard('audio-mix-73', {
      genStatus: 'failed', errorText: '供应商任务失败',
      generationRecovery: { protocolVersion: 1, submissionId: '11111111-1111-4111-8111-111111111111', outputKey: '$target' },
    })]);
    apiMocks.retryAudioMix.mockResolvedValue({
      job_id: '73', status: 'queued', replayed: false,
      canvas_binding: {
        protocol_version: 1, submission_id: '22222222-2222-4222-8222-222222222222',
        target_node_id: 'audio-mix-73', binding_revision: 2, job_id: '73', is_current: true,
      },
    });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    const onRetry = mediaNodes().find((node) => node.id === 'audio-mix-73')!.data.onRetryJob as (id: string) => void;
    await act(async () => { onRetry('audio-mix-73'); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(apiMocks.retryAudioMix).toHaveBeenCalledTimes(1);
    const call = apiMocks.retryAudioMix.mock.calls[0];
    expect(call?.[0]).toBe('p1');
    expect(call?.[1]).toBe('73');
    expect(call?.[2]).toMatch(/^[a-z0-9-]+$/);
    expect(call?.[2]).not.toBe('11111111-1111-4111-8111-111111111111');
    expect(call?.[4]).toMatchObject({
      protocol_version: 1,
      submission_id: call?.[2],
      target_node_id: 'audio-mix-73',
      expected_binding_revision: 0,
    });
    expect(mediaNodes().find((node) => node.id === 'audio-mix-73')?.data.genStatus).toBe('generating');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('73');
  });

  it.each(['cancelled', 'failed'] as const)('删除生成中卡：取消确权为 %s 后移除卡与来源线', async (terminal) => {
    seed();
    apiMocks.cancelGenerationJob.mockResolvedValue(null);
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: '73', status: 'queued', progress: 0, asset: null })
      .mockResolvedValueOnce({ job_id: '73', status: 'processing', progress: 20, asset: null })
      .mockResolvedValue({ job_id: '73', status: terminal, progress: 20, asset: null });
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledTimes(1));
    await act(async () => { flowProps.current.onDeleteNode(['audio-mix-73']); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', '73');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2700)); });
    expect(mediaNodes().map((node) => node.id)).not.toContain('audio-mix-73');
    expect(flowProps.current.edges.some((edge: { target: string }) => edge.target === 'audio-mix-73')).toBe(false);
  }, 8000);

  it('删除等待期间任务抢先成功时保留原卡与产物', async () => {
    seed();
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: '73', status: 'processing', progress: 20, asset: null })
      .mockResolvedValueOnce({ job_id: '73', status: 'succeeded', progress: 100,
        asset: { id: '88', url: 'https://audio.test/result.mp3', type: 'audio' } });
    await renderPage();
    await vi.waitFor(() => expect(apiMocks.fetchJobStatus).toHaveBeenCalledTimes(1));
    await act(async () => { flowProps.current.onDeleteNode(['audio-mix-73']); await new Promise((resolve) => setTimeout(resolve, 30)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2700)); });
    expect(mediaNodes().find((node) => node.id === 'audio-mix-73')?.data).toMatchObject({
      genStatus: undefined, src: 'https://audio.test/result.mp3', assetId: '88',
    });
    expect(flowProps.current.edges.some((edge: { target: string }) => edge.target === 'audio-mix-73')).toBe(true);
  }, 8000);
});
