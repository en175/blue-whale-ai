import { planCardCandidateSchema } from "@blue-whale/contracts";
import { z } from "zod";

/** write_plan_cards 入参：候选计划卡片。每卡 application_kind 必填，形状由 contracts
 *  planCardCandidateSchema 强制（scene_card_replace 必带 target 句柄）。
 *  工具只校验候选，**不创建 PlanMessage**——正式接纳由 RunCommit completed_with_plan
 *  原子完成（契约 §9：工具只校验、RunCommit 接纳）。 */
export const writePlanCardsToolInputSchema = z
  .object({ cards: z.array(planCardCandidateSchema).min(1).max(20) })
  .strict();

export type WritePlanCardsToolInput = z.infer<
  typeof writePlanCardsToolInputSchema
>;

/** write_plan_cards 出参：候选已通过形状校验的计数，但尚未提升为 PlanMessage。 */
export const writePlanCardsToolResultSchema = z
  .object({
    staged_card_count: z.number().int().nonnegative(),
    promoted: z.literal(false),
  })
  .strict();

export type WritePlanCardsToolResult = z.infer<
  typeof writePlanCardsToolResultSchema
>;

export type WritePlanCardsRejectionReason =
  | "invalid_cards"
  | "plan_message_not_enabled";

export type WritePlanCardsToolOutcome =
  | ({ kind: "ok" } & WritePlanCardsToolResult)
  | { kind: "rejected"; reason: WritePlanCardsRejectionReason };

/** write_plan_cards 工具定义（注册到 TOOL_REGISTRY，version 1）。 */
export const WRITE_PLAN_CARDS_TOOL = {
  tool_id: "write_plan_cards",
  registry_version: 1,
  inputSchema: writePlanCardsToolInputSchema,
  outputSchema: writePlanCardsToolResultSchema,
} as const;

/**
 * 执行 write_plan_cards：校验候选卡片形状并返回计数（无持久化）。
 * **不创建 PlanMessage**（AC#1 工具不直接创建正式消息）。
 *
 * 返回 promoted=false 表示候选未被提升为正式计划消息；正式接纳在 RunCommit
 * completed_with_plan 路径由 Product API 原子完成（T09）。
 */
export async function executeWritePlanCardsTool(
  input: WritePlanCardsToolInput,
): Promise<WritePlanCardsToolOutcome> {
  // 形状已由 schema 校验；工具不持久化或提升 PlanMessage。
  return {
    kind: "ok",
    staged_card_count: input.cards.length,
    promoted: false,
  };
}
