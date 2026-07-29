import { describe, expect, it, vi } from "vitest";

import { createProjectEventStream } from "./project-event-stream.js";

describe("createProjectEventStream", () => {
  it("replays persisted events after the requested cursor and stops on cancel", async () => {
    const listAfter = vi
      .fn()
      .mockResolvedValueOnce([
        {
          event_id: "evt_1",
          event_type: "conversation.message_completed",
          cursor: "8",
          project_id: "42",
          aggregate_type: "conversation",
          aggregate_id: "7",
          aggregate_version: 2,
          correlation_id: null,
          causation_id: null,
          occurred_at: "2026-07-29T00:00:00.000Z",
          payload: { message_id: "9" },
        },
      ])
      .mockResolvedValue([]);
    const stream = createProjectEventStream({
      projectId: "42",
      after: "7",
      events: { listAfter, highWatermark: vi.fn() },
      pollIntervalMs: 5,
      heartbeatIntervalMs: 1_000,
    });
    const reader = stream.getReader();

    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("id: 8");
    expect(text).toContain("event: conversation.message_completed");
    expect(text).toContain('"cursor":8');
    expect(listAfter).toHaveBeenCalledWith("42", "7", 100);

    await reader.cancel();
  });

  it("keeps BIGINT cursor and ids as strings when they exceed safe integers", async () => {
    const huge = "9007199254740993";
    const listAfter = vi
      .fn()
      .mockResolvedValueOnce([
        {
          event_id: "evt_huge",
          event_type: "conversation.message_completed",
          cursor: huge,
          project_id: huge,
          aggregate_type: "conversation",
          aggregate_id: huge,
          aggregate_version: 1,
          correlation_id: null,
          causation_id: null,
          occurred_at: "2026-07-29T00:00:00.000Z",
          payload: { message_id: huge },
        },
      ])
      .mockResolvedValue([]);
    const upstream = new AbortController();
    const removeListener = vi.spyOn(upstream.signal, "removeEventListener");
    const reader = createProjectEventStream({
      projectId: huge,
      after: "0",
      events: { listAfter, highWatermark: vi.fn() },
      signal: upstream.signal,
      pollIntervalMs: 5,
    }).getReader();

    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain(`"cursor":"${huge}"`);
    expect(frame).toContain(`"project_id":"${huge}"`);
    expect(frame).toContain(`"message_id":"${huge}"`);
    await reader.cancel();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
