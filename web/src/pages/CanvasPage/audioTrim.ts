/* ============================================
 * 音频截取（IKHB6Y，父单 IKHB08）：音频卡「截取」入口门槛预检（纯逻辑，无 React 依赖，
 * 形状对齐 audioVideoSplit.ts 先例）。与家族「数据缺失不拦（null 放行，后端权威复核）」
 * 口径不同：截取编辑态的手柄时间换算硬性依赖音频时长，URL/时长缺失即置灰前置拦截。
 * ============================================ */

/** 唯一置灰原因（IKHB6Y 工单拍板文案：URL 缺失与时长缺失/为 0 共用一句） */
export const AUDIO_TRIM_MISSING_DURATION_REASON = '音频时长缺失，无法截取';

/** 门槛判定输入：与 MediaNode data 字段同名（src 音频 URL、duration 时长秒）。 */
export interface AudioTrimGateSource {
  src?: string | null;
  duration?: number | null;
}

/** 音频卡「截取」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰条件 = 音频 URL 缺失，或时长缺失/非正——不照搬家族「数据缺失不拦」口径，
 *  截取手柄时间换算硬性依赖时长，缺失即拦。 */
export function audioTrimGateReason(source: AudioTrimGateSource): string | null {
  if (!source.src) return AUDIO_TRIM_MISSING_DURATION_REASON;
  if (!(typeof source.duration === 'number' && source.duration > 0)) {
    return AUDIO_TRIM_MISSING_DURATION_REASON;
  }
  return null;
}
