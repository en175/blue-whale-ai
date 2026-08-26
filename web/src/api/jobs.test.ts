// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaExtraction } from './jobs';

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
