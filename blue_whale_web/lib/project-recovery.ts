import { apiFetch } from "./api-client";

export type ProjectSnapshot = {
  project: {
    id: number;
    name: string;
    thumb: string | null;
    created_at: string;
  };
  canvas: {
    id: number | null;
    project_id: number;
    viewport: string | null;
    nodes: string | null;
  };
  conversation_messages: Array<Record<string, unknown>>;
  agent_runs: Array<Record<string, unknown>>;
  generation_jobs: Array<Record<string, unknown>>;
  assets: Record<
    string,
    { asset_id: number | string; type: string; access_url: string }
  >;
  high_watermark_cursor: number;
};

export type ActiveInputRequest = {
  input_request_id: number;
  request_type: string;
  question: string | null;
  status: string;
  expires_at: string;
};

/**
 * 派生当前唯一可回答的创作澄清请求（AgentChatPanel Composer 下一次提交的回答绑定）。
 *
 * 只绑定 pending 状态的 creation_clarification：confirmed（已回答）、consumed（已消费）、
 * 过期或成本确认请求都不参与绑定。Snapshot 已按服务端认证限定当前 User/Project，
 * 同一创作流程任一时刻至多一个 pending 请求；防御性取最新创建者。
 */
export function deriveAnswerableClarification(
  snapshot: ProjectSnapshot | null,
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
      typeof candidate.input_request_id !== "number" ||
      typeof candidate.expires_at !== "string" ||
      !(new Date(candidate.expires_at).getTime() > now.getTime())
    ) {
      continue;
    }
    if (
      answerable === null ||
      candidate.input_request_id > answerable.input_request_id
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
  cursor: number;
  project_id: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export type ProjectRecoveryState = {
  projectId: number;
  snapshot: ProjectSnapshot | null;
  lastCursor: number;
  seenEventIds: ReadonlySet<string>;
  aggregateVersions: ReadonlyMap<string, number>;
  deleted: boolean;
};

export type ProjectRecoveryTransport = {
  loadSnapshot(
    projectId: number,
    signal: AbortSignal,
  ): Promise<ProjectSnapshot>;
  consumeEvents(
    projectId: number,
    after: number,
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
  projectId: number,
): ProjectRecoveryState {
  return {
    projectId,
    snapshot: null,
    lastCursor: 0,
    seenEventIds: new Set(),
    aggregateVersions: new Map(),
    deleted: false,
  };
}

export function applySnapshot(
  state: ProjectRecoveryState,
  snapshot: ProjectSnapshot,
): ProjectRecoveryState {
  if (snapshot.project.id !== state.projectId) {
    throw new Error("Snapshot does not belong to the requested Project");
  }
  return {
    ...state,
    snapshot,
    lastCursor: snapshot.high_watermark_cursor,
    seenEventIds: new Set(),
    aggregateVersions: new Map(),
    deleted: false,
  };
}

export function applyProductEvent(
  state: ProjectRecoveryState,
  event: ProductEventEnvelope,
): ProjectRecoveryState {
  if (
    event.project_id !== state.projectId ||
    event.cursor <= state.lastCursor
  ) {
    return state;
  }

  const seenEventIds = rememberEvent(state.seenEventIds, event.event_id);
  if (state.seenEventIds.has(event.event_id)) {
    return { ...state, lastCursor: event.cursor, seenEventIds };
  }

  const aggregateKey = `${event.aggregate_type}:${event.aggregate_id}`;
  const previousVersion = state.aggregateVersions.get(aggregateKey) ?? -1;
  if (event.aggregate_version <= previousVersion) {
    return { ...state, lastCursor: event.cursor, seenEventIds };
  }

  const aggregateVersions = new Map(state.aggregateVersions);
  aggregateVersions.set(aggregateKey, event.aggregate_version);
  let snapshot = state.snapshot;
  let deleted = state.deleted;

  if (snapshot) {
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
    } else if (
      event.event_type === "conversation.message_accepted" ||
      event.event_type === "conversation.message_completed"
    ) {
      snapshot = {
        ...snapshot,
        conversation_messages: upsertFact(
          snapshot.conversation_messages,
          event.payload,
          "message_id",
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
  };
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
  const outputs = Array.isArray(current.outputs)
    ? current.outputs.filter(
        (output): output is Record<string, unknown> =>
          !!output && typeof output === "object",
      )
    : [];
  const outputIndex = outputs.findIndex(
    (output) => output.slot_index === slotIndex,
  );
  const previousOutput = outputIndex < 0 ? {} : outputs[outputIndex];
  const nextOutput = {
    ...previousOutput,
    slot_index: slotIndex,
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
  };
  const nextOutputs =
    outputIndex < 0
      ? [...outputs, nextOutput].sort(
          (left, right) =>
            Number(left.slot_index ?? 0) - Number(right.slot_index ?? 0),
        )
      : outputs.map((output, currentIndex) =>
          currentIndex === outputIndex ? nextOutput : output,
        );
  const nextJob = { ...current, outputs: nextOutputs };
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
    typeof payload.input_request_id !== "number"
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
  if (typeof requestId !== "number") return runs;
  const status =
    typeof payload.status === "string" ? payload.status : "confirmed";
  return runs.map((run) => {
    const active = run.active_input_request;
    if (!active || typeof active !== "object") return run;
    const current = active as Record<string, unknown>;
    if (current.input_request_id !== requestId) return run;
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
    typeof event.cursor === "number" &&
    typeof event.project_id === "number" &&
    typeof event.aggregate_type === "string" &&
    typeof event.aggregate_id === "string" &&
    typeof event.aggregate_version === "number" &&
    typeof event.occurred_at === "string" &&
    !!event.payload &&
    typeof event.payload === "object"
  );
}

export async function runProjectRecovery(
  projectId: number,
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

export const projectRecoveryTransport: ProjectRecoveryTransport = {
  async loadSnapshot(projectId, signal) {
    const response = await apiFetch(`/api/projects/${projectId}/snapshot`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok)
      throw new Error(`Snapshot request failed: ${response.status}`);
    const result = (await response.json()) as ApiResult<ProjectSnapshot>;
    if (result.code !== 200 || !result.data) {
      throw new Error(result.msg ?? `Snapshot request failed: ${result.code}`);
    }
    return result.data;
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
