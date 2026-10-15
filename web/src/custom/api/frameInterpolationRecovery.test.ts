// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { frameInterpolationRecoveryOptions } from './frameInterpolationRecovery';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const current = { job_id: '91001', status: 'failed', progress: 0, created_at: '2026-09-22T05:00:00.000Z' };
const record = {
  ...current, type: 'video_frame_interpolation', output_assets: [],
  input: { source_asset_id: '5', target_node_id: 'card-a', fps: 120 },
};
const response = (data: unknown) => new Response(JSON.stringify({ code: 200, data, msg: 'ok' }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('插帧恢复读取', () => {
  it('按当前任务ID和项目读取冻结输入，同卡重新读取不复用旧关联缓存', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(current))
      .mockResolvedValueOnce(response({ records: [record], total: 1, size: 1, current: 1 }))
      .mockResolvedValueOnce(response({ ...current, job_id: '91002' }))
      .mockResolvedValueOnce(response({ records: [{ ...record, job_id: '91002', input: { ...record.input, fps: 30 } }], total: 1, size: 1, current: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    const options = frameInterpolationRecoveryOptions('project/1', 'card-a');
    expect((await client.fetchQuery(options)).input).toEqual({ source_asset_id: '5', target_node_id: 'card-a', fps: 120 });
    expect(String(fetchMock.mock.calls[1]![0])).toContain('projectId=project%2F1&size=1&ids=91001');
    expect((await client.fetchQuery(options)).input?.fps).toBe(30);
    client.clear();
  });

  it.each([
    { name: '没有原任务', records: [] },
    { name: '错误任务ID', records: [{ ...record, job_id: '91002' }] },
    { name: '其他节点', records: [{ ...record, input: { ...record.input, target_node_id: 'card-b' } }] },
    { name: '其他任务类型', records: [{ ...record, type: 'video_enhance' }] },
    { name: '没有帧率', records: [{ ...record, input: { source_asset_id: '5', target_node_id: 'card-a' } }] },
  ])('$name：拒绝猜测冻结输入', async ({ records }) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(current))
      .mockResolvedValueOnce(response({ records, total: records.length, size: 1, current: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    await expect(client.fetchQuery(frameInterpolationRecoveryOptions('p1', 'card-a'))).rejects.toThrow('参数无法恢复');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it('任务查询403不重试、不触发传输层toast', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(current))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 403, msg: '无权限' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    await expect(client.fetchQuery(frameInterpolationRecoveryOptions('p1', 'card-a'))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
    client.clear();
  });
});
