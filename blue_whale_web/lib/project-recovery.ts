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
  generation_jobs: Array<Record<string, unknown>>;
  assets: Record<string, unknown>;
  high_watermark_cursor: number;
};

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
