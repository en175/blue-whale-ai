// web/src/lib/video-reference-hints.ts
/** IKJ794（父单 IKJ6DK）：Seedance 2.5 全能参考前端被动提示。
 *  显示条件由各组件按「模型能力位（supported_aspect_ratios 含 adaptive = 2.5，与 IKFQ5S 同锚）
 *  + 全能参考模式 + 已挂 ≥1 参考视频」组合渲染，本模块只提供共享文案；adaptive 档显示名由上游 IKJ4W6 的 videoRatioLabel 承担（本工单原 aspectRatioLabelOf 与其重复，rebase 时收编），
 *  不含任何提示词关键词判定（前端零判定副本，见父单 Out of Scope）。 */

/** 全能参考被动提示：画布视频面板（BottomDialog）与首页输入框（ChatBox）同条件同文案 */
export const OMNI_REFERENCE_FOLLOW_HINT =
  '提示词若涉及修改、替换或延长原视频，输出比例与时长将自动跟随参考视频';

/** IKJ6DK「编辑/延长任务比例约束」错误码（IKJ795 接纳侧 4xx / IKJ79A worker 归类上游
 *  TaskTypeMismatch、TaskTypeConstraint 的异步失败，两种信封同码）：
 *  信封数值码 1060（分支期取 1056，rebase 撞 IKIZQ5/IKJ8J8 已落号改取下一空号），
 *  或 data.code 字符串 task_type_param_constraint。
 *  失败卡片按码识别展示一键修复（IKJ79D），不做文案匹配。 */
export function isTaskTypeParamConstraintCode(
  code: number | string | null | undefined,
): boolean {
  return code === 1060 || code === 'task_type_param_constraint';
}
