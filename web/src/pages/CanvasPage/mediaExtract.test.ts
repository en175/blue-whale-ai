import { describe, expect, it } from 'vitest';
import { mediaExtractErrorText, mediaExtractTerminalPatch } from './mediaExtract';

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
