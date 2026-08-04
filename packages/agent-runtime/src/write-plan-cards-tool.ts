import { z } from "zod";

const planCardSchema = z
  .object({
    title: z.string().min(1).max(255),
    summary: z.string().nullable(),
    content_markdown: z.string().min(1),
  })
  .strict();

/** write_plan_cards 入参：候选计划卡片。T08 只登记工具表面 + 校验形状；
 *  T09（IK67H6）才实现 PlanMessage 原子接纳。 */
export const writePlanCardsToolInputSchema = z
  .object({ cards: z.array(planCardSchema).min(1).max(20) })
  .strict();

export type WritePlanCardsToolInput = z.infer<
  typeof writePlanCardsToolInputSchema
>;

/** write_plan_cards 出参（占位）：候选已校验并暂存计数，但尚未提升为 PlanMessage。 */
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
 * 执行 write_plan_cards（T08 占位）：校验候选卡片形状并暂存计数，
 * **不创建 PlanMessage**（AC#6 工具表面就位；PlanMessage 接纳是 T09 范围）。
 *
 * 返回 promoted=false 表示候选未被提升为正式计划消息。T09 将在此处接入
 * PlanMessage 的原子接纳与 advance 暂存。
 */
export async function executeWritePlanCardsTool(
  input: WritePlanCardsToolInput,
): Promise<WritePlanCardsToolOutcome> {
  // 形状已由 schema 校验；T08 不做持久化或 PlanMessage 提升。
  return {
    kind: "ok",
    staged_card_count: input.cards.length,
    promoted: false,
  };
}
