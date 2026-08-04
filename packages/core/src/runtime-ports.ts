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

export type AgentAction =
  | { readonly kind: "respond" }
  | {
      readonly kind: "clarify";
      readonly question: string;
      readonly stage: AgentAlignmentStage;
    }
  | { readonly kind: "cancel" };

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
