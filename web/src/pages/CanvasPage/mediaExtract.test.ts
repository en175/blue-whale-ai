import { describe, expect, it } from 'vitest';
import {
  buildMediaExtractPlaceholderNode,
  isMediaExtractNodeId,
  mediaExtractErrorText,
  mediaExtractTerminalPatch,
  mediaExtractNodeId,
} from './mediaExtract';

describe('mediaExtractErrorText', () => {
  it('优先 msg，其次 message，最后才按旧 code 映射', () => {
    expect(mediaExtractErrorText({ msg: '账户余额不足，请充值后重试', message: 'ignored' })).toBe(
      '账户余额不足，请充值后重试',
    );
    expect(mediaExtractErrorText({ code: 1023, message: '视频没有音轨' })).toBe('视频没有音轨');
    expect(mediaExtractErrorText({ code: 'video_has_no_audio_track' })).toBe('视频没有音轨');
    expect(mediaExtractErrorText(null)).toBe('音频提取失败');
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
      fileName: '测试视频(audio).mp3',
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId: 400,
    });
  });

  it('源节点无尺寸信息时按 280 方形让开（280 + 60）', () => {
    const node = buildMediaExtractPlaceholderNode({
      jobId: '401',
      source: { position: { x: 0, y: 0 }, data: { fileName: 'a.mp4' } },
    });
    expect(node.position).toEqual({ x: 340, y: 0 });
  });

  it('源节点信息缺失时回落默认展示名与偏移', () => {
    const node = buildMediaExtractPlaceholderNode({ jobId: '402', source: null });
    expect(node.position).toEqual({ x: 340, y: 0 });
    expect(node.data.fileName).toBe('提取音频(audio).mp3');
  });
});
