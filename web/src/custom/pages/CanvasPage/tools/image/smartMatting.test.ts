import { describe, expect, it } from 'vitest';
import { VIDEO_MATTING_MAX_DURATION_MS } from '@lib/contracts/video-matting';
import {
  SMART_MATTING_ENTRY_HINT,
  SMART_MATTING_GREENSCREEN_HINT,
  SMART_MATTING_MAX_DURATION_SECONDS,
  SMART_MATTING_MISSING_ASSET_REASON,
  SMART_MATTING_OVER_DURATION_REASON,
  SMART_MATTING_PORTRAIT_HINT,
  smartMattingGateReason,
} from './smartMatting';

describe('smartMattingGateReason（智能抠像门槛预检，IKHK7N）', () => {
  it('时长上限单源：web 门槛秒值与契约 VIDEO_MATTING_MAX_DURATION_MS 同值（防重新硬编码漂移）', () => {
    expect(SMART_MATTING_MAX_DURATION_SECONDS * 1000).toBe(VIDEO_MATTING_MAX_DURATION_MS);
  });

  it('已关联资产且时长未超限放行（assetId 字符串/数字形态均放行）', () => {
    expect(smartMattingGateReason({ assetId: '5' })).toBeNull();
    expect(smartMattingGateReason({ assetId: 9 })).toBeNull();
    expect(smartMattingGateReason({ assetId: '5', duration: 300 })).toBeNull();
  });

  it('assetId 缺失（null/undefined）置灰并悬停唯一资产原因（门槛一，优先于时长判定）', () => {
    expect(smartMattingGateReason({})).toBe(SMART_MATTING_MISSING_ASSET_REASON);
    expect(smartMattingGateReason({ assetId: null })).toBe(SMART_MATTING_MISSING_ASSET_REASON);
    expect(smartMattingGateReason({})).toContain('尚未关联资产');
    expect(
      smartMattingGateReason({ assetId: null, duration: 600 + 1 }),
    ).toBe(SMART_MATTING_MISSING_ASSET_REASON);
  });

  it('时长超 10 分钟且有时长数据置灰并悬停原因（门槛二，ADR-0112 对齐去字幕）：恰 600 放行、600.001 置灰', () => {
    expect(SMART_MATTING_MAX_DURATION_SECONDS).toBe(600);
    expect(smartMattingGateReason({ assetId: '5', duration: 600 })).toBeNull();
    expect(smartMattingGateReason({ assetId: '5', duration: 600.001 })).toBe(
      SMART_MATTING_OVER_DURATION_REASON,
    );
    expect(smartMattingGateReason({ assetId: '5', duration: 900 })).toContain('10 分钟');
  });

  it('时长数据缺失（undefined/null）放行不置灰（存量视频交后端按权威数据复核）', () => {
    expect(smartMattingGateReason({ assetId: '5' })).toBeNull();
    expect(smartMattingGateReason({ assetId: '5', duration: null as unknown as number })).toBeNull();
  });

  it('非数值时长（NaN/字符串形态缺失）不判超限放行（仅数值参与比较）', () => {
    expect(smartMattingGateReason({ assetId: '5', duration: NaN })).toBeNull();
    expect(
      smartMattingGateReason({ assetId: '5', duration: undefined as unknown as number }),
    ).toBeNull();
  });

  it('分辨率与输入格式不做前置拦截：门槛只认资产与时长，无分辨率/格式原因（任务失败口径兜底）', () => {
    expect(SMART_MATTING_MISSING_ASSET_REASON).not.toContain('分辨率');
    expect(SMART_MATTING_OVER_DURATION_REASON).not.toContain('分辨率');
    expect(SMART_MATTING_MISSING_ASSET_REASON).not.toContain('格式');
    expect(SMART_MATTING_OVER_DURATION_REASON).not.toContain('格式');
  });

  it('入口效果边界 hint 常量（可用态悬停文案：识别主体移除背景）', () => {
    expect(SMART_MATTING_ENTRY_HINT).toContain('主体');
    expect(SMART_MATTING_ENTRY_HINT).toContain('背景');
  });
});

describe('双模式菜单文案常量（IKHK7N，ADR-0112 模式前置到入口下拉）', () => {
  it('人像抠像 hint：任意视频只识别人物主体', () => {
    expect(SMART_MATTING_PORTRAIT_HINT).toContain('任意视频');
    expect(SMART_MATTING_PORTRAIT_HINT).toContain('人物');
  });

  it('绿幕抠像 hint：绿幕/纯色背景素材，主体可为人、物品、动物', () => {
    expect(SMART_MATTING_GREENSCREEN_HINT).toContain('纯色背景');
    expect(SMART_MATTING_GREENSCREEN_HINT).toContain('物品');
    expect(SMART_MATTING_GREENSCREEN_HINT).toContain('动物');
  });
});
