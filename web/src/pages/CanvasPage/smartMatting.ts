/* ============================================
 * 视频智能抠像（IKHK7N 入口门槛 / IKHK9N 编辑态与发送闭环）：「智能抠像 ▾」入口
 * 门槛预检、双模式枚举与菜单文案（纯逻辑，无 React 依赖，形状与判定口径对齐
 * sceneSplit.ts / audioVideoSplit.ts 先例）。
 * 时长 10 分钟上限出处 = ADR-0112（对齐智能去字幕的 10 分钟置灰：官方处理耗时为
 * 视频时长的 1~3 倍而 worker 轮询窗口约 60 分钟，不拦等于让长视频注定超时失败）；
 * 分辨率与输入格式不做前置拦截（官方支持 mp4/flv/ts/avi/mov/mkv/wmv 等主流格式，
 * 超限与不受支持均由任务失败口径兜底）。
 * ============================================ */

/** 入口可用态悬停说明（效果边界，对齐家族 ENTRY_HINT 口径） */
export const SMART_MATTING_ENTRY_HINT = '识别人物或绿幕主体并移除背景，输出透明/纯色视频';

/** 置灰原因一（同场景切分：视频未关联资产时入口不可用） */
export const SMART_MATTING_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法智能抠像';

/** 10 分钟时长上限（秒）：时长超限且有数据时置灰；恰好 600 放行（超限才拦） */
export const SMART_MATTING_MAX_DURATION_SECONDS = 600;

/** 置灰原因二：时长超 10 分钟且有时长数据（时长缺失不判，由后端按权威数据复核） */
export const SMART_MATTING_OVER_DURATION_REASON = '视频超过 10 分钟，暂不支持智能抠像';

/** 门槛判定输入：与 MediaNode data 字段同名（assetId 视频关联资产 id，duration 时长秒）。 */
export interface SmartMattingGateSource {
  assetId?: string | number | null;
  duration?: number;
}

/** 「智能抠像」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰条件两条 = 视频未关联资产；时长超 10 分钟（>600s）且有时长数据。
 *  时长数据缺失（null/undefined，存量数据）放行不拦，由后端按权威数据复核；
 *  分辨率与输入格式不做前置拦截（超限走任务失败口径兜底）。 */
export function smartMattingGateReason(source: SmartMattingGateSource): string | null {
  if (source.assetId == null) return SMART_MATTING_MISSING_ASSET_REASON;
  if (
    typeof source.duration === 'number'
    && source.duration > SMART_MATTING_MAX_DURATION_SECONDS
  ) {
    return SMART_MATTING_OVER_DURATION_REASON;
  }
  return null;
}

/* ============ 抠像模式（ADR-0112：模式前置到入口下拉） ============ */

/** 抠像模式（ADR-0112：双模式对齐火山 matte-portrait-video / matte-greenscreen-video
 *  两端点）：入口菜单两项各进一种会话，会话内不互切（换模式 = 退出后从菜单重选，
 *  去字幕家族口径）；触发钮点击直启首项「人像抠像」（portrait）。 */
export type SmartMattingMode = 'portrait' | 'greenscreen';

/** 首项「人像抠像」菜单项悬停说明（工单验收：任意视频只识别人物主体） */
export const SMART_MATTING_PORTRAIT_HINT = '任意视频，自动识别人物主体';

/** 次项「绿幕抠像」菜单项悬停说明（工单验收：绿幕/纯色背景素材，主体可为人、物品、动物） */
export const SMART_MATTING_GREENSCREEN_HINT = '绿幕/纯色背景素材，主体可为人、物品、动物';
