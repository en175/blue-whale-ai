export interface AgentHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** 本轮显式引用的受限投影（T08，IK67H3）：只含 available/stale 条目，
 *  unavailable 的内容不进入 runtime 上下文。core 不持有投影内部形状
 *  （契约权威在 contracts），故 projection 为不透明载荷。 */
export interface AgentMentionProjection {
  readonly mention_id: string;
  readonly type: "asset" | "scene_card";
  readonly availability: "available" | "stale";
  readonly projection: unknown;
}

export interface AgentRequest {
  readonly prompt: string;
  readonly historyMessages: readonly AgentHistoryMessage[];
  readonly runtimeInstructions: readonly string[];
  readonly creativeSkill: {
    readonly creativeSkillId: string;
    readonly creativeSkillVersionId: string;
    readonly name: string;
    readonly resourceDigest: string;
    readonly body: string;
  } | null;
  readonly mentionProjections: readonly AgentMentionProjection[];
}

export type AgentAlignmentStage = "alignment" | "awaiting_final_confirmation";

/** 计划应用类型（core 运行时形态，契约权威在 contracts PlanApplicationKind）。
 *  core 零 contracts 依赖，故等价字面量联合在此独立声明。 */
export type PlanApplicationKindCore =
  | "image_generate"
  | "scene_card_create"
  | "scene_card_replace";

/** 计划卡参数覆盖（core 运行时形态）：字段等价 contracts planGenerationParameterOverridesSchema。
 *  未指定项由 Product API 在 RunCommit 接纳时用能力默认补齐。 */
export interface PlanGenerationParameterOverridesCore {
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly format?: string | null;
  readonly duration?: number | null;
  readonly count?: number;
  readonly firstFrameMentionSeq?: number | null;
  readonly lastFrameMentionSeq?: number | null;
}

/** write_plan_cards 单卡候选（core 运行时形态）：字段等价 contracts planCardCandidateSchema。
 *  core 不做判别联合强校验——严格形状校验在 contracts 边界由 worker 重放载荷解析完成；
 *  scene_card_replace 的 target_scene_card_mention_id 由产卡方保证非空。
 *  base_scene_card_version 不在候选中——Agent 不自填，由 Product API 在 RunCommit
 *  接纳时从 mention.target_version 解析冻结（CONTEXT PlanMessage 权威约束）。 */
export interface PlanCardCandidateCore {
  readonly applicationKind: PlanApplicationKindCore;
  readonly title: string;
  readonly summary?: string | null;
  readonly contentMarkdown: string;
  readonly parameterOverrides?: PlanGenerationParameterOverridesCore;
  readonly sequenceLabelNoun?: string;
  readonly basePlanMessageId?: string;
  readonly sourcePlanMessageId?: string;
  readonly targetSceneCardMentionId?: string;
}

export type AgentAction =
  | { readonly kind: "respond" }
  | {
      readonly kind: "clarify";
      readonly question: string;
      readonly stage: AgentAlignmentStage;
    }
  | { readonly kind: "cancel" }
  | {
      readonly kind: "submit_plan";
      readonly cards: readonly PlanCardCandidateCore[];
    };

export interface AgentResult {
  readonly provider: string;
  readonly content: string;
  readonly reasoningSummary: string;
  readonly action: AgentAction;
}

export interface AgentAdapter {
  readonly name: string;
  ready(): Promise<boolean>;
  invoke(request: AgentRequest): Promise<AgentResult>;
}

export interface GenerationRequest {
  readonly prompt: string;
  readonly outputIndex: number;
}

export interface GenerationResult {
  readonly provider: string;
  readonly mediaType: string;
  readonly contentId: string;
  readonly uri: string;
}

export interface GenerationAdapter {
  readonly name: string;
  ready(): Promise<boolean>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
