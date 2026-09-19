import { describe, expect, it } from 'vitest';
import {
  buildMediaExtractPlaceholderNode,
  isMediaExtractNodeId,
  mediaExtractErrorText,
  mediaExtractTerminalPatch,
  mediaExtractNodeId,
} from './mediaExtract';

describe('mediaExtractErrorText', () => {
  it('优先 msg，其次 message，最后才按 code 映射', () => {
    expect(mediaExtractErrorText({ msg: '账户余额不足，请充值后重试', message: 'ignored' })).toBe(
      '账户余额不足，请充值后重试',
    );
    expect(mediaExtractErrorText({ code: 1023, message: '视频没有音轨' })).toBe('视频没有音轨');
    expect(mediaExtractErrorText({ code: 'video_has_no_audio_track' })).toBe('视频没有音轨');
    expect(mediaExtractErrorText(null)).toBe('音频提取失败');
  });

  it('火山路径统一兜底码 media_extract_provider_failed（1044）映射「请重试」文案', () => {
    expect(mediaExtractErrorText({ code: 'media_extract_provider_failed' })).toBe('音频提取失败，请重试');
  });
});

describe('mediaExtractTerminalPatch', () => {
  it('failed 时把 msg 写入 errorText', () => {
    expect(
      mediaExtractTerminalPatch({
        status: 'failed',
        error: { code: 1023, msg: '视频没有音轨' },
      }),
    ).toEqual({
      genStatus: 'failed',
      errorText: '视频没有音轨',
    });
  });

  it('succeeded 时落成品音频（保留当前展示名、后缀跟随建卡所选格式、时长取服务端权威值）', () => {
    expect(
      mediaExtractTerminalPatch(
        { status: 'succeeded', asset: { id: 'a1', url: 'http://tos/a1.m4a', duration: 65.5 } },
        '测试视频(audio).wav',
      ),
    ).toEqual({
      genStatus: undefined,
      progress: 100,
      src: 'http://tos/a1.m4a',
      mediaType: 'audio',
      fileName: '测试视频(audio).wav',
      assetId: 'a1',
      duration: 65.5,
    });
  });
});

describe('buildMediaExtractPlaceholderNode', () => {
  it('占位节点 id 与轮询/终态补丁共用同一约定', () => {
    const node = buildMediaExtractPlaceholderNode({
      jobId: '400',
      source: { position: { x: 100, y: 220 }, data: { fileName: '测试视频.mp4' } },
    });
    expect(node.id).toBe(mediaExtractNodeId('400'));
    expect(isMediaExtractNodeId(node.id)).toBe(true);
  });

  it('按源节点实际内容宽让开一格（16:9 视频约 498 宽 → x + 498 + 60）', () => {
    const node = buildMediaExtractPlaceholderNode({
      jobId: 400,
      source: {
        position: { x: 100, y: 220 },
        data: { fileName: '测试视频.mp4', mediaType: 'video', width: 1920, height: 1080 },
      },
    });
    expect(node.type).toBe('mediaNode');
    // 16:9 → 内容宽 280×16/9 = 497.78 → + 60 间距
    expect(node.position).toEqual({ x: 658, y: 220 });
    expect(node.data).toMatchObject({
      src: '',
      fileName: '测试视频(audio).m4a',
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId: 400,
    });
  });

  it('展示名后缀跟随所选格式（wav → xxx(audio).wav，不再恒 .mp3）', () => {
    const node = buildMediaExtractPlaceholderNode({
      jobId: '401',
      outputFormat: 'wav',
      source: { position: { x: 0, y: 0 }, data: { fileName: '测试视频.mp4' } },
    });
    expect(node.data.fileName).toBe('测试视频(audio).wav');
  });

  it('源节点无尺寸信息时按 280 方形让开（280 + 60）', () => {
    const node = buildMediaExtractPlaceholderNode({
      jobId: '402',
      source: { position: { x: 0, y: 0 }, data: { fileName: 'a.mp4' } },
    });
    expect(node.position).toEqual({ x: 340, y: 0 });
  });

  it('源节点信息缺失时回落默认展示名与偏移', () => {
    const node = buildMediaExtractPlaceholderNode({ jobId: '403', source: null });
    expect(node.position).toEqual({ x: 340, y: 0 });
    expect(node.data.fileName).toBe('音视频分离(audio).m4a');
  });

  it('携带 sourceAssetId 时写入 mediaExtract 身份（lastInput 冻结源素材+格式，失败重试原样重发）', () => {
    const node = buildMediaExtractPlaceholderNode({
      jobId: '404',
      outputFormat: 'flac',
      sourceAssetId: '9',
      source: { position: { x: 0, y: 0 }, data: { fileName: '测试视频.mp4' } },
    });
    expect(node.data.mediaExtract).toEqual({
      sourceAssetId: '9',
      lastInput: { source_asset_id: '9', output_format: 'flac' },
    });
  });

  it('sourceAssetId 缺失时不携带身份标记（存量失败卡无身份不渲染重试钮的对称口径）', () => {
    const node = buildMediaExtractPlaceholderNode({
      jobId: '405',
      source: { position: { x: 0, y: 0 }, data: { fileName: '测试视频.mp4' } },
    });
    expect(node.data.mediaExtract).toBeUndefined();
  });
});
