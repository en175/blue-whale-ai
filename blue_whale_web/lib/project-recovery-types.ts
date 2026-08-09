// IK74V6：project recovery 的类型与派生视图纯函数（从 project-recovery.ts 下沉）。
import {
  compareWireIntegers as compareWireInteger,
  isWireInteger,
  type WireInteger,
} from "./wire-integer";

export type { WireInteger } from "./wire-integer";
export type ProjectSnapshot = {
  project: {
    id: WireInteger;
    name: string;
    thumb: string | null;
    created_at: string;
  };
  canvas: {
    id: WireInteger | null;
    project_id: WireInteger;
    version?: number | null;
    viewport: string | null;
    nodes: string | null;
  };
  conversation_messages: Array<Record<string, unknown>>;
  agent_runs: Array<Record<string, unknown>>;
  generation_jobs: Array<Record<string, unknown>>;
  /** 已创建的视频场景卡（IK67H9/T11，IK67HB/T13 编辑器入口）。可选仅为兼容历史测试 fixture，运行时后端总返回。 */
  scene_cards?: Array<Record<string, unknown>>;
  /** SceneCard 生成记录（IK67HB/T13）：generation origins/summaries。 */
  scene_card_generation_records?: Array<Record<string, unknown>>;
  /** StoryboardPreview 分镜预览（IK67HF/T15）：从 SceneCard 触发的可选旁路预览会话。 */
  storyboard_previews?: Array<Record<string, unknown>>;
  /** 冻结计划卡（IK6KQ2）：后端 T09/T10 投影的 plan_messages（含 applied_at / first_generation_job_id / application_availability）。可选仅为兼容历史测试 fixture，运行时后端总返回。 */
  plan_messages?: Array<Record<string, unknown>>;
  /** 计划应用回执（IK6KQ2，AC#1）：不可变事实收据；渲染以 plan_messages.applied_at 为权威，回执随快照透传供后续接线消费。可选同 plan_messages。 */
  plan_applications?: Array<Record<string, unknown>>;
  assets: Record<
    string,
    { asset_id: number | string; type: string; access_url: string }
  >;
  high_watermark_cursor: WireInteger;
};

export type ActiveInputRequest = {
  input_request_id: WireInteger;
  request_type: string;
  question: string | null;
  status: string;
  expires_at: string;
};

export type AgentRunDisplay = {
  agentRunId: WireInteger;
  status: string;
  stage: string | null;
  terminalReason: string | null;
  failureCode: string | null;
  retryCount: number;
  skillName: string | null;
  reasoningSummary: string | null;
};

/** 运行控制推导（IK67GZ，契约 §8.2/§8.3）：停止/重试可用性与「已停止生成」非消息状态。 */
export type AgentRunControl = {
  canStop: boolean;
  canRetry: boolean;
  stoppedByUser: boolean;
};

export function deriveRunControl(
  display: AgentRunDisplay | null,
): AgentRunControl {
  if (!display)
    return { canStop: false, canRetry: false, stoppedByUser: false };
  return {
    canStop: display.status === "queued" || display.status === "running",
    canRetry: display.status === "failed",
    stoppedByUser:
      display.status === "cancelled" &&
      display.terminalReason === "user_requested",
  };
}
/** 临时助手交付的短期活动投影（IK67GZ，契约 §8.1）：独立身份，永不进入正式消息。 */
export type ProvisionalDeliveryView = {
  deliveryId: string;
  agentRunId: string;
  content: string;
  status: "streaming" | "completed" | "interrupted";
};

export function deriveLatestAgentRunDisplay(
  snapshot: { agent_runs: Array<Record<string, unknown>> } | null,
): AgentRunDisplay | null {
  if (!snapshot) return null;
  let latest: Record<string, unknown> | null = null;
  for (const run of snapshot.agent_runs) {
    if (!isWireInteger(run.agent_run_id) || typeof run.status !== "string") {
      continue;
    }
    if (
      latest === null ||
      compareWireInteger(run.agent_run_id, latest.agent_run_id as WireInteger) >
        0
    ) {
      latest = run;
    }
  }
  if (!latest) return null;
  const activations = Array.isArray(latest.activated_creative_skill_versions)
    ? latest.activated_creative_skill_versions
    : [];
  const activation = activations[0];
  const skillName =
    activation &&
    typeof activation === "object" &&
    "name" in activation &&
    typeof activation.name === "string"
      ? activation.name
      : null;
  return {
    agentRunId: latest.agent_run_id as WireInteger,
    status: latest.status as string,
    stage: typeof latest.stage === "string" ? latest.stage : null,
    terminalReason:
      latest.terminal_reason === "user_requested" ||
      latest.terminal_reason === "runtime_error"
        ? latest.terminal_reason
        : null,
    failureCode:
      typeof latest.failure_code === "string" ? latest.failure_code : null,
    retryCount: typeof latest.retry_count === "number" ? latest.retry_count : 0,
    skillName,
    reasoningSummary:
      typeof latest.reasoning_summary === "string"
        ? latest.reasoning_summary
        : null,
  };
}

/**
 * 派生当前唯一可回答的创作澄清请求（AgentChatPanel Composer 下一次提交的回答绑定）。
 *
 * 只绑定 pending 状态的 creation_clarification：confirmed（已回答）、consumed（已消费）、
 * 过期或成本确认请求都不参与绑定。Snapshot 已按服务端认证限定当前 User/Project，
 * 同一创作流程任一时刻至多一个 pending 请求；防御性取最新创建者。
 */
export function deriveAnswerableClarification(
  snapshot: { agent_runs: Array<Record<string, unknown>> } | null,
  now: Date = new Date(),
): ActiveInputRequest | null {
  if (!snapshot) return null;
  let answerable: ActiveInputRequest | null = null;
  for (const run of snapshot.agent_runs) {
    const request = run.active_input_request;
    if (!request || typeof request !== "object") continue;
    const candidate = request as Record<string, unknown>;
    if (
      candidate.request_type !== "creation_clarification" ||
      candidate.status !== "pending" ||
      !isWireInteger(candidate.input_request_id) ||
      typeof candidate.expires_at !== "string" ||
      !(new Date(candidate.expires_at).getTime() > now.getTime())
    ) {
      continue;
    }
    if (
      answerable === null ||
      compareWireInteger(
        candidate.input_request_id,
        answerable.input_request_id,
      ) > 0
    ) {
      answerable = candidate as unknown as ActiveInputRequest;
    }
  }
  return answerable;
}

export type ProductEventEnvelope = {
  schema_version: number;
  event_id: string;
  event_type: string;
  cursor: WireInteger;
  project_id: WireInteger;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export type ProjectRecoveryState = {
  projectId: WireInteger;
  snapshot: ProjectSnapshot | null;
  lastCursor: WireInteger;
  seenEventIds: ReadonlySet<string>;
  aggregateVersions: ReadonlyMap<string, number>;
  deleted: boolean;
  /** 临时交付活动投影（IK67GZ，契约 §8.1/§8.6）：不来自 Snapshot，刷新后为空。 */
  provisionalDeliveries: ReadonlyMap<string, ProvisionalDeliveryView>;
  /** 合同不兼容（IK67HH T16，ADR-0016 §6）：一次 Snapshot 恢复后仍遇不兼容事件，停止订阅。 */
  incompatible: boolean;
};

export type ProjectRecoveryTransport = {
  recoverPlacements?(
    projectId: WireInteger,
    signal: AbortSignal,
  ): Promise<ProjectSnapshot["canvas"] | null>;
  loadSnapshot(
    projectId: WireInteger,
    signal: AbortSignal,
  ): Promise<ProjectSnapshot>;
  consumeEvents(
    projectId: WireInteger,
    after: WireInteger,
    signal: AbortSignal,
    onEvent: (event: ProductEventEnvelope) => void,
  ): Promise<void>;
};
