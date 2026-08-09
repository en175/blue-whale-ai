// IK74V8：计划应用的入参/出参契约与仓储接口（从 plan-application-repo.ts 拆出）。
import type {
  PlanApplicationKind,
  PlanApplyImageReceipt,
} from "@blue-whale/contracts";

export interface ApplyPlanMessageInput {
  userId: string;
  projectId: string;
  planMessageId: string;
  idempotencyKey: string;
  requestHash: string;
  providerCredential?: string;
  quotaCheck?: () => Promise<{ sufficient: boolean }>;
}

export type ApplyPlanMessageResult =
  // —— 视频分支（scene_card_create T11 / scene_card_replace T12）——
  | {
      kind: "applied";
      application_kind: PlanApplicationKind;
      scene_card_id: string;
      generation_job_id: string;
      receipt_id: string;
      cursor: string;
    }
  | {
      kind: "replayed";
      application_kind: PlanApplicationKind;
      scene_card_id: string;
      generation_job_id: string;
    }
  | { kind: "idempotency_conflict" }
  | { kind: "already_applied" }
  | { kind: "plan_not_found" }
  | { kind: "kind_unsupported" }
  | { kind: "capability_drift" }
  | { kind: "validation_failed"; reason: string }
  | { kind: "forbidden" }
  // —— 覆盖分支（scene_card_replace，T12）：目标场景卡已变化（版本/删除/越权），需生成新计划 ——
  | { kind: "target_stale"; reason: string | null }
  // —— 图片分支（image_generate，T10）——
  | {
      kind: "applied_image";
      receipt: PlanApplyImageReceipt;
      first_generation_job_id: string;
      cursor: string;
    }
  | {
      kind: "replayed_image";
      receipt: PlanApplyImageReceipt;
      first_generation_job_id: string;
      cursor: string;
    }
  | {
      kind: "already_applied_image";
      receipt: PlanApplyImageReceipt;
      first_generation_job_id: string;
    }
  | {
      kind: "blocked_requires_new_plan";
      reason: string;
      blockedBy: "mention_unavailable" | "capability_drifted";
    }
  | { kind: "blocked_retryable"; reason: string };

export interface PlanApplicationRepo {
  /** 手动应用 PlanMessage：按 application_kind 分派视频（T11）/图片（T10）事务。 */
  applyPlanMessage(
    input: ApplyPlanMessageInput,
  ): Promise<ApplyPlanMessageResult>;
}

export interface CapabilitySnapshot {
  schema_version: number;
  capability_type: string;
  model_id: string;
  provider_id: string;
  row_version: number;
  digest: string;
}

export interface DerivedReference {
  mention_id: string;
  mention_seq: number;
  type: "asset" | "scene_card";
  first_seen_offset: number;
}
