// IK74V8：AgentRunRepo 的入参/出参契约与仓储接口（从 agent-run-repo.ts 拆出）。
import type {
  AutoCreativeSkillActivation,
  MentionInputSnapshot,
  PlanCardCandidate,
  AgentRunWork as ContractAgentRunWork,
} from "@blue-whale/contracts";

export interface ClaimAgentRunInput {
  workerId: string;
  leaseMs: number;
}

export type AgentRunWork = ContractAgentRunWork & {
  conversationId: string;
  userId: string;
  /** 总结当前对话意图（IK60X1，契约 §15.2）：为真时 Worker 分流到总结管道。 */
  skillSummarize: boolean;
};

export interface CommitAgentRunSuccessInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  content: string;
  reasoningSummary: string;
  autoCreativeSkillActivation: AutoCreativeSkillActivation | null;
}

/** RunCommit completed_with_plan 入参（T09，IK67H6，契约 §9）：
 *  携带完整有序候选 plan_cards；RunCommit 对整批原子验证后接纳为不可变 PlanMessage。
 *  plan_cards 形状已由 contracts planCardCandidateSchema 强制（worker 侧重放校验）。 */
export interface CommitAgentRunPlanInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  reasoningSummary: string;
  planCards: readonly PlanCardCandidate[];
  capabilitySnapshotVersion: 1;
}

export interface RenewAgentRunLeaseInput {
  workerId: string;
  agentRunId: string;
  fence: string;
  runVersion: number;
  leaseMs: number;
}

export interface CommitAgentRunFailureInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  failureCode: string;
  failureMessage: string;
}

export interface CommitAgentRunAwaitingInputInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  content: string;
  reasoningSummary: string;
  question: string;
  stage: "alignment" | "awaiting_final_confirmation";
}

export interface CommitAgentRunCancelledInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  content: string;
  reasoningSummary: string;
}

export interface AppendProvisionalChunksInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  chunks: string[];
}

export type AppendProvisionalChunksResult =
  | { kind: "appended"; deliveryId: string; startIndex: number }
  | { kind: "conflict" };

export interface AcceptAgentRunCommandInput {
  userId: string;
  projectId: string;
  agentRunId: string;
  idempotencyKey: string;
  requestHash: string;
}

export type AcceptAgentRunStopResult =
  | { kind: "stopped" | "replayed"; cursor: string; status: "cancelled" }
  | {
      kind:
        | "not_found"
        | "idempotency_conflict"
        | "already_terminal"
        | "not_stoppable";
    };

export type AcceptAgentRunRetryResult =
  | {
      kind: "retried" | "replayed";
      cursor: string;
      status: "queued";
      retryCount: number;
    }
  | { kind: "not_found" | "idempotency_conflict" | "not_retryable" };

export interface ProviderCallRecord {
  id: string;
  agentRunId: string;
  advanceId: string;
  callSlot: number;
  fencingToken: string;
  status: string;
  requestDigest: string;
  resultPayload: unknown;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface OpenProviderCallInput {
  agentRunId: string;
  advanceId: string;
  callSlot: number;
  fence: string;
  requestDigest: string;
}

export interface SettleProviderCallInput {
  advanceId: string;
  callSlot: number;
  fence: string;
  status: "succeeded" | "failed_definitive" | "outcome_unknown";
  resultPayload?: unknown;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export type CommitAgentRunStatus =
  | "queued"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type CommitAgentRunResult =
  | {
      kind: "committed";
      cursor: string;
      status: CommitAgentRunStatus;
    }
  | {
      kind: "replayed";
      cursor: string;
      status: CommitAgentRunStatus;
    }
  | { kind: "conflict" };

export interface AgentRunRepo {
  claimNext(input: ClaimAgentRunInput): Promise<AgentRunWork | null>;
  renewLease(input: RenewAgentRunLeaseInput): Promise<boolean>;
  /** 硬权限闸门实时重查（T08，AC#5）：按快照条目用**当前事实**重跑可用性谓词。
   *  快照内容保持冻结不变（AC#1/#2），只裁决放行/拦截——冻结后的删除或撤权
   *  在此被检出，接管复用窗口不扩大授权。 */
  recheckMentionAuthority(input: {
    agentRunId: string;
    snapshot: MentionInputSnapshot;
  }): Promise<{ authoritative: boolean }>;
  commitSuccess(
    input: CommitAgentRunSuccessInput,
  ): Promise<CommitAgentRunResult>;
  /** 原子接纳计划卡候选为不可变 PlanMessage（T09，契约 §9，AC#1-8）。
   *  验证（结构 / 引用当前可用 / replace 独占 / 参数 ∈ 能力枚举）在 CAS 锁后、
   *  任何 conversation_messages / plan_messages 写入前；任一失败走 failed commit，零 plan 行。 */
  commitPlanMessages(
    input: CommitAgentRunPlanInput,
  ): Promise<CommitAgentRunResult>;
  commitFailure(
    input: CommitAgentRunFailureInput,
  ): Promise<CommitAgentRunResult>;
  commitAwaitingInput(
    input: CommitAgentRunAwaitingInputInput,
  ): Promise<CommitAgentRunResult>;
  commitCancelled(
    input: CommitAgentRunCancelledInput,
  ): Promise<CommitAgentRunResult>;
  appendProvisionalChunks(
    input: AppendProvisionalChunksInput,
  ): Promise<AppendProvisionalChunksResult>;
  acceptUserStop(
    input: AcceptAgentRunCommandInput,
  ): Promise<AcceptAgentRunStopResult>;
  acceptUserRetry(
    input: AcceptAgentRunCommandInput,
  ): Promise<AcceptAgentRunRetryResult>;
  loadProviderCall(
    advanceId: string,
    callSlot: number,
  ): Promise<ProviderCallRecord | null>;
  openProviderCall(input: OpenProviderCallInput): Promise<ProviderCallRecord>;
  settleProviderCall(input: SettleProviderCallInput): Promise<boolean>;
  markProviderCallOutcomeUnknown(
    advanceId: string,
    callSlot: number,
  ): Promise<boolean>;
}
