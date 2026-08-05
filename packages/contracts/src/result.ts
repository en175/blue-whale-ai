/** 对齐 Java blue-whale-global Result<T>：{ code, msg, data }，msg 默认 null（不是 "success"）。
 *  前端 apiRequest 只看 code !== 200 抛错。 */
export const SUCCESS_CODE = 200;
export const FAILURE_CODE = 400;
export const DATA_NOT_EXIST_CODE = 100100; // 对齐 Java SystemCode.DATA_NOT_EXIST_CODE
export const ASSET_UNAVAILABLE_CODE = 100202; // 对齐 Java SystemCode.ASSET_UNAVAILABLE_CODE
export const RESOURCE_NOT_FOUND_CODE = 100301; // 对齐 Java SystemCode.RESOURCE_NOT_FOUND_CODE（不泄漏存在性）
export const IDEMPOTENCY_KEY_REUSED_CODE = 100302; // 对齐 Java SystemCode.IDEMPOTENCY_KEY_REUSED_CODE
export const AGENT_RUN_CONFLICT_CODE = 100303; // AgentRun 状态冲突（输入请求失效/运行中/配置冻结/当前状态不可停止）
export const AGENT_RUN_ALREADY_TERMINAL_CODE = 100307; // AgentRun 已处于终态，停止命令不改写（契约 §8.2）
export const AGENT_RUN_NOT_RETRYABLE_CODE = 100308; // AgentRun 非 failed 状态，不可手动重试（契约 §8.3）
export const PARAM_MISSING_CODE = 100000; // 对齐 Java GlobalException(100000, "缺少 Idempotency-Key")
// 计划应用闭环（IK67H9 / T11）：复用既有 IDEMPOTENCY_KEY_REUSED_CODE=100302 处理同 key 不同内容
export const PLAN_APPLICATION_PLAN_NOT_FOUND_CODE = 100401; // PlanMessage 不存在或不属于该项目
export const PLAN_APPLICATION_KIND_UNSUPPORTED_CODE = 100402; // PlanMessage 的 application_kind 当前不支持应用（如图片分支未实现）
export const PLAN_APPLICATION_CAPABILITY_DRIFT_CODE = 100403; // 冻结能力快照与当前能力版本不一致（CONTEXT requires_new_plan）
export const PLAN_APPLICATION_ALREADY_APPLIED_CODE = 100404; // 该 PlanMessage 已被成功应用过，不可重复应用
// SceneCard 生成编辑器（IK67HB / T13）：版本冲突零写入保留草稿（CONTEXT L84-89 乐观并发）
export const SCENE_CARD_VERSION_CONFLICT_CODE = 100405; // base 版本与当前 SceneCard/Preset 版本不一致

export interface ResultEnvelope<T> {
  code: number;
  msg: string | null;
  data: T | null;
}

export function ok(): ResultEnvelope<null>;
export function ok<T>(data: T, msg?: string | null): ResultEnvelope<T>;
export function ok<T>(data?: T, msg?: string | null): ResultEnvelope<T | null> {
  return { code: SUCCESS_CODE, data: data ?? null, msg: msg ?? null };
}

export function fail(code: number, msg: string | null, data?: unknown): ResultEnvelope<never>;
export function fail(code: number, msg: string | null, data?: unknown): ResultEnvelope<unknown>;
export function fail(code: number, msg: string | null, data?: unknown): ResultEnvelope<unknown> {
  return { code, msg, data: data ?? null };
}
