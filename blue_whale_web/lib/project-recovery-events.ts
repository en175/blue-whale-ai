// IK74V6：project recovery 的状态机与事件应用（从 project-recovery.ts 下沉）。
import {
  isWireInteger,
  type WireInteger,
} from "./wire-integer";
import {
  compareWireIntegers as compareWireInteger,
} from "./wire-integer";
import type {
  ActiveInputRequest,
  AgentRunDisplay,
  ProductEventEnvelope,
  ProjectRecoveryState,
  ProjectSnapshot,
  ProvisionalDeliveryView,
} from "./project-recovery-types";
const MAX_SEEN_EVENT_IDS = 1_000;

export class CursorExpiredError extends Error {
  constructor() {
    super("Project SSE cursor expired");
    this.name = "CursorExpiredError";
  }
}

/**
 * 事件流完整性违规（IK67HH T16，ADR-0016 §6）：未知 schema/畸形信封或乱序的
 * 未知事件。不得应用、不得推进游标，由恢复循环触发一次 Snapshot 恢复。
 * 游标为雪花 ID：前进跳号正常，只有倒退的未知事件构成乱序异常。
 */
export class EventIntegrityError extends Error {
  constructor(readonly reason: "unknown-schema" | "cursor-rewind") {
    super(`Project SSE event integrity violation: ${reason}`);
    this.name = "EventIntegrityError";
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
    incompatible: false,
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
    incompatible: false,
  };
}

export function applyProductEvent(
  state: ProjectRecoveryState,
  event: ProductEventEnvelope,
): ProjectRecoveryState {
  if (String(event.project_id) !== String(state.projectId)) {
    return state;
  }

  if (compareWireInteger(event.cursor, state.lastCursor) <= 0) {
    // 已见事件的安全重放是 no-op；倒退的未知事件说明流已乱序，
    // 客户端不得猜测缺失事实（IK67HH T16，ADR-0016 §6）。
    // 游标为雪花 ID（非连续）：前进跳号正常，只有倒退的未知事件构成异常。
    if (state.seenEventIds.has(event.event_id)) return state;
    throw new EventIntegrityError("cursor-rewind");
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
      event.event_type === "storyboard_preview.created" ||
      event.event_type === "storyboard_preview.summary_changed"
    ) {
      // IK67HF/T15：分镜创建与汇总态变化都按 preview_id 合并同一投影。
      snapshot = {
        ...snapshot,
        storyboard_previews: upsertFact(
          snapshot.storyboard_previews ?? [],
          event.payload,
          "preview_id",
        ),
      };
    } else if (event.event_type === "plan_message.applied") {
      // IK6KQB 手动应用闭环：权威应用事实。payload 不含 applied_at，
      // 以事件 occurred_at 为权威应用时间；仅合并快照中已有的计划，
      // 缺项交由下次 Snapshot 对齐，不伪造部分事实。
      const planMessageId = event.payload.plan_message_id;
      if (
        typeof planMessageId === "number" ||
        typeof planMessageId === "string"
      ) {
        const firstGenerationJobId =
          event.payload.first_generation_job_id === null ||
          isWireInteger(event.payload.first_generation_job_id)
            ? (event.payload.first_generation_job_id as WireInteger | null)
            : null;
        snapshot = {
          ...snapshot,
          plan_messages: (snapshot.plan_messages ?? []).map((plan) =>
            String(plan.message_id) === String(planMessageId)
              ? {
                  ...plan,
                  applied_at: event.occurred_at,
                  first_generation_job_id: firstGenerationJobId,
                }
              : plan,
          ),
        };
      }
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
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new EventIntegrityError("unknown-schema");
  }
  if (!isProductEventEnvelope(value)) {
    throw new EventIntegrityError("unknown-schema");
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
