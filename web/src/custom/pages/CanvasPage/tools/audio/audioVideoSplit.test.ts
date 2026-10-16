import { describe, expect, it } from 'vitest';
import {
  AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT,
  AUDIO_VIDEO_SPLIT_ENTRY_HINT,
  AUDIO_VIDEO_SPLIT_FORMATS,
  AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON,
  audioVideoSplitGateReason,
  isAudioVideoSplitFormat,
} from './audioVideoSplit';

describe('AUDIO_VIDEO_SPLIT_FORMATS（分离格式清单，GLOSSARY.md「分离格式」词条）', () => {
  it('五值 m4a/mp3/ogg/flac/wav，默认 m4a', () => {
    expect([...AUDIO_VIDEO_SPLIT_FORMATS]).toEqual(['m4a', 'mp3', 'ogg', 'flac', 'wav']);
    expect(AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT).toBe('m4a');
  });

  it('isAudioVideoSplitFormat 守卫：清单内五值为真，其余为假（大小写敏感、数字/空串拒绝）', () => {
    for (const format of AUDIO_VIDEO_SPLIT_FORMATS) {
      expect(isAudioVideoSplitFormat(format)).toBe(true);
    }
    expect(isAudioVideoSplitFormat('M4A')).toBe(false);
    expect(isAudioVideoSplitFormat('aac')).toBe(false);
    expect(isAudioVideoSplitFormat('')).toBe(false);
    expect(isAudioVideoSplitFormat(1)).toBe(false);
    expect(isAudioVideoSplitFormat(null)).toBe(false);
    expect(isAudioVideoSplitFormat(undefined)).toBe(false);
  });
});

describe('audioVideoSplitGateReason（音视频分离门槛预检，IKH28U）', () => {
  it('已关联资产放行（assetId 字符串/数字形态均放行）', () => {
    expect(audioVideoSplitGateReason({ assetId: '5' })).toBeNull();
    expect(audioVideoSplitGateReason({ assetId: 9 })).toBeNull();
  });

  it('assetId 缺失（null/undefined）置灰并悬停唯一原因（ADR-0103 决策四：唯一置灰条件）', () => {
    expect(audioVideoSplitGateReason({})).toBe(AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON);
    expect(audioVideoSplitGateReason({ assetId: null })).toBe(AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON);
    expect(audioVideoSplitGateReason({})).toContain('尚未关联资产');
  });

  it('分辨率/时长不参与置灰（不做前置拦截，超限由任务失败口径兜底）', () => {
    expect(audioVideoSplitGateReason({ assetId: '5' })).toBeNull();
    expect(AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON).not.toContain('分辨率');
    expect(AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON).not.toContain('时长');
  });

  it('入口效果边界 hint 常量（可用态悬停文案：仅音频产物，GLOSSARY.md Avoid 词条）', () => {
    expect(AUDIO_VIDEO_SPLIT_ENTRY_HINT).toContain('音轨');
    expect(AUDIO_VIDEO_SPLIT_ENTRY_HINT).toContain('仅音频');
  });
});
