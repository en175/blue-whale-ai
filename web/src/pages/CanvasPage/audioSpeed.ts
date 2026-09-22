/* ============================================
 * 音频调速（IKHW5C 入口门槛 / IKHW5S 编辑态与发送闭环，父单 IKHVYO）：纯逻辑，
 * 无 React 依赖。门槛形状对齐 audioTrim.ts 先例。与截取门槛（音频 URL 缺失或
 * 时长缺失/为 0 置灰）不同：调速编辑态无选区、时间换算不硬依赖时长，置灰唯一
 * 条件 = 音频 URL 与 assetId 皆缺失（任一存在即视为音频可用）——时长缺失不拦
 * （用户故事 4），不照搬截取的时长门槛。
 * 滑杆位置↔倍速映射（posToSpeed/speedToPos）在契约 @lib/contracts/audio-speed
 * 单源收口（父单实现决策 3），本票未消费；占位卡/终态补丁/命名由 IKHW5S 按本
 * 文件家族口径补齐。
 * ============================================ */

/** 唯一置灰原因（工单拍板文案：URL 与 assetId 皆缺失共用一句） */
export const AUDIO_SPEED_UNAVAILABLE_REASON = '音频不可用，无法调速';

/** 门槛判定输入：与 MediaNode data 字段同名（src 音频 URL、assetId 关联资产 id）。 */
export interface AudioSpeedGateSource {
  src?: string | null;
  assetId?: string | number | null;
}

/** 音频卡「调速」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  唯一置灰条件 = 音频 URL 与 assetId 皆缺失（未关联资产的空卡）；有 URL（本地可播）
 *  或有 assetId（可提交云端任务）任一即放行，时长不参与判定。 */
export function audioSpeedGateReason(source: AudioSpeedGateSource): string | null {
  if (source.src) return null;
  if (source.assetId != null && source.assetId !== '') return null;
  return AUDIO_SPEED_UNAVAILABLE_REASON;
}
