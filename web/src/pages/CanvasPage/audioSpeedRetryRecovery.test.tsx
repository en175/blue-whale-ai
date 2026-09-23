// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiMocks, canvasDocMock, enableReactActEnvironment, flowProps, mediaNodes, navigateRef, renderPage, unmountPage } from './testing/canvasPageTestHarness';
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
async function switchProject(project: 'p1' | 'p2', generating = false) {
  // 先模拟新项目快照加载中，再交付快照，避免夹具把 A 文档提前交给 B。
  await act(async () => { canvasDocMock.current = { ...canvasDocMock.current, doc: null }; navigateRef!(`/canvas?project=${project}`); });
  await act(async () => { seed(project, generating); navigateRef!(`/canvas?project=${project}`); });
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
  await renderPage(); await retry(); await switchProject('p2');
  await act(async () => { resolve({ job_id: 'new-job', status: 'queued' }); });
  expect(mediaNodes().map(n => n.id)).toEqual(['b1']);
  expect(flowProps.current.edges).toEqual([]);
  expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
  await switchProject('p1', generating);
  expect(card().data.jobId).toBe('new-job');
  expect(card().data.src).toBe('http://aud/result.m4a');
  expect(card().data.genStatus).toBeUndefined();
  expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('old-job');
  await switchProject('p2'); await switchProject('p1', generating);
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
  await switchProject('p1', true);
  expect(card().data.genStatus).toBe('failed');
  expect(card().data.errorText).toBe('音频调速失败');
  apiMocks.createAudioSpeed.mockResolvedValueOnce({ job_id: 'new-job', status: 'queued' });
  await retry();
  expect(apiMocks.createAudioSpeed).toHaveBeenLastCalledWith('p1', frozenInput, { silent: true });
  expect(card().data.src).toBe('http://aud/result.m4a');
});
it('A→B→A 返回时仍在途，不轮询旧任务，随后响应原卡收敛', async () => {
  let resolve!: (value: { job_id: string; status: string }) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await renderPage(); await retry(); await switchProject('p2'); await switchProject('p1', true);
  expect(card().data.genStatus).toBe('generating');
  expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
  await act(async () => { resolve({ job_id: 'new-job', status: 'queued' }); });
  expect(card().data.src).toBe('http://aud/result.m4a');
});

it('页面已收敛失败的卡重试，跨项目回来仍恢复新任务轮询', async () => {
  seed('p1', true);
  apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'old-job', status: 'failed', progress: 0, error: { code: 'audio_speed_failed', msg: '' } });
  let resolve!: (value: { job_id: string; status: string }) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await renderPage();
  expect(card().data.genStatus).toBe('failed');
  await retry(); await switchProject('p2');
  await act(async () => { resolve({ job_id: 'new-job', status: 'queued' }); });
  await switchProject('p1', true);
  expect(card().data.src).toBe('http://aud/result.m4a');
});

it('A→B→A 回到原卡后才失败，卡退出生成中且可再次重试', async () => {
  let reject!: (reason: unknown) => void;
  apiMocks.createAudioSpeed.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  await renderPage(); await retry(); await switchProject('p2'); await switchProject('p1', true);
  expect(card().data.genStatus).toBe('generating');
  await act(async () => { reject(new Error('offline')); });
  expect(card().data.genStatus).toBe('failed');
  expect(card().data.errorText).toBe('音频调速失败');
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
