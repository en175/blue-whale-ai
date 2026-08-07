// IK74V6：project recovery 编排层（快照加载/SSE 循环/transport）。
// 类型与派生函数在 ./project-recovery-types，状态机在 ./project-recovery-events；
// 本文件 re-export 全部公开符号，外部 import 路径保持不变。
import { apiFetch } from "./api-client";
import type { CanvasRepo, CanvasView } from "@blue-whale/persistence";
import {
  recoverPendingPlacements,
  type PendingOutputPlacement,
} from "./conversation/scene-card-placement";
import { isWireInteger, type WireInteger } from "./wire-integer";
import {
  initialProjectRecoveryState,
  applySnapshot,
  applyProductEvent,
  consumeProjectEventStream,
  CursorExpiredError,
  EventIntegrityError,
} from "./project-recovery-events";
import type {
  ProductEventEnvelope,
  ProjectRecoveryState,
  ProjectRecoveryTransport,
  ProjectSnapshot,
} from "./project-recovery-types";

export * from "./project-recovery-types";
export {
  initialProjectRecoveryState,
  applySnapshot,
  applyProductEvent,
  consumeProjectEventStream,
  CursorExpiredError,
  EventIntegrityError,
} from "./project-recovery-events";

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
  // ADR-0016 §6：不兼容事件只允许一次同 major Snapshot 恢复，禁止循环重连。
  let integrityRecoveryUsed = false;

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
      if (error instanceof EventIntegrityError) {
        if (integrityRecoveryUsed) {
          // 恢复后仍遇不兼容事件：进入合同不兼容状态，停止订阅、不合成事实，
          // 并记录最小失败证据（ADR-0016 §6）。
          console.error(
            `[project-recovery] contract incompatible: project=${projectId} reason=${error.reason}`,
          );
          state = { ...state, incompatible: true };
          onState(state);
          return;
        }
        integrityRecoveryUsed = true;
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
    const isStoryboardFrame = input.storyboard_preview === true;
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
        is_storyboard_frame: isStoryboardFrame,
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
