/**
 * cardStatus —— card 状态机转移的纯函数（从 AgentChatPanel 重试流转剥离的可测逻辑）
 *
 * Card 的重试生命周期：failed → generating → normal。
 * 重试是单步推进：调用方拿到 next 后渲染，再用 next 排下一步直到 isTerminal。
 *
 * IJZYVQ ARCH-5：CardStatus 类型迁至 `@/types/domain`
 */
import type { CardStatus } from "@/types/domain";

/**
 * 重试的单步状态转移。返回下一态 + 是否终态。
 *
 * 不变量（来自 spec）：
 *   failed     → generating（过渡态，不能直接跳 normal）
 *   generating → normal（DEMO 固定成功，终态）
 *   normal     → 无转移（guard，正常态不应再走重试路径）
 */
export function nextRetryStatus(current: CardStatus): {
  next: CardStatus;
  isTerminal: boolean;
} {
  if (current === "failed") return { next: "generating", isTerminal: false };
  if (current === "generating") return { next: "normal", isTerminal: true };
  return { next: "normal", isTerminal: true };
}

/**
 * 后端 job status → CardStatus 映射。
 *
 * 后端状态机（GenerationJobService）：queued / processing / succeeded / failed。
 * 映射：queued/processing → generating（过渡态）；succeeded → normal（终态）；
 * failed → failed。未知状态保守当 generating（等下一轮轮询）。
 */
export function fromJobStatus(jobStatus: string): CardStatus {
  if (jobStatus === "succeeded") return "normal";
  if (jobStatus === "failed") return "failed";
  return "generating";
}
