// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiMocks, canvasDocMock, flowProps, mediaNodes, renderPage, unmountPage,
} from './testing/canvasPageTestHarness';

const failedCard = {
  id: 'audio-mix-73', type: 'mediaNode', position: { x: 600, y: 0 },
  data: { src: '', fileName: '混合结果.mp3', mediaType: 'audio', genStatus: 'failed',
    errorText: '供应商任务失败', jobId: '73', audioMix: { format: 'mp3' } },
};

function seed(nodes: Array<Record<string, unknown>> = [failedCard]) {
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes,
      edges: [{ id: 'mix-edge', source: 'source', target: 'audio-mix-73', data: { origin: 'audio-mix' } }] },
    assets: {}, refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  apiMocks.fetchJobs.mockResolvedValue({ records: [], total: 0, size: 20, current: 1 });
});
afterEach(async () => { await unmountPage(); vi.clearAllMocks(); });

describe('IKI697 同卡失败重试', () => {
  it('POST 已受理但卡尚未落盘时，重新打开画布从任务列表补卡和冻结来源线', async () => {
    seed([
      { id: 'source', type: 'mediaNode', position: { x: 0, y: 0 },
        data: { src: 'https://audio.test/source.mp3', mediaType: 'audio', assetId: '1' } },
      { id: 'second', type: 'mediaNode', position: { x: 600, y: 0 },
        data: { src: 'https://audio.test/second.mp3', mediaType: 'audio', assetId: '2' } },
    ]);
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [];
    apiMocks.fetchJobs.mockResolvedValue({ records: [{ job_id: '73', type: 'audio_mix', status: 'queued', progress: 0,
      input: { source_node_id: 'source', inputs: [
        { asset_id: '1', node_id: 'source', url: 'https://audio.test/source.mp3' },
        { asset_id: '2', node_id: 'second', url: 'https://audio.test/second.mp3' },
      ], output_format: 'mp3' }, created_at: '2026-09-23T00:00:00Z', output_assets: [],
      canvas_card_state: 'pending' }], total: 1, size: 100, current: 1 });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(mediaNodes().map((node) => node.id)).toContain('audio-mix-73');
    expect(flowProps.current.edges.filter((edge: { target: string }) => edge.target === 'audio-mix-73')
      .map((edge: { source: string }) => edge.source)).toEqual(['source', 'second']);
  });

  it('连续点击只发同一 job 的一次重试，结果卡与来源线不复制', async () => {
    seed([{ id: 'source', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { src: 'https://audio.test/source.mp3', mediaType: 'audio', assetId: '1' } }, failedCard]);
    apiMocks.retryAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', replayed: false });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    const onRetry = mediaNodes().find((node) => node.id === 'audio-mix-73')!.data.onRetryJob as (id: string) => void;
    await act(async () => { onRetry('audio-mix-73'); onRetry('audio-mix-73'); await Promise.resolve(); });
    expect(apiMocks.retryAudioMix).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryAudioMix.mock.calls[0]?.slice(0, 2)).toEqual(['p1', '73']);
    expect(mediaNodes().filter((node) => node.id === 'audio-mix-73')).toHaveLength(1);
    expect(mediaNodes().find((node) => node.id === 'audio-mix-73')?.data.genStatus).toBe('generating');
    expect(flowProps.current.edges.filter((edge: { target: string }) => edge.target === 'audio-mix-73')).toHaveLength(1);
  });

  it('重试请求状态未知时再点使用原幂等键和原 jobId', async () => {
    seed();
    apiMocks.retryAudioMix.mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ job_id: '73', status: 'queued', replayed: true });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    const retry = mediaNodes().find((node) => node.id === 'audio-mix-73')!.data.onRetryJob as (id: string) => void;
    await act(async () => { retry('audio-mix-73'); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(mediaNodes().find((node) => node.id === 'audio-mix-73')?.data.genStatus).toBe('failed');
    await act(async () => { retry('audio-mix-73'); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(apiMocks.retryAudioMix.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      ['p1', '73', 'test-retry-key'], ['p1', '73', 'test-retry-key'],
    ]);
  });

  it('首个含卡 PUT 未完成时删除须先持久化卡，再删除卡和来源线', async () => {
    seed([{ id: 'source', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { src: 'https://audio.test/source.mp3', mediaType: 'audio', assetId: '1' } }]);
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [];
    apiMocks.fetchJobs.mockResolvedValue({ records: [{ job_id: '73', type: 'audio_mix', status: 'queued', progress: 0,
      input: { source_node_id: 'source', inputs: [{ asset_id: '1', node_id: 'source' }], output_format: 'mp3' },
      created_at: '2026-09-23T00:00:00Z', output_assets: [], canvas_card_state: 'pending' }],
    total: 1, size: 100, current: 1 });
    let finishFirst!: (value: { id: number; project_id: number; version: number; viewport: string; nodes: string }) => void;
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'cancelled', progress: 0, asset: null });
    await renderPage();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(mediaNodes().map((node) => node.id)).toContain('audio-mix-73');
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1), { timeout: 1500 });
    await act(async () => { flowProps.current.onDeleteNode(['audio-mix-73']); await Promise.resolve(); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    const saves = apiMocks.saveCanvasDoc.mock.calls as unknown as Array<[string, { nodes: Array<{ id: string }> }]>;
    expect(saves[0]?.[1].nodes.map((node) => node.id)).toContain('audio-mix-73');
    expect(mediaNodes().map((node) => node.id)).toContain('audio-mix-73');
    await act(async () => {
      finishFirst({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mediaNodes().map((node) => node.id)).not.toContain('audio-mix-73');
    expect(flowProps.current.edges.some((edge: { target: string }) => edge.target === 'audio-mix-73')).toBe(false);
    expect(saves.at(-1)?.[1].nodes.map((node) => node.id)).not.toContain('audio-mix-73');
  });

  it('首次保存失败时保留待恢复的卡和来源线', async () => {
    seed([{ id: 'source', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { src: 'https://audio.test/source.mp3', mediaType: 'audio', assetId: '1' } }]);
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [];
    apiMocks.fetchJobs.mockResolvedValue({ records: [{ job_id: '73', type: 'audio_mix', status: 'queued', progress: 0,
      input: { source_node_id: 'source', inputs: [{ asset_id: '1', node_id: 'source' }], output_format: 'mp3' },
      created_at: '2026-09-23T00:00:00Z', output_assets: [], canvas_card_state: 'pending' }],
    total: 1, size: 100, current: 1 });
    let failFirst!: (reason: Error) => void;
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '73', status: 'queued', progress: 0, asset: null });
    await renderPage();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1), { timeout: 1500 });
    await act(async () => { flowProps.current.onDeleteNode(['audio-mix-73']); failFirst(new Error('conflict')); await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(mediaNodes().map((node) => node.id)).toContain('audio-mix-73');
    expect(flowProps.current.edges.some((edge: { target: string }) => edge.target === 'audio-mix-73')).toBe(true);
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
  });
});
