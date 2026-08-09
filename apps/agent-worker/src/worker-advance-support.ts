// IK74V8：从 worker-loop.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// Advance 执行支撑：槽位常量、控制流错误、mention 闸门、分块与重放解析。
import type { AgentAction, PlanCardCandidateCore, PlanGenerationParameterOverridesCore } from "@blue-whale/core";
import {
  autoCreativeSkillActivationSchema,
  planCardCandidateSchema,
  type PlanCardCandidate,
  type PlanGenerationParameterOverrides,
  type AutoCreativeSkillActivation,
} from "@blue-whale/contracts";
import type {
  AgentRunRepo,
  AgentRunWork,
} from "@blue-whale/persistence";
import { commitDigest } from "./worker-run-pin.js";

export const PROVIDER_CALL_SLOT = 0;
/** 验收标记（契约 §8.5）：结果落库后、RunCommit 前睡眠 N ms，构造可接管窗口。 */
export const HOLD_RESULT_MARKER = /fake:hold-result:(\d+)/;
/** 临时交付分片长度：把完整结果切成小片按序上报（契约 §8.1）。 */
export const PROVISIONAL_CHUNK_SIZE = 16;

export class ProviderOutcomeUnknownError extends Error {
  constructor() {
    super("provider_outcome_unknown");
  }
}

/** MentionInputSnapshot 非权威（T08，AC#5）：实时重查发现本轮存在已删除或
 *  已撤权的显式引用，不得产生任何外部副作用。三闸门统一抛此错误。 */
export class SnapshotNotAuthoritativeError extends Error {
  constructor() {
    super("mention_input_unavailable");
  }
}

/** 硬权限闸门（T08，AC#5）：每次经过都用**当前事实**重查快照条目授权。
 *  快照内容冻结不变（AC#1）、接管复用同一快照（AC#2），但冻结后的删除/撤权
 *  会在此被拦截——provider/replay 闸门抛错（在 try 内被捕获）；RunCommit 闸门
 *  直接返回 commitFailure（已过 try/catch，避免未捕获异常触发重试循环）。 */
export async function assertMentionAuthority(
  repo: AgentRunRepo,
  work: AgentRunWork,
): Promise<void> {
  const checked = await repo.recheckMentionAuthority({
    agentRunId: work.agent_run_id,
    snapshot: work.mention_input_snapshot,
  });
  if (!checked.authoritative) throw new SnapshotNotAuthoritativeError();
}

/** mention 不可用的失败提交载荷（T08，AC#5）：三闸门共用。 */
export function mentionUnavailableFailure(workerId: string, work: AgentRunWork) {
  return {
    workerId,
    agentRunId: work.agent_run_id,
    advanceId: work.advance_id,
    fence: work.fencing_token,
    runVersion: work.run_version,
    requestDigest: commitDigest({
      outcome: "failed",
      code: "mention_input_unavailable",
      message: "mention input snapshot is not authoritative",
    }),
    failureCode: "mention_input_unavailable",
    failureMessage: "a referenced mention is unavailable; result not accepted",
  };
}

export class ReplayedProviderFailureError extends Error {
  readonly failureCode: string;
  constructor(failureCode: string, failureMessage: string) {
    super(failureMessage);
    this.failureCode = failureCode;
  }
}

export interface ProducedResult {
  content: string;
  reasoningSummary: string;
  autoActivation: AutoCreativeSkillActivation | null;
  action: AgentAction;
  /** 计划卡候选（contracts 线缆形态）；仅 action.kind === "submit_plan" 时非 null。
   *  Worker 边界从 core camelCase 转换一次，供 result_payload 重放校验与 commitPlanMessages。 */
  planCards: PlanCardCandidate[] | null;
}

export function chunkContent(content: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += PROVISIONAL_CHUNK_SIZE) {
    chunks.push(content.slice(index, index + PROVISIONAL_CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : [""];
}

/** core 计划卡（camelCase 运行时形态）→ contracts 计划卡（snake_case 线缆形态）。
 *  Worker 边界做唯一一次转换；转换后立刻由 planCardCandidateSchema 校验，
 *  失败视为适配器产出了非法候选（不可重放，进入 outcome_unknown）。 */
export function coreOverridesToContract(
  overrides: PlanGenerationParameterOverridesCore,
): PlanGenerationParameterOverrides {
  const out: Record<string, unknown> = {};
  if (overrides.size !== undefined) out.size = overrides.size;
  if (overrides.aspectRatio !== undefined) out.aspect_ratio = overrides.aspectRatio;
  if (overrides.format !== undefined) out.format = overrides.format;
  if (overrides.duration !== undefined) out.duration = overrides.duration;
  if (overrides.count !== undefined) out.count = overrides.count;
  if (overrides.firstFrameMentionSeq !== undefined)
    out.first_frame_mention_seq = overrides.firstFrameMentionSeq;
  if (overrides.lastFrameMentionSeq !== undefined)
    out.last_frame_mention_seq = overrides.lastFrameMentionSeq;
  return out as PlanGenerationParameterOverrides;
}

export function corePlanCardsToContract(
  cards: readonly PlanCardCandidateCore[],
): PlanCardCandidate[] {
  return cards.map((card) => {
    const out: Record<string, unknown> = {
      application_kind: card.applicationKind,
      title: card.title,
      content_markdown: card.contentMarkdown,
    };
    if (card.summary !== undefined) out.summary = card.summary;
    if (card.parameterOverrides !== undefined) {
      out.parameter_overrides = coreOverridesToContract(card.parameterOverrides);
    }
    if (card.sequenceLabelNoun !== undefined)
      out.sequence_label_noun = card.sequenceLabelNoun;
    if (card.basePlanMessageId !== undefined)
      out.base_plan_message_id = card.basePlanMessageId;
    if (card.sourcePlanMessageId !== undefined)
      out.source_plan_message_id = card.sourcePlanMessageId;
    if (
      card.applicationKind === "scene_card_replace" &&
      card.targetSceneCardMentionId !== undefined
    ) {
      out.target_scene_card_mention_id = card.targetSceneCardMentionId;
    }
    return out as PlanCardCandidate;
  });
}

export function parseReplayedAction(value: unknown): AgentAction | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "respond") return { kind: "respond" };
  if (candidate.kind === "cancel") return { kind: "cancel" };
  if (candidate.kind === "submit_plan") {
    // 真实候选在 result_payload.plan_cards（契约校验）；action 只承载 kind。
    return { kind: "submit_plan", cards: [] };
  }
  if (
    candidate.kind === "clarify" &&
    typeof candidate.question === "string" &&
    candidate.question.length > 0 &&
    (candidate.stage === "alignment" ||
      candidate.stage === "awaiting_final_confirmation")
  ) {
    return { kind: "clarify", question: candidate.question, stage: candidate.stage };
  }
  return null;
}

/** 重放载荷校验（契约 §8.4）：形状不完整视为不可重放，进入结果不明路径。 */
export function parseReplayedProviderResult(payload: unknown): ProducedResult | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.content !== "string" ||
    candidate.content.length === 0 ||
    typeof candidate.reasoning_summary !== "string"
  ) {
    return null;
  }
  const action = parseReplayedAction(candidate.action);
  if (!action) return null;
  let autoActivation: AutoCreativeSkillActivation | null = null;
  if (candidate.auto_activation !== null && candidate.auto_activation !== undefined) {
    const parsed = autoCreativeSkillActivationSchema.safeParse(
      candidate.auto_activation,
    );
    if (!parsed.success) return null;
    autoActivation = parsed.data;
  }
  // 接管重放 submit_plan（契约 §8.4）：plan_cards 必须由契约 schema 校验通过，
  // 否则视为不可重放 → outcome_unknown → failed（不把幻觉/残缺候选交给 RunCommit）。
  let planCards: PlanCardCandidate[] | null = null;
  if (action.kind === "submit_plan") {
    const parsedCards = planCardCandidateSchema
      .array()
      .min(1)
      .safeParse(candidate.plan_cards);
    if (!parsedCards.success) return null;
    planCards = parsedCards.data;
  }
  return {
    content: candidate.content,
    reasoningSummary: candidate.reasoning_summary,
    autoActivation,
    action,
    planCards,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 调用记录驱动的推进执行（契约 §8.4）：
 *  succeeded → 重放不再调用；failed_definitive → 重放失败；
 *  in_flight/outcome_unknown → 置未知并失败（手动重试）；无记录 → 开记录、调用、结算。 */
