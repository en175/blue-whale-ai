// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ApiError } from './http';
import {
  createGenerationJob,
  retryGenerationJob,
  createAudioMix,
  retryAudioMix,
  createAudioTrim,
  createAudioSpeed,
  createFrameInterpolation,
  createMediaExtraction,
  createVocalSplit,
  createVideoEnhancement,
  createVideoMatting,
  createImageErase,
  createImageCutout,
  createVideoSubtitleErase,
  createVideoSceneSplit,
  fetchJobStatus,
  isGenerationDomainError,
  readJobFailText,
} from './jobs';
import { audioMixJobsOptions } from './audioMixRecovery';

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

describe('createAudioMix', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  it('提交冻结双源，静默传输错误交由画布提示一次', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 1028, msg: '混合任务创建失败', data: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const payload = {
      source_node_id: 'source',
      inputs: [{ asset_id: '8', node_id: 'source' }, { asset_id: '6', node_id: 'second' }],
      output_format: 'mp3' as const,
    };

    await expect(createAudioMix('project/1', payload, { silent: true })).rejects.toThrow('混合任务创建失败');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects/project%2F1/audio-mixes');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual(payload);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('retryAudioMix', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('同一结果卡重试时提交原 jobId 与稳定幂等键，不重发输入', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '73', status: 'queued', replayed: false } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(retryAudioMix('project/1', '73', 'retry-key-73', { silent: true }))
      .resolves.toMatchObject({ job_id: '73', status: 'queued' });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/audio-mixes/73/retry');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('retry-key-73');
    expect(init.body).toBeUndefined();
  });
});

describe('audioMixJobsOptions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('逐页读取同项目混合任务，能找回超过首 100 条后的未落盘任务', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, msg: 'ok', data: {
        records: Array.from({ length: 100 }, (_, index) => ({ job_id: String(index + 1), type: 'audio_mix' })),
        total: 101, size: 100, current: 1,
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, msg: 'ok', data: {
        records: [{ job_id: '101', type: 'audio_mix', canvas_card_state: 'pending' }],
        total: 101, size: 100, current: 2,
      } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const records = await audioMixJobsOptions('project/1').queryFn!({} as never);
    expect(records).toHaveLength(101);
    expect(records[100]).toMatchObject({ job_id: '101', canvas_card_state: 'pending' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/jobs?projectId=project%2F1&type=audio_mix&size=100&page=1',
      '/api/jobs?projectId=project%2F1&type=audio_mix&size=100&page=2',
    ]);
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
          JSON.stringify({ code: 1050, msg: '智能抠像失败，请重试', data: null }),
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

describe('createAudioSpeed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('向项目音频调速端点提交源素材 + 倍速（IKHW5S，契约键名恒等、无幂等头）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '1132', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createAudioSpeed('project/1', { source_asset_id: '3985', speed: 1.35 }),
    ).resolves.toEqual({ job_id: '1132', status: 'queued' });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/audio-speeds');
    expect(init.method).toBe('POST');
    expect(init.headers).not.toHaveProperty('Idempotency-Key');
    expect(JSON.parse(init.body as string)).toEqual({ source_asset_id: '3985', speed: 1.35 });
  });

  it('贴原速省略：speed 1.0 不出现键（走官方默认 1，契约 buildAudioSpeedInput 口径）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { job_id: '1133', status: 'queued' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createAudioSpeed('p1', { source_asset_id: '5' }),
    ).resolves.toEqual({ job_id: '1133', status: 'queued' });

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ source_asset_id: '5' });
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

/* IKI8L4 工具会话创建函数 silent 透传：错误提示归属持有发送身份的调用方——
   创建传输走 silent（http 层不 toast），迟到失败不抢在会话纪元判断之前弹出，
   当前会话失败由页面 catch 统一提示一次（audioSpeed IKI4LX / 插帧 IKHSFH 先例推广）。 */
describe('IKI8L4 工具会话创建 silent 透传', () => {
  // 前序 describe 的 afterEach 不清 toast spy，进入本组用例前先清零计数
  beforeEach(() => vi.mocked(toast.error).mockClear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  /** 统一业务失败桩：HTTP 200 + 信封 code!==200 + msg */
  function stubCreateFail(msg = '服务繁忙，请稍后重试') {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 1, msg, data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  }

  it.each([
    ['createAudioTrim', () => createAudioTrim('p1', { source_asset_id: '3985', output_format: 'mp3' }, { silent: true })],
    ['createVocalSplit', () => createVocalSplit('p1', { source_asset_id: '3985' }, { silent: true })],
    ['createMediaExtraction', () => createMediaExtraction('p1', { source_asset_id: '3985' }, { silent: true })],
    ['createVideoSubtitleErase', () => createVideoSubtitleErase('p1', {
      source_asset_id: '3985', target_node_id: 'media-draft-7', detect_mode: 'subtitle_smart', erase_boxes: [],
    }, { silent: true })],
    ['createImageCutout', () => createImageCutout('p1', {
      source_asset_id: '3985', target_node_id: 'media-draft-7', cutout_scene: 'general',
    }, { silent: true })],
    ['createImageErase', () => createImageErase('p1', {
      source_asset_id: '3985', target_node_id: 'media-draft-7', erase_scene: 'full_screen_text_erase',
    }, { silent: true })],
    ['createVideoSceneSplit', () => createVideoSceneSplit('p1', {
      source_asset_id: '3985', target_node_id: 'scene-split-1', granularity: 'standard', client_token: 'tok',
    }, { silent: true })],
  ] as const)('%s：silent 失败仍抛 ApiError 但 http 层不 toast', async (_name, invoke) => {
    stubCreateFail();
    await expect(invoke()).rejects.toThrow('服务繁忙，请稍后重试');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('缺省 init：家族默认 toast 口径不变（其他调用方行为不受 IKI8L4 影响）', async () => {
    stubCreateFail('服务繁忙，请稍后重试');
    await expect(createAudioTrim('p1', { source_asset_id: '3985', output_format: 'mp3' })).rejects.toThrow('服务繁忙，请稍后重试');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('服务繁忙，请稍后重试');
  });
});

describe('建任务/重试的幂等头由调用方持有', () => {
  afterEach(() => vi.unstubAllGlobals());

  // 每次调用返回**新的** Response：响应体只能消费一次，复用同一个实例会让第二次请求解析失败
  const okCreated = () =>
    vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ code: 200, msg: 'ok', data: { generation_job_id: '9', cursor: 1 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  const createdPayload = {
    type: 'image' as const,
    expected_output_count: 1,
    parameters: { prompt: '一只蓝鲸', model_id: 'm', aspect_ratio: '1:1', size: '2k' },
  };

  it('createGenerationJob 把调用方给的钥匙原样放进 Idempotency-Key（不在请求函数里现造）', async () => {
    const fetchMock = okCreated();
    vi.stubGlobal('fetch', fetchMock);

    await expect(createGenerationJob('project/1', createdPayload, 'submit-key-1'))
      .resolves.toEqual({ generation_job_id: '9', cursor: 1 });
    await createGenerationJob('project/1', createdPayload, 'submit-key-1');

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/generation-jobs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(createdPayload);
    // 调用方复用同一把钥匙 → 两次请求同一个头，服务端据此重放首次结果而不是再建一个 job
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('submit-key-1');
    expect(new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers).get('Idempotency-Key')).toBe('submit-key-1');
  });

  it('retryGenerationJob 同样提交调用方持有的钥匙（无 body，身份全在路径与头里）', async () => {
    const fetchMock = okCreated();
    vi.stubGlobal('fetch', fetchMock);

    await expect(retryGenerationJob('project/1', '73', 'retry-key-73'))
      .resolves.toEqual({ generation_job_id: '9', cursor: 1 });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/project%2F1/generation-jobs/73/retry');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('retry-key-73');
    expect(init.body).toBeUndefined();
  });
});
