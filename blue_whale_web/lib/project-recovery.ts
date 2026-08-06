import { apiFetch } from "./api-client";
import type { CanvasRepo, CanvasView } from "@blue-whale/persistence";
import {
  recoverPendingPlacements,
  type PendingOutputPlacement,
} from "./conversation/scene-card-placement";
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

const MAX_SEEN_EVENT_IDS = 1_000;

export class CursorExpiredError extends Error {
  constructor() {
    super("Project SSE cursor expired");
    this.name = "CursorExpiredError";
  }
}

export function initialProjectRecoveryState(
  projectId: WireInteger,
): ProjectRecoveryState {
  return {
    projectId,
    snapshot: null,
    lastCursor: 0,
    seenEventIds: new Set(),
    aggregateVersions: new Map(),
    deleted: false,
    provisionalDeliveries: new Map(),
  };
}

export function applySnapshot(
  state: ProjectRecoveryState,
  snapshot: ProjectSnapshot,
): ProjectRecoveryState {
  if (compareWireInteger(snapshot.project.id, state.projectId) !== 0) {
    throw new Error("Snapshot does not belong to the requested Project");
  }
  return {
    ...state,
    snapshot,
    lastCursor: snapshot.high_watermark_cursor,
    seenEventIds: new Set(),
    aggregateVersions: new Map(),
    deleted: false,
    // Snapshot 不含临时文本（契约 §8.6）：恢复即清除活动投影。
    provisionalDeliveries: new Map(),
  };
}

export function applyProductEvent(
  state: ProjectRecoveryState,
  event: ProductEventEnvelope,
): ProjectRecoveryState {
  if (
    String(event.project_id) !== String(state.projectId) ||
    compareWireInteger(event.cursor, state.lastCursor) <= 0
  ) {
    return state;
  }

  const seenEventIds = rememberEvent(state.seenEventIds, event.event_id);
  if (state.seenEventIds.has(event.event_id)) {
    return { ...state, lastCursor: event.cursor, seenEventIds };
  }

  const aggregateKey = `${event.aggregate_type}:${event.aggregate_id}`;
  const previousVersion = state.aggregateVersions.get(aggregateKey) ?? -1;
  // 只拒绝「严格更旧」的状态；同一聚合允许同版本连续事件。
  // 后端对部分事实事件（如 agent_run.user_input_requested/user_input_answered）不递增
  // 聚合版本，它们与前一条 status_changed 同版本；若用 <= 会把这些事件误判为旧状态丢弃，
  // 导致前端看不到 pending 澄清请求、回答无法绑定原 AgentRun（IK1NS2 实测复现）。
  if (event.aggregate_version < previousVersion) {
    return { ...state, lastCursor: event.cursor, seenEventIds };
  }

  const aggregateVersions = new Map(state.aggregateVersions);
  aggregateVersions.set(aggregateKey, event.aggregate_version);
  let snapshot = state.snapshot;
  let deleted = state.deleted;
  const provisionalDeliveries: Map<string, ProvisionalDeliveryView> = new Map(
    state.provisionalDeliveries,
  );

  // 临时交付事件（IK67GZ，契约 §8.1）：只更新短期活动投影，永不并入正式消息。
  if (event.event_type === "agent_run.provisional_delivery_started") {
    const view = toProvisionalStart(event.payload);
    if (view) {
      provisionalDeliveries.set(view.deliveryId, view);
    }
  } else if (event.event_type === "agent_run.provisional_chunk_appended") {
    const deliveryId = event.payload.delivery_id;
    const content = event.payload.content;
    if (
      (typeof deliveryId === "number" || typeof deliveryId === "string") &&
      typeof content === "string"
    ) {
      const key = String(deliveryId);
      const current = provisionalDeliveries.get(key);
      if (current && current.status === "streaming") {
        provisionalDeliveries.set(key, {
          ...current,
          content: current.content + content,
        });
      }
    }
  } else if (
    event.event_type === "agent_run.provisional_delivery_completed" ||
    event.event_type === "agent_run.provisional_delivery_interrupted"
  ) {
    const deliveryId = event.payload.delivery_id;
    if (typeof deliveryId === "number" || typeof deliveryId === "string") {
      provisionalDeliveries.delete(String(deliveryId));
    }
  } else if (snapshot) {
    if (
      event.event_type === "project.renamed" &&
      typeof event.payload.name === "string"
    ) {
      snapshot = {
        ...snapshot,
        project: { ...snapshot.project, name: event.payload.name },
      };
    } else if (event.event_type === "project.deleted") {
      deleted = true;
    } else if (event.event_type === "canvas.updated") {
      snapshot = {
        ...snapshot,
        canvas: {
          ...snapshot.canvas,
          viewport: stringOrNull(
            event.payload.viewport,
            snapshot.canvas.viewport,
          ),
          nodes: stringOrNull(event.payload.nodes, snapshot.canvas.nodes),
        },
      };
    } else if (
      event.event_type === "generation_job.created" ||
      event.event_type === "generation_job.status_changed"
    ) {
      snapshot = {
        ...snapshot,
        generation_jobs: applyGenerationJobEvent(
          snapshot.generation_jobs,
          event.payload,
        ),
      };
    } else if (event.event_type === "asset.created") {
      snapshot = {
        ...snapshot,
        assets: applyAssetEvent(snapshot.assets, event.payload),
      };
    } else if (
      event.event_type === "generation_job.output_attached" ||
      event.event_type === "generation_job.output_updated"
    ) {
      snapshot = {
        ...snapshot,
        generation_jobs: applyGenerationJobOutputEvent(
          snapshot.generation_jobs,
          event.payload,
        ),
      };
    } else if (event.event_type === "scene_card.preset_updated") {
      // IK67HB/T13：Preset version+1（SceneCard 自身版本不变），合并 payload 供编辑器冲突检测。
      snapshot = {
        ...snapshot,
        scene_cards: upsertFact(
          snapshot.scene_cards ?? [],
          event.payload,
          "scene_card_id",
        ),
      };
    } else if (
      event.event_type === "scene_card_generation_record.created" ||
      event.event_type === "scene_card_generation_record.summary_changed"
    ) {
      // IK67HB/T13：新生成记录并入列表（first_generation_job_id + 来源 PlanMessage）。
      snapshot = {
        ...snapshot,
        scene_card_generation_records: upsertFact(
          snapshot.scene_card_generation_records ?? [],
          event.payload,
          "record_id",
        ),
      };
    } else if (
      event.event_type === "conversation.message_accepted" ||
      event.event_type === "conversation.message_started" ||
      event.event_type === "conversation.message_chunk_appended" ||
      event.event_type === "conversation.message_completed"
    ) {
      snapshot = {
        ...snapshot,
        conversation_messages: upsertConversationMessage(
          snapshot.conversation_messages,
          event.payload,
        ),
      };
    } else if (
      event.event_type === "agent_run.created" ||
      event.event_type === "agent_run.status_changed"
    ) {
      snapshot = {
        ...snapshot,
        agent_runs: upsertFact(
          snapshot.agent_runs,
          event.payload,
          "agent_run_id",
        ),
      };
    } else if (event.event_type === "agent_run.user_input_requested") {
      snapshot = {
        ...snapshot,
        agent_runs: applyUserInputRequestedEvent(
          snapshot.agent_runs,
          event.payload,
        ),
      };
    } else if (event.event_type === "agent_run.user_input_answered") {
      snapshot = {
        ...snapshot,
        agent_runs: applyUserInputAnsweredEvent(
          snapshot.agent_runs,
          event.payload,
        ),
      };
    }
  }

  return {
    ...state,
    snapshot,
    lastCursor: event.cursor,
    seenEventIds,
    aggregateVersions,
    deleted,
    provisionalDeliveries,
  };
}

function toProvisionalStart(
  payload: Record<string, unknown>,
): ProvisionalDeliveryView | null {
  const deliveryId = payload.delivery_id;
  const agentRunId = payload.agent_run_id;
  if (
    (typeof deliveryId !== "number" && typeof deliveryId !== "string") ||
    (typeof agentRunId !== "number" && typeof agentRunId !== "string")
  ) {
    return null;
  }
  return {
    deliveryId: String(deliveryId),
    agentRunId: String(agentRunId),
    content: "",
    status: "streaming",
  };
}

function upsertConversationMessage(
  messages: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const messageId = payload.message_id;
  const streamId = payload.stream_id;
  const hasMessageId =
    typeof messageId === "number" || typeof messageId === "string";
  const hasStreamId =
    typeof streamId === "number" || typeof streamId === "string";
  if (!hasMessageId && !hasStreamId) return messages;

  const index = messages.findIndex(
    (message) =>
      (hasMessageId && String(message.message_id) === String(messageId)) ||
      (hasStreamId && String(message.stream_id) === String(streamId)),
  );
  if (index < 0) return [...messages, { ...payload }];
  return messages.map((message, current) =>
    current === index ? { ...message, ...payload } : message,
  );
}

function applyAssetEvent(
  assets: ProjectSnapshot["assets"],
  payload: Record<string, unknown>,
): ProjectSnapshot["assets"] {
  const assetId = payload.asset_id;
  if (
    (typeof assetId !== "number" && typeof assetId !== "string") ||
    typeof payload.type !== "string" ||
    typeof payload.access_url !== "string"
  ) {
    return assets;
  }
  const identity = String(assetId);
  return {
    ...assets,
    [identity]: {
      ...assets[identity],
      asset_id: assetId,
      type: payload.type,
      access_url: payload.access_url,
    },
  };
}

function applyGenerationJobOutputEvent(
  jobs: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const jobId = payload.job_id;
  const slotIndex = payload.slot_index;
  const assetId = payload.asset_id;
  if (
    (typeof jobId !== "number" && typeof jobId !== "string") ||
    typeof slotIndex !== "number" ||
    (assetId !== null &&
      assetId !== undefined &&
      typeof assetId !== "number" &&
      typeof assetId !== "string")
  ) {
    return jobs;
  }
  const index = jobs.findIndex((job) => String(job.job_id) === String(jobId));
  const current = index < 0 ? { job_id: jobId } : jobs[index];
  const slotsSource = Array.isArray(current.output_slots)
    ? current.output_slots
    : Array.isArray(current.outputs)
      ? current.outputs
      : [];
  const outputSlots = slotsSource.filter(
    (output): output is Record<string, unknown> =>
      !!output && typeof output === "object",
  );
  const outputIndex = outputSlots.findIndex(
    (output) => output.slot_index === slotIndex,
  );
  const previousOutput = outputIndex < 0 ? {} : outputSlots[outputIndex];
  const nextOutput = {
    ...previousOutput,
    slot_index: slotIndex,
    ...(typeof payload.slot_id === "number" ||
    typeof payload.slot_id === "string"
      ? { slot_id: payload.slot_id }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "status") &&
    typeof payload.status === "string"
      ? { status: payload.status }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "asset_id")
      ? { asset_id: assetId ?? null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(payload, "error") &&
    (payload.error === null ||
      (!!payload.error && typeof payload.error === "object"))
      ? { error: payload.error }
      : {}),
    ...(payload.retry_of_slot_id === null ||
    typeof payload.retry_of_slot_id === "number" ||
    typeof payload.retry_of_slot_id === "string"
      ? { retry_of_slot_id: payload.retry_of_slot_id }
      : {}),
    ...(payload.initial_placement_status === "pending" ||
    payload.initial_placement_status === "placed"
      ? { initial_placement_status: payload.initial_placement_status }
      : {}),
  };
  const nextOutputs =
    outputIndex < 0
      ? [...outputSlots, nextOutput].sort(
          (left, right) =>
            Number(left.slot_index ?? 0) - Number(right.slot_index ?? 0),
        )
      : outputSlots.map((output, currentIndex) =>
          currentIndex === outputIndex ? nextOutput : output,
        );
  const { outputs: legacyOutputs, ...canonicalJob } = current;
  void legacyOutputs;
  const nextJob = { ...canonicalJob, output_slots: nextOutputs };
  if (index < 0) return [...jobs, nextJob];
  return jobs.map((job, currentIndex) =>
    currentIndex === index ? nextJob : job,
  );
}

function applyUserInputRequestedEvent(
  runs: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const runId = payload.agent_run_id;
  if (
    (typeof runId !== "number" && typeof runId !== "string") ||
    !isWireInteger(payload.input_request_id)
  ) {
    return runs;
  }
  const activeInputRequest: Record<string, unknown> = {
    input_request_id: payload.input_request_id,
    request_type: payload.request_type,
    question: typeof payload.question === "string" ? payload.question : null,
    status: payload.status,
    expires_at: payload.expires_at,
  };
  const index = runs.findIndex(
    (run) => String(run.agent_run_id) === String(runId),
  );
  if (index < 0) {
    return [
      ...runs,
      { agent_run_id: runId, active_input_request: activeInputRequest },
    ];
  }
  return runs.map((run, current) =>
    current === index
      ? { ...run, active_input_request: activeInputRequest }
      : run,
  );
}

function applyUserInputAnsweredEvent(
  runs: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const requestId = payload.input_request_id;
  if (!isWireInteger(requestId)) return runs;
  const status =
    typeof payload.status === "string" ? payload.status : "confirmed";
  return runs.map((run) => {
    const active = run.active_input_request;
    if (!active || typeof active !== "object") return run;
    const current = active as Record<string, unknown>;
    if (String(current.input_request_id) !== String(requestId)) return run;
    return { ...run, active_input_request: { ...current, status } };
  });
}

function upsertFact(
  facts: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
  identityKey: string,
): Array<Record<string, unknown>> {
  const identity = payload[identityKey];
  if (typeof identity !== "number" && typeof identity !== "string") {
    return facts;
  }
  const index = facts.findIndex(
    (fact) => String(fact[identityKey]) === String(identity),
  );
  if (index < 0) return [...facts, { ...payload }];
  return facts.map((fact, current) =>
    current === index ? { ...fact, ...payload } : fact,
  );
}

function applyGenerationJobEvent(
  jobs: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const jobId = payload.job_id;
  if (typeof jobId !== "number" && typeof jobId !== "string") return jobs;
  const index = jobs.findIndex((job) => String(job.job_id) === String(jobId));
  if (index < 0) return [...jobs, { ...payload }];
  return jobs.map((job, current) =>
    current === index ? { ...job, ...payload } : job,
  );
}

function rememberEvent(
  current: ReadonlySet<string>,
  eventId: string,
): ReadonlySet<string> {
  const next = new Set(current);
  next.add(eventId);
  while (next.size > MAX_SEEN_EVENT_IDS) {
    const oldest = next.values().next().value as string | undefined;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

function stringOrNull(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" || value === null ? value : fallback;
}

export async function consumeProjectEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ProductEventEnvelope) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = drainSseFrames(buffer, onEvent);
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function drainSseFrames(
  input: string,
  onEvent: (event: ProductEventEnvelope) => void,
): string {
  let buffer = input;
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(buffer);
    if (!boundary || boundary.index === undefined) return buffer;
    const frame = buffer.slice(0, boundary.index);
    buffer = buffer.slice(boundary.index + boundary[0].length);
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    onEvent(parseProductEvent(data));
  }
}

function parseProductEvent(data: string): ProductEventEnvelope {
  const value: unknown = JSON.parse(data);
  if (!isProductEventEnvelope(value)) {
    throw new Error("Invalid Project SSE event envelope");
  }
  return value;
}

function isProductEventEnvelope(value: unknown): value is ProductEventEnvelope {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    event.schema_version === 1 &&
    typeof event.event_id === "string" &&
    typeof event.event_type === "string" &&
    isWireInteger(event.cursor) &&
    isWireInteger(event.project_id) &&
    typeof event.aggregate_type === "string" &&
    typeof event.aggregate_id === "string" &&
    typeof event.aggregate_version === "number" &&
    typeof event.occurred_at === "string" &&
    !!event.payload &&
    typeof event.payload === "object"
  );
}

export async function runProjectRecovery(
  projectId: WireInteger,
  transport: ProjectRecoveryTransport,
  onState: (state: ProjectRecoveryState) => void,
  signal: AbortSignal,
  retryDelayMs = 1_000,
): Promise<void> {
  let state = initialProjectRecoveryState(projectId);
  let needsSnapshot = true;
  let retryAttempt = 0;

  while (!signal.aborted) {
    try {
      if (needsSnapshot) {
        await transport
          .recoverPlacements?.(projectId, signal)
          .catch(() => undefined);
        state = applySnapshot(
          state,
          await transport.loadSnapshot(projectId, signal),
        );
        onState(state);
        needsSnapshot = false;
      }
      await transport.consumeEvents(
        projectId,
        state.lastCursor,
        signal,
        (event) => {
          if (
            event.event_type === "generation_job.output_attached" ||
            event.event_type === "generation_job.output_updated"
          ) {
            void transport
              .recoverPlacements?.(projectId, signal)
              .then((canvas) => {
                if (!canvas || signal.aborted || !state.snapshot) return;
                const recoveredVersion = canvas.version ?? -1;
                const currentVersion = state.snapshot.canvas.version ?? -1;
                if (recoveredVersion <= currentVersion) {
                  return;
                }
                state = {
                  ...state,
                  snapshot: { ...state.snapshot, canvas },
                };
                onState(state);
              })
              .catch(() => undefined);
          }
          const next = applyProductEvent(state, event);
          if (next !== state) {
            onState(next);
            state = next;
          }
          retryAttempt = 0;
        },
      );
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof CursorExpiredError) {
        needsSnapshot = true;
        retryAttempt = 0;
        continue;
      }
    }
    if (!signal.aborted) {
      const delayMs = Math.min(
        30_000,
        retryDelayMs * 2 ** Math.min(retryAttempt, 5),
      );
      retryAttempt += 1;
      await abortableDelay(delayMs, signal);
    }
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs === 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

type ApiResult<T> = { code: number; msg?: string; data?: T };

async function loadProjectSnapshot(
  projectId: WireInteger,
  signal: AbortSignal,
): Promise<ProjectSnapshot> {
  const response = await apiFetch(`/api/projects/${projectId}/snapshot`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Snapshot request failed: ${response.status}`);
  }
  const result = (await response.json()) as ApiResult<ProjectSnapshot>;
  if (result.code !== 200 || !result.data) {
    throw new Error(result.msg ?? `Snapshot request failed: ${result.code}`);
  }
  return result.data;
}

function placementAnchor(
  input: unknown,
): PendingOutputPlacement["placement_anchor"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const anchor = (input as Record<string, unknown>).placement_anchor;
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    return null;
  }
  const { x, y, width, height } = anchor as Record<string, unknown>;
  return typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number"
    ? { x, y, width, height }
    : null;
}

function pendingOutputPlacements(
  snapshot: ProjectSnapshot,
): PendingOutputPlacement[] {
  const pending: PendingOutputPlacement[] = [];
  for (const job of snapshot.generation_jobs) {
    if (job.type !== "image" && job.type !== "video") continue;
    const input =
      job.input && typeof job.input === "object" && !Array.isArray(job.input)
        ? (job.input as Record<string, unknown>)
        : {};
    const slots = Array.isArray(job.output_slots) ? job.output_slots : [];
    for (const slot of slots) {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) continue;
      const output = slot as Record<string, unknown>;
      if (
        output.status !== "succeeded" ||
        output.initial_placement_status !== "pending" ||
        !isWireInteger(output.slot_id) ||
        !isWireInteger(output.asset_id) ||
        typeof output.slot_index !== "number"
      ) {
        continue;
      }
      pending.push({
        slot_id: String(output.slot_id),
        generation_job_id: String(job.job_id),
        slot_index: output.slot_index,
        asset_id: String(output.asset_id),
        type: job.type,
        scene_card_id: isWireInteger(input.scene_card_id)
          ? String(input.scene_card_id)
          : null,
        placement_anchor: placementAnchor(input),
      });
    }
  }
  return pending;
}

function toCanvasView(canvas: ProjectSnapshot["canvas"]): CanvasView {
  return {
    id: canvas.id === null ? null : String(canvas.id),
    project_id: String(canvas.project_id),
    version: canvas.version ?? null,
    viewport: canvas.viewport,
    nodes: canvas.nodes,
  };
}

export const projectRecoveryTransport: ProjectRecoveryTransport = {
  async recoverPlacements(projectId, signal) {
    let snapshot = await loadProjectSnapshot(projectId, signal);
    let useCachedSnapshot = true;
    const canvas: CanvasRepo = {
      async getByProject() {
        if (useCachedSnapshot) {
          useCachedSnapshot = false;
        } else {
          snapshot = await loadProjectSnapshot(projectId, signal);
        }
        return toCanvasView(snapshot.canvas);
      },
      async save() {
        throw new Error("Placement recovery requires Canvas CAS");
      },
      async saveIfVersion(_projectId, expectedVersion, viewport, nodes) {
        const response = await apiFetch(`/api/canvases/${projectId}`, {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "If-Match":
              expectedVersion === null ? '"missing"' : `"${expectedVersion}"`,
          },
          body: JSON.stringify({ viewport, nodes }),
          signal,
        });
        if (response.status === 412) return null;
        if (!response.ok) {
          throw new Error(`Placement recovery failed: ${response.status}`);
        }
        const result = (await response.json()) as ApiResult<CanvasView>;
        if (result.code !== 200 || !result.data) {
          throw new Error(
            result.msg ?? `Placement recovery failed: ${result.code}`,
          );
        }
        return result.data;
      },
    };
    const outputPlacements = {
      async listPending() {
        return pendingOutputPlacements(snapshot);
      },
      async markPlaced() {},
    };
    const result = await recoverPendingPlacements(
      canvas,
      String(projectId),
      outputPlacements,
    );
    return {
      id: result.canvas.id,
      project_id: result.canvas.project_id,
      version: result.canvas.version,
      viewport: result.canvas.viewport,
      nodes: result.canvas.nodes,
    };
  },

  async loadSnapshot(projectId, signal) {
    return loadProjectSnapshot(projectId, signal);
  },

  async consumeEvents(projectId, after, signal, onEvent) {
    const response = await apiFetch(
      `/api/projects/${projectId}/events?after=${after}`,
      {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal,
      },
    );
    if (response.status === 410) throw new CursorExpiredError();
    if (!response.ok || !response.body) {
      throw new Error(`Project SSE request failed: ${response.status}`);
    }
    await consumeProjectEventStream(response.body, onEvent);
  },
};
