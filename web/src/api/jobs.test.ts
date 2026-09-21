// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ApiError } from './http';
import {
  createAudioTrim,
  createFrameInterpolation,
  createMediaExtraction,
  createVocalSplit,
  createVideoEnhancement,
  createVideoMatting,
  fetchJobStatus,
  isGenerationDomainError,
  readJobFailText,
} from './jobs';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('createMediaExtraction', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('向项目媒体提取端点提交视频资产与 MP3 格式', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '1125', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createMediaExtraction('project/1', { source_asset_id: '3985', output_format: 'mp3' }),
    ).resolves.toEqual({ job_id: '1125', status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/media-extractions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      source_asset_id: '3985',
      output_format: 'mp3',
    });
  });
});

describe('createVideoMatting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  it('向项目智能抠像端点提交冻结五键（源素材/占位卡/模式/格式/token）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '77', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createVideoMatting('project/1', {
        source_asset_id: '3985',
        target_node_id: 'smart-matting-1',
        mode: 'greenscreen',
        format: 'MP4',
        background_color: 'green',
        client_token: 'token-01',
      }),
    ).resolves.toEqual({ job_id: '77', status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/video-mattings');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      source_asset_id: '3985',
      target_node_id: 'smart-matting-1',
      mode: 'greenscreen',
      format: 'MP4',
      background_color: 'green',
      client_token: 'token-01',
    });
  });

  it('创建失败：错误提示单源——HTTP 层恰好提示一次（审查修复 S1，调用方不得二次 toast）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 1049, msg: '智能抠像失败，请重试', data: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      createVideoMatting('p1', {
        source_asset_id: '1',
        target_node_id: 'smart-matting-1',
        mode: 'portrait',
        format: 'WEBM',
        client_token: 'token-02',
      }),
    ).rejects.toBeInstanceOf(ApiError);

    // 不传 silent = 失败提示由 HTTP 层承担且只承担一次；页面只落占位卡失败态
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('智能抠像失败，请重试');
  });
});

describe('createVideoEnhancement', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('向项目视频 HD 高清端点提交冻结三键（IKH3VH，契约键名恒等）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '901', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createVideoEnhancement('p1', {
        source_asset_id: '5',
        target_node_id: 'media-draft-1',
        resolution: '2k',
      }),
    ).resolves.toEqual({ job_id: '901', status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/p1/video-enhancements');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(init.body as string)).toEqual({
      source_asset_id: '5',
      target_node_id: 'media-draft-1',
      resolution: '2k',
    });
  });
});

describe('createFrameInterpolation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('向项目视频插帧端点提交冻结三键（IKHLKX / IKHLK3 端点，契约键名恒等、fps 整型直传、无幂等头）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '902', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createFrameInterpolation('project/1', {
        source_asset_id: '3985',
        target_node_id: 'media-draft-7',
        fps: 120,
      }),
    ).resolves.toEqual({ job_id: '902', status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/video-frame-interpolations');
    expect(init.method).toBe('POST');
    // 免费口径（ADR-0113 同 HD 高清）：无幂等头，body 也不带 client_token
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(init.body as string)).toEqual({
      source_asset_id: '3985',
      target_node_id: 'media-draft-7',
      fps: 120,
    });
  });

  it('silent 透传：创建失败仍抛 ApiError 但 http 层不 toast（调用方 catch 统一提示一次，IKHSFH）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 1028, msg: '任务入队失败', data: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(toast.error).mockClear();

    await expect(
      createFrameInterpolation('p1', {
        source_asset_id: '3985',
        target_node_id: 'media-draft-7',
        fps: 60,
      }, { silent: true }),
    ).rejects.toThrow('任务入队失败');

    // silent：http 层不弹（面板保留可重发的错误由 CanvasPage catch 提示，全链路只一次）
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('缺省 init：维持家族默认 toast 口径（不传 silent 时 http 层照常提示）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 1028, msg: '任务入队失败', data: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(toast.error).mockClear();

    await expect(
      createFrameInterpolation('p1', {
        source_asset_id: '3985',
        target_node_id: 'media-draft-7',
        fps: 60,
      }),
    ).rejects.toThrow('任务入队失败');

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('任务入队失败');
  });
});

describe('createAudioTrim', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 统一 200 信封桩（键名与 backend/libs/contracts/audio-trim.ts 契约恒等断言用） */
  function stubCreated(jobId = '1130') {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: jobId, status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('向项目音频截取端点提交中间段四键（URL 编码项目 id、无幂等头）', async () => {
    const fetchMock = stubCreated();

    await expect(
      createAudioTrim('project/1', {
        source_asset_id: '3985',
        start_time: 2.4,
        end_time: 13,
        output_format: 'mp3',
      }),
    ).resolves.toEqual({ job_id: '1130', status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/audio-trims');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(init.body as string)).toEqual({
      source_asset_id: '3985',
      start_time: 2.4,
      end_time: 13,
      output_format: 'mp3',
    });
  });

  it('贴边省略：选区贴 0 省略 start_time 键、贴全长省略 end_time 键（走官方默认片头片尾）', async () => {
    // 每次调用构造新 Response（同一实例 body 只能消费一次）
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '1131', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    // 左缘贴 0：只有 end_time
    await expect(
      createAudioTrim('p1', { source_asset_id: '5', end_time: 8.25, output_format: 'wav' }),
    ).resolves.toEqual({ job_id: '1131', status: 'queued' });
    // 右缘贴全长：只有 start_time
    await expect(
      createAudioTrim('p1', { source_asset_id: '5', start_time: 3, output_format: 'wav' }),
    ).resolves.toEqual({ job_id: '1131', status: 'queued' });
    // 双贴边（全选）：起止键都不出现
    await expect(
      createAudioTrim('p1', { source_asset_id: '5', output_format: 'wav' }),
    ).resolves.toEqual({ job_id: '1131', status: 'queued' });

    expect(fetchMock.mock.calls).toHaveLength(3);
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      source_asset_id: '5',
      end_time: 8.25,
      output_format: 'wav',
    });
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)).toEqual({
      source_asset_id: '5',
      start_time: 3,
      output_format: 'wav',
    });
    expect(JSON.parse((fetchMock.mock.calls[2]![1] as RequestInit).body as string)).toEqual({
      source_asset_id: '5',
      output_format: 'wav',
    });
  });
});

describe('createVocalSplit', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('向项目人声背景分离端点提交源素材 + 场景 + 格式三键（IKHA2W，契约键名恒等）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '9012', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createVocalSplit('p1', { source_asset_id: '5', scene: 'drama', output_format: 'flac' }),
    ).resolves.toEqual({ job_id: '9012', status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/p1/vocal-splits');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(init.body as string)).toEqual({
      source_asset_id: '5',
      scene: 'drama',
      output_format: 'flac',
    });
  });
});

describe('readJobFailText', () => {
  it('优先 msg，其次 message', () => {
    expect(readJobFailText({ msg: '账户余额不足，请充值后重试', message: 'ignored' })).toBe(
      '账户余额不足，请充值后重试',
    );
    expect(readJobFailText({ message: '视频没有音轨' })).toBe('视频没有音轨');
    expect(readJobFailText({ msg: '  ' })).toBe('');
    expect(readJobFailText(null)).toBe('');
  });
});

describe('isGenerationDomainError', () => {
  it('只把 1000-1099 当成生成任务失败', () => {
    expect(isGenerationDomainError(new ApiError(200, '账户余额不足，请充值后重试', 1001))).toBe(true);
    expect(isGenerationDomainError(new ApiError(200, '资源不存在', 100301))).toBe(false);
    expect(isGenerationDomainError(new ApiError(500, '内部错误', 500))).toBe(false);
    expect(isGenerationDomainError(new Error('network'))).toBe(false);
  });
});

describe('fetchJobStatus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('成功信封解包 data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 200,
            msg: null,
            data: { job_id: '1584', status: 'processing', progress: 30, asset: null },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(fetchJobStatus('1584')).resolves.toEqual({
      job_id: '1584',
      status: 'processing',
      progress: 30,
      asset: null,
    });
  });

  it('1xxx + 顶层 msg 收敛为 failed，不抛给轮询重试', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 1001,
            msg: '账户余额不足，请充值后重试',
            data: { job_id: '1585', status: 'failed', progress: 0, asset: null },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(fetchJobStatus('1585')).resolves.toEqual({
      job_id: '1585',
      status: 'failed',
      progress: 0,
      asset: null,
      error: { code: 1001, msg: '账户余额不足，请充值后重试' },
    });
  });

  it('非领域错误码仍然抛出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 100301, msg: '资源不存在', data: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(fetchJobStatus('9')).rejects.toMatchObject({
      code: 100301,
      message: '资源不存在',
    });
  });
});
