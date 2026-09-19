import { describe, expect, it } from 'vitest';
import {
  VIDEO_SUBTITLE_ERASE_ENTRY_HINT,
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  videoSubtitleEraseGateReason,
} from './videoSubtitleErase';

describe('videoSubtitleEraseGateReason（智能去字幕门槛预检，IKGZ82）', () => {
  it('门槛内正常视频放行（横屏 1920×1080）', () => {
    expect(videoSubtitleEraseGateReason({ width: 1920, height: 1080, duration: 30 })).toBeNull();
  });

  it('恰在边界放行：横屏 2560×1440 / 竖屏 1440×2560（短长边语义，竖屏合法）/ 时长恰 10 分钟', () => {
    expect(
      videoSubtitleEraseGateReason({
        width: VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
        height: VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
        duration: VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS / 1000,
      }),
    ).toBeNull();
    expect(
      videoSubtitleEraseGateReason({
        width: VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
        height: VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
      }),
    ).toBeNull();
  });

  it('长边超 2560 置灰并说明 2K 原因', () => {
    expect(videoSubtitleEraseGateReason({ width: 2561, height: 1440 })).toContain('长边超过 2560');
  });

  it('短边超 1440 置灰并说明 2K 原因', () => {
    expect(videoSubtitleEraseGateReason({ width: 2560, height: 1441 })).toContain('短边超过 1440');
  });

  it('时长超 10 分钟置灰并说明原因（秒换算毫秒口径，600.001s 即拦）', () => {
    expect(videoSubtitleEraseGateReason({ width: 1920, height: 1080, duration: 600.001 })).toContain('10 分钟');
    expect(videoSubtitleEraseGateReason({ width: 1920, height: 1080, duration: 3601 })).toContain('10 分钟');
  });

  it('宽高或时长缺失（null 放行）：存量数据不误拦，交后端按权威数据复核', () => {
    expect(videoSubtitleEraseGateReason({})).toBeNull();
    expect(videoSubtitleEraseGateReason({ width: 4096 })).toBeNull(); // 仅一边实测回填前不拦
    expect(videoSubtitleEraseGateReason({ duration: 120 })).toBeNull();
    expect(videoSubtitleEraseGateReason({ width: 4096, duration: 7200 })).toContain('10 分钟'); // 时长仍独立判定
  });

  it('入口效果边界 hint 常量（可用态悬停文案，规格故事 6）', () => {
    expect(VIDEO_SUBTITLE_ERASE_ENTRY_HINT).toContain('白色中英文字幕');
    expect(VIDEO_SUBTITLE_ERASE_ENTRY_HINT).toContain('全画面模式');
  });
});
