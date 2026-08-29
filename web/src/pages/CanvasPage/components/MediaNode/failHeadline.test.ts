import { describe, expect, it } from 'vitest';
import { mediaNodeFailHeadline } from './failHeadline';

describe('mediaNodeFailHeadline', () => {
  it('shows cancelled copy even when errorText exists', () => {
    expect(
      mediaNodeFailHeadline({
        genStatus: 'cancelled',
        errorText: '账户余额不足，请充值后重试',
        isMediaExtraction: false,
      }),
    ).toBe('已取消生成');
  });

  it('prefers the backend error message for image/video/audio generation', () => {
    expect(
      mediaNodeFailHeadline({
        genStatus: 'failed',
        errorText: '账户余额不足，请充值后重试',
        isMediaExtraction: false,
      }),
    ).toBe('账户余额不足，请充值后重试');
  });

  it('falls back to 生成失败 when the backend message is missing', () => {
    expect(
      mediaNodeFailHeadline({
        genStatus: 'failed',
        isMediaExtraction: false,
      }),
    ).toBe('生成失败');
  });

  it('treats whitespace-only errorText as missing', () => {
    expect(
      mediaNodeFailHeadline({
        genStatus: 'failed',
        errorText: '   ',
        isMediaExtraction: false,
      }),
    ).toBe('生成失败');
  });

  it('prefers the backend error message for media extraction', () => {
    expect(
      mediaNodeFailHeadline({
        genStatus: 'failed',
        errorText: '视频没有音轨',
        isMediaExtraction: true,
      }),
    ).toBe('视频没有音轨');
  });

  it('falls back to 音频提取失败 when extraction has no backend message', () => {
    expect(
      mediaNodeFailHeadline({
        genStatus: 'failed',
        isMediaExtraction: true,
      }),
    ).toBe('音频提取失败');
  });
});
