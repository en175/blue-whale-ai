import { isApiError } from "@/lib/api/errors";
import {
  ASSET_UNAVAILABLE_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE,
  PLAN_APPLICATION_TARGET_STALE_CODE,
  type PlanApplicationAvailability,
} from "@blue-whale/contracts";

type PlanApplicationFailure = Readonly<{
  availability: Exclude<PlanApplicationAvailability, "available">;
}>;

const REQUIRES_NEW_PLAN_CODES = new Set([
  String(ASSET_UNAVAILABLE_CODE),
  String(PLAN_APPLICATION_CAPABILITY_DRIFT_CODE),
  String(PLAN_APPLICATION_TARGET_STALE_CODE),
]);
const QUOTA_INSUFFICIENT = String(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE);

/** 统一计划应用失败的 UI 可用性与 CommandId 消费策略。 */
export function classifyPlanApplicationFailure(
  error: unknown,
): PlanApplicationFailure | null {
  if (!isApiError(error)) return null;
  if (error.code === QUOTA_INSUFFICIENT) {
    return { availability: "retryable_blocked" };
  }
  if (REQUIRES_NEW_PLAN_CODES.has(error.code)) {
    return { availability: "requires_new_plan" };
  }
  return null;
}
