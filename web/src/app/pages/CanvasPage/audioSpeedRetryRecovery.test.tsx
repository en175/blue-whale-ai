// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiMocks, canvasDocMock, enableReactActEnvironment, flowProps, mediaNodes, navigateRef, renderPage, unmountPage } from './testing/canvasPageTestHarness';
const recoveryApi = vi.hoisted(() => ({
  fetchGenerationRecoveryPage: vi.fn(async (_projectId?: string, _options?: { cursor?: string | null }): Promise<{ protocol_version: number; canvas_version: number | null; records: Array<Record<string, unknown>>; next_cursor: string | null }> => ({ protocol_version: 1, canvas_version: 3, records: [], next_cursor: null })),
  generationRecoveryPageOptions: (projectId: string, options: { cursor?: string | null } = {}) => ({
    queryKey: ['canvases', 'generation-recovery', projectId, { cursor: options.cursor ?? null }],
    queryFn: () => recoveryApi.fetchGenerationRecoveryPage(projectId, options),
    staleTime: 0,
    retry: false as const,
  }),
  resolveGenerationRecovery: vi.fn(async (): Promise<{ protocol_version: number; records: Array<Record<string, unknown>> }> => ({ protocol_version: 1, records: [] })),
  putCanvasDocWithRecovery: vi.fn(async () => ({ project_id: '1', version: 4, recoveryReceipt: { commandId: 'cmd', replayed: false, changes: [] } })),
}));
vi.mock('@/app/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('@/app/api/canvasRecovery', () => recoveryApi);
const frozenInput = { source_asset_id: '8', speed: 1.35 };
function seed(project: 'p1' | 'p2', generating = false, overrides: Record<string, unknown> = {}) {
  canvasDocMock.current = {
    doc: {
      id: project === 'p1' ? 11 : 22, version: 3, viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{ id: project === 'p1' ? 'audio-speed-old-job' : 'b1', type: 'mediaNode', position: { x: 0, y: 0 },
        data: project === 'p1' ? {
          mediaType: 'audio', fileName: '原名.m4a', jobId: 'old-job', genStatus: generating ? 'generating' : 'failed',
          errorText: '旧失败', audioSpeed: { sourceAssetId: '8', lastInput: frozenInput }, ...overrides,
        } : { mediaType: 'audio', src: 'http://aud/b.mp3', assetId: '9', duration: 20, mime: 'audio/mpeg' },
      }], edges: [],
    },
    assets: { 9: { asset_id: 9, type: 'audio', access_url: 'http://aud/b.mp3' } },
    refetch: () => Promise.resolve([]), acceptDoc: vi.fn(),
  };
}
const card = () => mediaNodes().find(n => n.id === 'audio-speed-old-job')!;
function seedRecoveryRecord(jobStatus: string) {
  recoveryApi.fetchGenerationRecoveryPage.mockResolvedValueOnce({
    protocol_version: 1, canvas_version: 3, next_cursor: null,
    records: [{
      submission_id: '22222222-2222-4222-8222-222222222222',
      target_node_id: 'audio-speed-old-job',
      job_id: 'new-job',
      task_type: 'audio_speed',
      binding_revision: 1,
      is_current: true,
      job: { job_id: 'new-job', type: 'audio_speed', status: jobStatus, progress: 10, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      recovery_seed: { target: { role: 'result-placeholder', x: 0, y: 0, width: 320, height: 320, name: '原名(调速1.35x).m4a' }, sources: [] },
      previous_target_snapshot: null,
      items: [{ recovery_item_id: 'gcr:22222222-2222-4222-8222-222222222222:$target', output_key: '$target', node_id: 'audio-speed-old-job', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
    }],
  });
}
async function switchProject(project: 'p1' | 'p2', generating = false, overrides: Record<string, unknown> = {}) {
  await act(async () => { canvasDocMock.current = { ...canvasDocMock.current, doc: null }; navigateRef!(`/canvas?project=${project}`); });
  await act(async () => { seed(project, generating, overrides); navigateRef!(`/canvas?project=${project}`); });
}
async function retry() {
  await act(async () => { (card().data.onRetryJob as (id: string) => void)('audio-speed-old-job'); });
}
beforeEach(() => {
  enableReactActEnvironment(); localStorage.clear(); sessionStorage.clear(); seed('p1');
  apiMocks.createAudioSpeed.mockReset();
  apiMocks.fetchJobStatus.mockReset().mockResolvedValue({ job_id: 'new-job', status: 'succeeded', progress: 100, asset: { id: '88', url: 'http://aud/result.m4a', type: 'audio', duration: 11.1 } });
});
afterEach(async () => { await unmountPage(); vi.clearAllMocks(); vi.restoreAllMocks(); });
it.each([false, true])('迟到成功回 A 后原卡恢复成品，返回时旧快照 generating=%s', async (generating) => {
  let resolve!: (value: { job_id: string; status: string }) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await renderPage(); console.info('[phase] rendered'); (globalThis as Record<string, unknown>).__phase = 'post-render';
  await retry(); await switchProject('p2');
  await act(async () => { resolve({ job_id: 'new-job', status: 'queued' }); });
  expect(mediaNodes().map(n => n.id)).toEqual(['b1']);
  expect(flowProps.current.edges).toEqual([]);
  expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
  seedRecoveryRecord('processing');
  await switchProject('p1', generating, generating ? { jobId: 'new-job' } : undefined);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(card().data.jobId).toBe('new-job');
  expect(card().data.src).toBe('http://aud/result.m4a');
  expect(card().data.genStatus).toBeUndefined();
  expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('old-job');
  await switchProject('p2');
  seedRecoveryRecord('processing');
  await switchProject('p1', generating, generating ? { jobId: 'new-job' } : undefined);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(card().data.src).toBe('http://aud/result.m4a');
  expect(card().data.genStatus).toBeUndefined();
});
it('迟到失败仅回 A 显示可读失败，再试仍使用冻结参数', async () => {
  let reject!: (reason: unknown) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  await renderPage(); await retry(); await switchProject('p2');
  await act(async () => { reject(new Error('offline')); });
  expect(mediaNodes().map(n => n.id)).toEqual(['b1']);
  expect(document.body.textContent).not.toContain('音频调速任务创建失败');
  await switchProject('p1');
  expect(card().data.genStatus).toBe('failed');
  expect(card().data.errorText).toBe('旧失败');
  apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'new-job', status: 'queued' });
  await retry();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(apiMocks.createAudioSpeed).toHaveBeenLastCalledWith('p1', frozenInput, expect.objectContaining({ silent: true }));
  expect(card().data.src).toBe('http://aud/result.m4a');
});
it('A→B→A 返回时仍在途，不轮询旧任务，随后响应原卡收敛', async () => {
  let resolve!: (value: { job_id: string; status: string }) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  apiMocks.fetchJobStatus
    .mockResolvedValueOnce({ job_id: 'new-job', status: 'processing', progress: 10, asset: null })
    .mockResolvedValueOnce({ job_id: 'new-job', status: 'succeeded', progress: 100, asset: { id: '88', url: 'http://aud/result.m4a', type: 'audio', duration: 11.1 } });
  await renderPage(); await retry(); await switchProject('p2');
  seedRecoveryRecord('processing');
  await switchProject('p1');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(card().data.genStatus).toBe('generating');
  expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('old-job');
  await act(async () => { resolve({ job_id: 'new-job', status: 'queued' }); });
  await act(async () => { await jest_timers(); });
  expect(card().data.src).toBe('http://aud/result.m4a');
});
async function jest_timers() { await new Promise((resolve) => setTimeout(resolve, 3000)); }

it('页面已收敛失败的卡重试，跨项目回来仍恢复新任务轮询', async () => {
  seed('p1', true);
  apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'old-job', status: 'failed', progress: 0, error: { code: 'audio_speed_failed', msg: '' } });
  let resolve!: (value: { job_id: string; status: string }) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await renderPage();
  expect(card().data.genStatus).toBe('failed');
  await retry(); await switchProject('p2');
  await act(async () => { resolve({ job_id: 'new-job', status: 'queued' }); });
  seedRecoveryRecord('processing');
  await switchProject('p1');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(card().data.src).toBe('http://aud/result.m4a');
});

it('A→B→A 恢复接续后任务失败：卡退出生成中且可再次重试', async () => {
  let reject!: (reason: unknown) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  apiMocks.fetchJobStatus
    .mockResolvedValueOnce({ job_id: 'new-job', status: 'processing', progress: 10, asset: null })
    .mockResolvedValueOnce({ job_id: 'new-job', status: 'failed', progress: 0, error: { code: 'audio_speed_failed', msg: '' } });
  await renderPage(); await retry(); await switchProject('p2');
  seedRecoveryRecord('processing');
  await switchProject('p1');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(card().data.genStatus).toBe('generating');
  await act(async () => { reject(new Error('offline')); });
  await act(async () => { await jest_timers(); });
  expect(card().data.genStatus).toBe('failed');
  apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'new-job-2', status: 'queued' });
  apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'new-job-2', status: 'succeeded', progress: 100, asset: { id: '89', url: 'http://aud/r2.m4a', type: 'audio' } });
  await retry();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  expect(apiMocks.createAudioSpeed).toHaveBeenLastCalledWith('p1', frozenInput, expect.objectContaining({ silent: true }));
  expect(card().data.src).toBe('http://aud/r2.m4a');
});

it('新任务终态已落盘后保留后续改名，不被重试缓存盖回', async () => {
  apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'new-job', status: 'queued' });
  await renderPage(); await retry();
  await switchProject('p2');
  await act(async () => { canvasDocMock.current = { ...canvasDocMock.current, doc: null }; navigateRef!('/canvas?project=p1'); });
  await act(async () => {
    seed('p1', false, { jobId: 'new-job', genStatus: undefined, src: 'http://aud/result.m4a', fileName: '用户改名.m4a' });
    navigateRef!('/canvas?project=p1');
  });
  expect(card().data.fileName).toBe('用户改名.m4a');
});
