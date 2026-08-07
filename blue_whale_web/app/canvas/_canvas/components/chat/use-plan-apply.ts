"use client";

// IK74V6：手动应用冻结计划的本地交互态（从 AgentChatPanel 下沉）。
// 权威「已应用」态始终由 Snapshot/SSE 投影，本 hook 只维护请求防重入与错误覆盖。
import { useEffect, useState } from "react";
import {
  PLAN_APPLICATION_ALREADY_APPLIED_CODE,
  type PlanApplicationAvailability,
} from "@blue-whale/contracts";
import { classifyPlanApplicationFailure } from "@/lib/plan-application-failure";
import { isApiError } from "@/lib/api/errors";
import type { WireInteger } from "@/lib/wire-integer";
import type { ChatMessage } from "../../types";

const ALREADY_APPLIED = String(PLAN_APPLICATION_ALREADY_APPLIED_CODE);

export type PlanAvailabilityOverride = Exclude<
  PlanApplicationAvailability,
  "available"
>;

export function usePlanApply({
  messages,
  onApplyPlanMessage,
}: {
  messages: ChatMessage[];
  onApplyPlanMessage?: (planMessageId: WireInteger) => Promise<unknown>;
}) {
  // 手动应用计划（IK6KQB）：请求防重入 Set + 业务错误到卡片可用性的本地覆盖
  // （权威态仍由 Snapshot/SSE 校准，覆盖只活到下次权威投影）。
  const [applyingPlanIds, setApplyingPlanIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [planAvailabilityOverrides, setPlanAvailabilityOverrides] = useState<
    ReadonlyMap<string, PlanAvailabilityOverride>
  >(() => new Map());

  // HTTP 成功只代表命令已接纳；收到权威 applied 投影后才结束等待态。
  useEffect(() => {
    // Snapshot/SSE props 是外部权威源：同步清掉对应本地等待项，避免陈旧 pending 累积。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApplyingPlanIds((current) => {
      let next: Set<string> | null = null;
      for (const message of messages) {
        if (
          message.type === "plan-card" &&
          message.appliedAt !== null &&
          current.has(String(message.planMessageId))
        ) {
          next ??= new Set(current);
          next.delete(String(message.planMessageId));
        }
      }
      return next ?? current;
    });
  }, [messages]);

  /**
   * 手动应用冻结计划（IK6KQB，契约 §9）：无二次确认，单击即发。
   * 请求期间 applyingPlanIds 防重入（重复点击不产生第二个请求）；
   * 不乐观置 applied——「已应用」只由权威 plan_message.applied 事件驱动。
   * 零写入失败恢复可操作：业务码映射到卡片可用性覆盖，其余错误仅记日志。
   */
  const handleApplyPlan = (
    msg: Extract<ChatMessage, { type: "plan-card" }>,
  ) => {
    if (!onApplyPlanMessage) return;
    const planKey = String(msg.planMessageId);
    if (applyingPlanIds.has(planKey)) return;
    setApplyingPlanIds((current) => new Set(current).add(planKey));
    // 新请求发起即清除上一轮错误覆盖（余额不足充值后重试等场景）
    setPlanAvailabilityOverrides((current) => {
      if (!current.has(planKey)) return current;
      const next = new Map(current);
      next.delete(planKey);
      return next;
    });
    void onApplyPlanMessage(msg.planMessageId).catch((error) => {
      const override = classifyPlanApplicationFailure(error)?.availability;
      if (override) {
        setPlanAvailabilityOverrides((current) =>
          new Map(current).set(planKey, override),
        );
      } else if (isApiError(error) && error.code === ALREADY_APPLIED) {
        // 已被应用：等权威 applied 事件/快照校准，不视为失败
        return;
      } else {
        console.error("[canvas] plan apply failed:", error);
      }
      setApplyingPlanIds((current) => {
        const next = new Set(current);
        next.delete(planKey);
        return next;
      });
    });
  };

  return { applyingPlanIds, planAvailabilityOverrides, handleApplyPlan };
}
