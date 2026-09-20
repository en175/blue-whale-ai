import { describe, expect, it } from 'vitest';
import {
  SCENE_SPLIT_ENTRY_HINT,
  SCENE_SPLIT_MAX_DURATION_SECONDS,
  SCENE_SPLIT_MISSING_ASSET_REASON,
  SCENE_SPLIT_OVER_DURATION_REASON,
  sceneSplitGateReason,
} from './sceneSplit';

describe('sceneSplitGateReason（场景切分门槛预检，IKH8BJ）', () => {
  it('已关联资产且时长未超限放行（assetId 字符串/数字形态均放行）', () => {
    expect(sceneSplitGateReason({ assetId: '5' })).toBeNull();
    expect(sceneSplitGateReason({ assetId: 9 })).toBeNull();
    expect(sceneSplitGateReason({ assetId: '5', duration: 3600 })).toBeNull();
  });

  it('assetId 缺失（null/undefined）置灰并悬停唯一资产原因（门槛一，优先于时长判定）', () => {
    expect(sceneSplitGateReason({})).toBe(SCENE_SPLIT_MISSING_ASSET_REASON);
    expect(sceneSplitGateReason({ assetId: null })).toBe(SCENE_SPLIT_MISSING_ASSET_REASON);
    expect(sceneSplitGateReason({})).toContain('尚未关联资产');
    // 未关联资产且超长：仍归资产原因（先资产后时长的判定顺序）
    expect(
      sceneSplitGateReason({ assetId: null, duration: 7200 + 1 }),
    ).toBe(SCENE_SPLIT_MISSING_ASSET_REASON);
  });

  it('时长超 2 小时且有时长数据置灰并悬停原因（门槛二）：恰 7200 放行、7201 置灰', () => {
    expect(SCENE_SPLIT_MAX_DURATION_SECONDS).toBe(7200);
    expect(sceneSplitGateReason({ assetId: '5', duration: 7200 })).toBeNull();
    expect(sceneSplitGateReason({ assetId: '5', duration: 7200.001 })).toBe(
      SCENE_SPLIT_OVER_DURATION_REASON,
    );
    expect(sceneSplitGateReason({ assetId: '5', duration: 9000 })).toContain('2 小时');
  });

  it('时长数据缺失（undefined/null）放行不置灰（存量视频交后端按权威数据复核）', () => {
    expect(sceneSplitGateReason({ assetId: '5' })).toBeNull();
    // 持久化快照可能带 null（JSON 形态），运行时与 undefined 同走 typeof 守卫放行
    expect(sceneSplitGateReason({ assetId: '5', duration: null as unknown as number })).toBeNull();
  });

  it('非数值时长（NaN/字符串形态缺失）不判超限放行（仅数值参与比较）', () => {
    expect(sceneSplitGateReason({ assetId: '5', duration: NaN })).toBeNull();
    expect(
      sceneSplitGateReason({ assetId: '5', duration: undefined as unknown as number }),
    ).toBeNull();
  });

  it('格式不做前置拦截：门槛只认资产与时长，无格式原因与格式常量（任务失败口径兜底）', () => {
    expect(SCENE_SPLIT_MISSING_ASSET_REASON).not.toContain('格式');
    expect(SCENE_SPLIT_OVER_DURATION_REASON).not.toContain('格式');
  });

  it('入口效果边界 hint 常量（可用态悬停文案：切分为片段卡）', () => {
    expect(SCENE_SPLIT_ENTRY_HINT).toContain('场景');
    expect(SCENE_SPLIT_ENTRY_HINT).toContain('片段');
  });
});
