/* ============================================
 * 场景切分（IKH8BJ）：「场景切分」入口门槛预检与效果边界文案（纯逻辑，
 * 无 React 依赖，形状与判定口径对齐 audioVideoSplit.ts / videoSubtitleErase.ts 先例）。
 * 编辑态本体（源卡锁定、切分粒度、发送与扇出闭环）由后续票 IKH8BR 交付，
 * 本文件本期只承载入口门槛与文案。
 * ============================================ */

/** 入口可用态悬停说明（效果边界，对齐 audioVideoSplit ENTRY_HINT 家族口径） */
export const SCENE_SPLIT_ENTRY_HINT = '将视频按场景切分为多张片段卡片';

/** 置灰原因一（同音视频分离：视频未关联资产时入口不可用） */
export const SCENE_SPLIT_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法场景切分';

/** 2 小时时长上限（秒）：时长超限且有数据时置灰；恰好 7200 放行（超限才拦） */
export const SCENE_SPLIT_MAX_DURATION_SECONDS = 7200;

/** 置灰原因二：时长超 2 小时且有时长数据（时长缺失不判，由后端按权威数据复核） */
export const SCENE_SPLIT_OVER_DURATION_REASON = '视频超过 2 小时，暂不支持场景切分';

/** 门槛判定输入：与 MediaNode data 字段同名（assetId 视频关联资产 id，duration 时长秒）。 */
export interface SceneSplitGateSource {
  assetId?: string | number | null;
  duration?: number;
}

/** 「场景切分」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰条件两条 = 视频未关联资产；时长超 2 小时（>7200s）且有时长数据。
 *  时长数据缺失（null/undefined，存量数据）放行不拦，由后端按权威数据复核；
 *  格式不做前置拦截（超限走任务失败口径兜底）。 */
export function sceneSplitGateReason(source: SceneSplitGateSource): string | null {
  if (source.assetId == null) return SCENE_SPLIT_MISSING_ASSET_REASON;
  if (
    typeof source.duration === 'number'
    && source.duration > SCENE_SPLIT_MAX_DURATION_SECONDS
  ) {
    return SCENE_SPLIT_OVER_DURATION_REASON;
  }
  return null;
}
