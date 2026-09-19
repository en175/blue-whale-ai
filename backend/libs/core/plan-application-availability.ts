/** PlanMessage 手动应用可用性三态（T10）：与 contracts planApplicationAvailabilitySchema
 *  对齐的字面量联合。core 不依赖 contracts（避免循环），故本地定义同源字面量。 */
export type PlanApplicationAvailabilityStatus =
  | "available"
  | "retryable_blocked"
  | "requires_new_plan";

export interface PlanApplicationAvailabilityInput {
  /** 本轮任一素材 unavailable（deleted/wrong_project/permission_lost）→ 必须重新计划。
   *  scene_card 的 stale 保留历史可用性，不计入（图片 plan 不引用 scene_card）。 */
  readonly mentionUnavailable: boolean;
  /** 冻结后能力永久漂移（行被删/禁用或 row_version/digest 变）→ 必须重新计划。 */
  readonly capabilityDrifted: boolean;
  /** 余额是否充足。null = 未知（snapshot 投影不查余额，不判 retryable_blocked）。
   *  false = 余额耗尽 → retryable_blocked（充值后用新 CommandId 重试）。 */
  readonly balanceSufficient: boolean | null;
}

/** 把素材可用性 + 能力漂移 + 余额状态收敛为对前端单一可渲染的三态（T10）。
 *  - mention 失效 或 能力永久漂移 → requires_new_plan（硬失败，重试无意义）；
 *  - 余额不足（balanceSufficient === false）→ retryable_blocked（软失败，可重试）；
 *  - 否则 available。
 *  纯函数，snapshot 读路径与 apply 预检闸门共用同一份决策。 */
export function classifyPlanApplicationAvailability(
  input: PlanApplicationAvailabilityInput,
): PlanApplicationAvailabilityStatus {
  if (input.capabilityDrifted || input.mentionUnavailable) {
    return "requires_new_plan";
  }
  if (input.balanceSufficient === false) {
    return "retryable_blocked";
  }
  return "available";
}
