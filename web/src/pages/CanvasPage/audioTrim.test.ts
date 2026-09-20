import { describe, expect, it } from 'vitest';
import {
  AUDIO_TRIM_MISSING_DURATION_REASON,
  audioTrimGateReason,
} from './audioTrim';

describe('audioTrimGateReason（音频卡「截取」入口门槛预检，IKHB6Y）', () => {
  it('有音频 URL 且时长 > 0 放行（分数时长亦放行）', () => {
    expect(audioTrimGateReason({ src: 'blob:test', duration: 12 })).toBeNull();
    expect(audioTrimGateReason({ src: 'http://a/x.mp3', duration: 0.5 })).toBeNull();
  });

  it('音频 URL 缺失置灰并悬停唯一原因（undefined/null/空串）', () => {
    expect(audioTrimGateReason({ duration: 12 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: null, duration: 12 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: '', duration: 12 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
  });

  it('时长缺失或非正置灰并悬停唯一原因（undefined/null/0/负数，IKHB6Y 双条件之二）', () => {
    expect(audioTrimGateReason({ src: 'blob:test' })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: 'blob:test', duration: null })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: 'blob:test', duration: 0 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(audioTrimGateReason({ src: 'blob:test', duration: -3 })).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
  });

  it('不照搬家族「数据缺失不拦」口径：URL 与时长双缺失同样置灰（截取手柄换算硬性依赖时长）', () => {
    expect(audioTrimGateReason({})).toBe(AUDIO_TRIM_MISSING_DURATION_REASON);
    expect(AUDIO_TRIM_MISSING_DURATION_REASON).toContain('时长缺失');
    expect(AUDIO_TRIM_MISSING_DURATION_REASON).toContain('无法截取');
  });
});
