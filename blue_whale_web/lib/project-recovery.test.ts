import { describe, expect, it, vi } from "vitest";
import {
  CursorExpiredError,
  applyProductEvent,
  applySnapshot,
  consumeProjectEventStream,
  deriveAnswerableClarification,
  deriveLatestAgentRunDisplay,
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
    conversation_messages: [],
    agent_runs: [],
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

  it("按 asset_id 合并 Asset 与输出槽事件，重复回放不产生重复输出", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_asset_11",
        event_type: "asset.created",
        aggregate_type: "asset",
        aggregate_id: "9",
        aggregate_version: 0,
        payload: {
          asset_id: 9,
          type: "image",
          access_url: "/api/projects/1/assets/9/content",
        },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_output_12",
        event_type: "generation_job.output_attached",
        cursor: 12,
        aggregate_type: "generation_job_output",
        aggregate_id: "7:0",
        aggregate_version: 0,
        payload: { job_id: 7, slot_index: 0, asset_id: 9 },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_output_13",
        event_type: "generation_job.output_attached",
        cursor: 13,
        aggregate_type: "generation_job_output",
        aggregate_id: "7:0",
        aggregate_version: 1,
        payload: { job_id: 7, slot_index: 0, asset_id: 9 },
      }),
    );

    expect(state.snapshot?.assets).toEqual({
      "9": {
        asset_id: 9,
        type: "image",
        access_url: "/api/projects/1/assets/9/content",
      },
    });
    expect(state.snapshot?.generation_jobs).toEqual([
      { job_id: 7, outputs: [{ slot_index: 0, asset_id: 9 }] },
    ]);
  });

  it("输出失败事件保留空 asset 并合并公开错误", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_output_failed_11",
        event_type: "generation_job.output_updated",
        aggregate_type: "generation_job_output",
        aggregate_id: "7:1",
        aggregate_version: 1,
        payload: {
          job_id: 7,
          slot_index: 1,
          status: "failed",
          asset_id: null,
          error: { code: "provider_failed", message: "图像生成失败" },
        },
      }),
    );

    expect(state.snapshot?.generation_jobs).toEqual([
      {
        job_id: 7,
        outputs: [
          {
            slot_index: 1,
            status: "failed",
            asset_id: null,
            error: { code: "provider_failed", message: "图像生成失败" },
          },
        ],
      },
    ]);
  });

  it("应用 Conversation 与 AgentRun 事件并保留可恢复事实", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_message_11",
        event_type: "conversation.message_completed",
        aggregate_type: "conversation",
        aggregate_id: "3",
        aggregate_version: 2,
        payload: {
          message_id: 8,
          conversation_id: 3,
          agent_run_id: 5,
          role: "assistant",
          content: "正在生成图片。",
          sequence_no: 2,
        },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_run_12",
        event_type: "agent_run.status_changed",
        cursor: 12,
        aggregate_type: "agent_run",
        aggregate_id: "5",
        aggregate_version: 2,
        payload: {
          agent_run_id: 5,
          status: "awaiting_job",
          stage: "generating",
        },
      }),
    );

    expect(state.snapshot?.conversation_messages).toEqual([
      expect.objectContaining({ message_id: 8, sequence_no: 2 }),
    ]);
    expect(state.snapshot?.agent_runs).toEqual([
      expect.objectContaining({ agent_run_id: 5, status: "awaiting_job" }),
    ]);
  });

  it("agent_run.created 事件透传 activated_creative_skill_versions 数组（契约 §3 始终为数组）", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_run_created_forced",
        event_type: "agent_run.created",
        aggregate_type: "agent_run",
        aggregate_id: "9",
        aggregate_version: 0,
        payload: {
          agent_run_id: 9,
          status: "queued",
          activated_creative_skill_versions: [
            {
              creative_skill_id: "cs_ugc_ads_video",
              source: "forced_use",
              reason: { type: "user_use" },
            },
          ],
        },
      }),
    );

    const run = state.snapshot?.agent_runs.find((r) => r.agent_run_id === 9);
    expect(Array.isArray(run?.activated_creative_skill_versions)).toBe(true);
    expect(run?.activated_creative_skill_versions).toEqual([
      expect.objectContaining({
        creative_skill_id: "cs_ugc_ads_video",
        source: "forced_use",
      }),
    ]);
  });

  it("按 stream_id 重放 Assistant started、chunk 与 completed 且不重复文本", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), snapshot(10));

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_stream_started",
        event_type: "conversation.message_started",
        aggregate_type: "conversation_message",
        aggregate_id: "assistant-stream-5",
        aggregate_version: 0,
        payload: {
          stream_id: "assistant-stream-5",
          conversation_id: 3,
          agent_run_id: 5,
          role: "assistant",
          content: "",
          status: "streaming",
          last_chunk_sequence: 0,
        },
      }),
    );

    expect(state.snapshot?.conversation_messages).toEqual([
      expect.objectContaining({
        stream_id: "assistant-stream-5",
        content: "",
        status: "streaming",
      }),
    ]);

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_stream_chunk_1",
        cursor: 12,
        event_type: "conversation.message_chunk_appended",
        aggregate_type: "conversation_message",
        aggregate_id: "assistant-stream-5",
        aggregate_version: 1,
        payload: {
          message_id: 8,
          stream_id: "assistant-stream-5",
          conversation_id: 3,
          agent_run_id: 5,
          role: "assistant",
          content: "你好，",
          sequence_no: 2,
          status: "streaming",
          last_chunk_sequence: 1,
        },
      }),
    );

    expect(state.snapshot?.conversation_messages).toEqual([
      expect.objectContaining({
        message_id: 8,
        stream_id: "assistant-stream-5",
        content: "你好，",
        last_chunk_sequence: 1,
      }),
    ]);

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_stream_chunk_1",
        cursor: 13,
        event_type: "conversation.message_chunk_appended",
        aggregate_type: "conversation_message",
        aggregate_id: "assistant-stream-5",
        aggregate_version: 1,
        payload: {
          message_id: 8,
          stream_id: "assistant-stream-5",
          content: "不应重复",
          last_chunk_sequence: 1,
        },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_stream_old",
        cursor: 14,
        event_type: "conversation.message_chunk_appended",
        aggregate_type: "conversation_message",
        aggregate_id: "assistant-stream-5",
        aggregate_version: 0,
        payload: {
          message_id: 8,
          stream_id: "assistant-stream-5",
          content: "旧内容",
          last_chunk_sequence: 0,
        },
      }),
    );

    expect(state.snapshot?.conversation_messages[0]?.content).toBe("你好，");

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_job_with_private_text",
        cursor: 15,
        event_type: "generation_job.status_changed",
        aggregate_type: "generation_job",
        aggregate_id: "91",
        aggregate_version: 1,
        payload: {
          job_id: 91,
          status: "processing",
          content: "工具、Job、Asset 私有文本不得进入 Conversation",
        },
      }),
    );

    expect(state.snapshot?.conversation_messages[0]?.content).toBe("你好，");

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_stream_completed",
        cursor: 16,
        event_type: "conversation.message_completed",
        aggregate_type: "conversation_message",
        aggregate_id: "assistant-stream-5",
        aggregate_version: 2,
        payload: {
          message_id: 8,
          stream_id: "assistant-stream-5",
          conversation_id: 3,
          agent_run_id: 5,
          role: "assistant",
          content: "你好，世界",
          sequence_no: 2,
          status: "completed",
          last_chunk_sequence: 2,
        },
      }),
    );

    expect(state.snapshot?.conversation_messages).toEqual([
      expect.objectContaining({
        message_id: 8,
        stream_id: "assistant-stream-5",
        content: "你好，世界",
        status: "completed",
        last_chunk_sequence: 2,
      }),
    ]);
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

describe("创作澄清活动请求投影", () => {
  const NOW = new Date("2026-07-17T00:00:00Z");
  const clarificationRequest = {
    input_request_id: 42,
    request_type: "creation_clarification",
    question: "希望什么风格？",
    action_identity: "clarification:5",
    action_type: "creation_clarification",
    status: "pending",
    expires_at: "2099-01-01T00:00:00Z",
  };
  const awaitingRun = {
    agent_run_id: 5,
    conversation_id: 3,
    status: "awaiting_input",
    active_input_request: clarificationRequest,
  };

  it("从 Snapshot 派生当前可回答的创作澄清请求", () => {
    const snap: ProjectSnapshot = {
      ...snapshot(10),
      agent_runs: [awaitingRun],
    };

    expect(deriveAnswerableClarification(snap, NOW)?.input_request_id).toBe(42);
  });

  it("多个候选时绑定最新创建的请求", () => {
    const older = {
      agent_run_id: 4,
      active_input_request: { ...clarificationRequest, input_request_id: 40 },
    };
    const snap: ProjectSnapshot = {
      ...snapshot(10),
      agent_runs: [older, awaitingRun],
    };

    expect(deriveAnswerableClarification(snap, NOW)?.input_request_id).toBe(42);
  });

  it("过期、已回答、已消费或非创作澄清的请求不参与绑定", () => {
    const variants = [
      {
        ...awaitingRun,
        active_input_request: {
          ...clarificationRequest,
          expires_at: "2020-01-01T00:00:00Z",
        },
      },
      {
        ...awaitingRun,
        active_input_request: { ...clarificationRequest, status: "confirmed" },
      },
      {
        ...awaitingRun,
        active_input_request: { ...clarificationRequest, status: "consumed" },
      },
      {
        ...awaitingRun,
        active_input_request: {
          ...clarificationRequest,
          request_type: "cost_confirmation",
          question: null,
        },
      },
    ];

    for (const run of variants) {
      const snap: ProjectSnapshot = { ...snapshot(10), agent_runs: [run] };
      expect(deriveAnswerableClarification(snap, NOW)).toBeNull();
    }
  });

  it("user_input_requested 事件把活动澄清请求投影到对应 AgentRun", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), {
      ...snapshot(10),
      agent_runs: [{ agent_run_id: 5, conversation_id: 3, status: "running" }],
    });

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_req_1",
        event_type: "agent_run.user_input_requested",
        aggregate_type: "agent_run",
        aggregate_id: "5",
        aggregate_version: 2,
        payload: {
          input_request_id: 42,
          agent_run_id: 5,
          request_type: "creation_clarification",
          question: "希望什么风格？",
          status: "pending",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    );

    expect(
      deriveAnswerableClarification(state.snapshot, NOW)?.input_request_id,
    ).toBe(42);
  });

  it("同聚合同版本的 user_input_requested 不被误拒（IK1NS2 回归）", () => {
    // 后端对 user_input_requested 不递增聚合版本：它与前一条 status_changed 同版本。
    // 版本守卫只拒绝严格更旧的状态，同版本事实事件仍须应用，否则前端丢失 pending
    // 澄清请求，回答无法绑定原 AgentRun。
    let state = applySnapshot(initialProjectRecoveryState(1), {
      ...snapshot(10),
      agent_runs: [{ agent_run_id: 5, conversation_id: 3, status: "queued" }],
    });

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_sc_1",
        event_type: "agent_run.status_changed",
        aggregate_type: "agent_run",
        aggregate_id: "5",
        aggregate_version: 1,
        payload: { agent_run_id: 5, status: "running", stage: "orchestrating" },
      }),
    );
    state = applyProductEvent(
      state,
      event({
        event_id: "evt_req_2",
        cursor: 12,
        event_type: "agent_run.user_input_requested",
        aggregate_type: "agent_run",
        aggregate_id: "5",
        aggregate_version: 1,
        payload: {
          input_request_id: 42,
          agent_run_id: 5,
          request_type: "creation_clarification",
          question: "希望什么风格？",
          status: "pending",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    );

    expect(
      deriveAnswerableClarification(state.snapshot, NOW)?.input_request_id,
    ).toBe(42);
  });

  it("user_input_answered 事件把请求标记为已回答，不再参与 Composer 绑定", () => {
    let state = applySnapshot(initialProjectRecoveryState(1), {
      ...snapshot(10),
      agent_runs: [awaitingRun],
    });

    state = applyProductEvent(
      state,
      event({
        event_id: "evt_ans_1",
        event_type: "agent_run.user_input_answered",
        aggregate_type: "agent_run",
        aggregate_id: "5",
        aggregate_version: 3,
        payload: {
          input_request_id: 42,
          source_agent_run_id: 5,
          resumed_agent_run_id: 6,
          answer_message_id: 9,
          status: "confirmed",
        },
      }),
    );

    const run = state.snapshot?.agent_runs.find(
      (candidate) => candidate.agent_run_id === 5,
    );
    expect(
      (run?.active_input_request as { status?: string } | undefined)?.status,
    ).toBe("confirmed");
    expect(deriveAnswerableClarification(state.snapshot, NOW)).toBeNull();
  });
});

describe("AgentRun 安全展示投影", () => {
  it("从最新 Run 派生状态、Skill 名称和 ReasoningSummary", () => {
    const snap: ProjectSnapshot = {
      ...snapshot(10),
      agent_runs: [
        { agent_run_id: 8, status: "completed" },
        {
          agent_run_id: 9,
          status: "running",
          activated_creative_skill_versions: [
            { name: "海报专家", source: "forced_use" },
          ],
          reasoning_summary: "正在使用已冻结技能。",
          run_pin: { private: true },
        },
      ],
    };

    expect(deriveLatestAgentRunDisplay(snap)).toEqual({
      agentRunId: 9,
      status: "running",
      skillName: "海报专家",
      reasoningSummary: "正在使用已冻结技能。",
    });
  });
});

describe("Project 恢复协调器", () => {
  it("Assistant 流中途断线后从最后游标续传且文本不重不漏", async () => {
    const controller = new AbortController();
    const afterValues: number[] = [];
    const contents: string[] = [];
    let connection = 0;
    const transport: ProjectRecoveryTransport = {
      loadSnapshot: vi.fn(async () => snapshot(10)),
      consumeEvents: vi.fn(async (_projectId, after, _signal, onEvent) => {
        afterValues.push(after);
        connection += 1;
        if (connection === 1) {
          onEvent(
            event({
              event_id: "evt_stream_started_disconnect",
              cursor: 11,
              event_type: "conversation.message_started",
              aggregate_type: "conversation_message",
              aggregate_id: "assistant-stream-disconnect",
              aggregate_version: 0,
              payload: {
                stream_id: "assistant-stream-disconnect",
                conversation_id: 3,
                agent_run_id: 5,
                role: "assistant",
                content: "",
                status: "streaming",
                last_chunk_sequence: 0,
              },
            }),
          );
          onEvent(
            event({
              event_id: "evt_stream_chunk_disconnect_1",
              cursor: 12,
              event_type: "conversation.message_chunk_appended",
              aggregate_type: "conversation_message",
              aggregate_id: "assistant-stream-disconnect",
              aggregate_version: 1,
              payload: {
                message_id: 8,
                stream_id: "assistant-stream-disconnect",
                conversation_id: 3,
                agent_run_id: 5,
                role: "assistant",
                content: "你好，",
                sequence_no: 2,
                status: "streaming",
                last_chunk_sequence: 1,
              },
            }),
          );
          throw new Error("network disconnected mid-stream");
        }
        onEvent(
          event({
            event_id: "evt_stream_chunk_disconnect_2",
            cursor: 13,
            event_type: "conversation.message_chunk_appended",
            aggregate_type: "conversation_message",
            aggregate_id: "assistant-stream-disconnect",
            aggregate_version: 2,
            payload: {
              message_id: 8,
              stream_id: "assistant-stream-disconnect",
              conversation_id: 3,
              agent_run_id: 5,
              role: "assistant",
              content: "你好，世界",
              sequence_no: 2,
              status: "streaming",
              last_chunk_sequence: 2,
            },
          }),
        );
        onEvent(
          event({
            event_id: "evt_stream_complete_disconnect",
            cursor: 14,
            event_type: "conversation.message_completed",
            aggregate_type: "conversation_message",
            aggregate_id: "assistant-stream-disconnect",
            aggregate_version: 3,
            payload: {
              message_id: 8,
              stream_id: "assistant-stream-disconnect",
              conversation_id: 3,
              agent_run_id: 5,
              role: "assistant",
              content: "你好，世界",
              sequence_no: 2,
              status: "completed",
              last_chunk_sequence: 2,
            },
          }),
        );
        controller.abort();
      }),
    };

    await runProjectRecovery(
      1,
      transport,
      (state) => {
        const content = state.snapshot?.conversation_messages[0]?.content;
        if (typeof content === "string") contents.push(content);
      },
      controller.signal,
      0,
    );

    expect(afterValues).toEqual([10, 12]);
    expect(contents).toContain("你好，");
    expect(contents.at(-1)).toBe("你好，世界");
  });

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
    const states: Array<number | string> = [];

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
