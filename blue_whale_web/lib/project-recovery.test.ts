import { describe, expect, it, vi } from "vitest";
import {
  CursorExpiredError,
  applyProductEvent,
  applySnapshot,
  consumeProjectEventStream,
  initialProjectRecoveryState,
  runProjectRecovery,
  type ProductEventEnvelope,
  type ProjectRecoveryTransport,
  type ProjectSnapshot,
} from "./project-recovery";

function snapshot(cursor: number, name = "before"): ProjectSnapshot {
  return {
    project: { id: 1, name, thumb: null, created_at: "2026-07-14T00:00:00" },
    canvas: { id: 2, project_id: 1, viewport: '{"zoom":1}', nodes: "[]" },
    generation_jobs: [],
    assets: {},
    high_watermark_cursor: cursor,
  };
}

function event(
  overrides: Partial<ProductEventEnvelope> = {},
): ProductEventEnvelope {
  return {
    schema_version: 1,
    event_id: "evt_11",
    event_type: "project.renamed",
    cursor: 11,
    project_id: 1,
    aggregate_type: "project",
    aggregate_id: "1",
    aggregate_version: 2,
    correlation_id: null,
    causation_id: null,
    occurred_at: "2026-07-14T00:00:01",
    payload: { name: "new" },
    ...overrides,
  };
}

describe("Project 恢复状态机", () => {
  it("从 Snapshot 高水位接续，去重并拒绝旧聚合版本覆盖新状态", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));

    state = applyProductEvent(state, event());
    state = applyProductEvent(state, event());
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_12",
        cursor: 12,
        aggregate_version: 1,
        payload: { name: "old" },
      }),
    );

    expect(state.snapshot?.project.name).toBe("new");
    expect(state.lastCursor).toBe(12);
    expect(state.seenEventIds.size).toBe(2);
  });

  it("拒绝其他 Project 的迟到事件且不推进游标", () => {
    const state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));

    const next = applyProductEvent(state, event({ project_id: 2, cursor: 99 }));

    expect(next).toBe(state);
  });

  it("接受未知聚合的首个版本 0 事件", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_canvas_11",
        event_type: "canvas.updated",
        aggregate_type: "canvas",
        aggregate_id: "2",
        aggregate_version: 0,
        payload: { viewport: '{"zoom":2}', nodes: '[{"id":"n1"}]' },
      }),
    );

    expect(state.snapshot?.canvas.viewport).toBe('{"zoom":2}');
    expect(state.snapshot?.canvas.nodes).toBe('[{"id":"n1"}]');
  });

  it("应用 GenerationJob 已知事件后再推进切片", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_job_11",
        event_type: "generation_job.created",
        aggregate_type: "generation_job",
        aggregate_id: "7",
        aggregate_version: 0,
        payload: { job_id: 7, type: "image", status: "queued" },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_job_12",
        event_type: "generation_job.status_changed",
        cursor: 12,
        aggregate_type: "generation_job",
        aggregate_id: "7",
        aggregate_version: 1,
        payload: {
          job_id: 7,
          status: "succeeded",
          progress: 100,
          output_asset_ids: [9],
        },
      }),
    );

    expect(state.snapshot?.generation_jobs).toEqual([
      {
        job_id: 7,
        type: "image",
        status: "succeeded",
        progress: 100,
        output_asset_ids: [9],
      },
    ]);
    expect(state.lastCursor).toBe(12);
  });
});

describe("Project SSE 解析器", () => {
  it("支持拆包、CRLF、多行 data，并忽略心跳注释", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      ': keepalive\r\n\r\nid: 11\r\nevent: project.renamed\r\ndata: {"schema_version":1,',
      '\r\ndata: "event_id":"evt_11","event_type":"project.renamed","cursor":11,',
      '"project_id":1,"aggregate_type":"project","aggregate_id":"1",',
      '"aggregate_version":2,"correlation_id":null,"causation_id":null,',
      '"occurred_at":"2026-07-14T00:00:01","payload":{"name":"new"}}\r\n\r\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    });
    const received: ProductEventEnvelope[] = [];

    await consumeProjectEventStream(stream, (value) => received.push(value));

    expect(received).toEqual([event()]);
  });
});

describe("Project 恢复协调器", () => {
  it("断线从最后游标重连，游标过期后重新获取 Snapshot", async () => {
    const controller = new AbortController();
    const afterValues: number[] = [];
    const loadSnapshot = vi
      .fn<ProjectRecoveryTransport["loadSnapshot"]>()
      .mockResolvedValueOnce(snapshot(5))
      .mockResolvedValueOnce(snapshot(8, "refreshed"));
    let connection = 0;
    const transport: ProjectRecoveryTransport = {
      loadSnapshot,
      consumeEvents: vi.fn(async (_projectId, after, _signal, onEvent) => {
        afterValues.push(after);
        connection += 1;
        if (connection === 1) {
          onEvent(
            event({ event_id: "evt_6", cursor: 6, aggregate_version: 1 }),
          );
          throw new Error("network disconnected");
        }
        if (connection === 2) {
          throw new CursorExpiredError();
        }
        controller.abort();
      }),
    };
    const states: number[] = [];

    await runProjectRecovery(
      1,
      transport,
      (state) => states.push(state.lastCursor),
      controller.signal,
      0,
    );

    expect(afterValues).toEqual([5, 6, 8]);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(states).toContain(6);
    expect(states.at(-1)).toBe(8);
  });

  it("状态消费者失败时不提交内部游标", async () => {
    const controller = new AbortController();
    const afterValues: number[] = [];
    let connection = 0;
    const transport: ProjectRecoveryTransport = {
      loadSnapshot: vi.fn(async () => snapshot(5)),
      consumeEvents: vi.fn(async (_projectId, after, _signal, onEvent) => {
        afterValues.push(after);
        connection += 1;
        if (connection === 1) {
          onEvent(
            event({ event_id: "evt_6", cursor: 6, aggregate_version: 0 }),
          );
          return;
        }
        controller.abort();
      }),
    };

    await runProjectRecovery(
      1,
      transport,
      (state) => {
        if (state.lastCursor === 6) throw new Error("UI apply failed");
      },
      controller.signal,
      0,
    );

    expect(afterValues).toEqual([5, 5]);
  });

  it("连续断线指数退避，成功收事件后复位", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const afterValues: number[] = [];
    let connection = 0;
    const transport: ProjectRecoveryTransport = {
      loadSnapshot: vi.fn(async () => snapshot(5)),
      consumeEvents: vi.fn(async (_projectId, after, _signal, onEvent) => {
        afterValues.push(after);
        connection += 1;
        if (connection === 3) {
          onEvent(
            event({ event_id: "evt_6", cursor: 6, aggregate_version: 0 }),
          );
        }
        if (connection === 5) controller.abort();
      }),
    };

    const recovery = runProjectRecovery(
      1,
      transport,
      () => undefined,
      controller.signal,
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(connection).toBe(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(connection).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connection).toBe(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(connection).toBe(4);
    await vi.advanceTimersByTimeAsync(200);
    await recovery;

    expect(afterValues).toEqual([5, 5, 5, 6, 6]);
    vi.useRealTimers();
  });
});
