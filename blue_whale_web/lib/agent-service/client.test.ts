import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiFetch: mocks.apiFetch }));

import { createAgentSession, streamAgentEvents } from "./client";

describe("Agent service browser client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards a stable idempotency key when creating a Session", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json({ session_id: "session-1" }, { status: 201 }),
    );
    await createAgentSession("101", "create-key");
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/api/agent/v1/projects/101/sessions",
      expect.objectContaining({ headers: { "idempotency-key": "create-key" } }),
    );
  });

  it("parses durable SSE envelopes and ignores stream.ready", async () => {
    const event = {
      schema_version: 1,
      event_id: "evt-2",
      cursor: "evt-2",
      type: "assistant.delta",
      occurred_at: "2026-08-12T00:00:00.000Z",
      session_id: "session-1",
      run_id: "run-1",
      payload: { text: "回复" },
    } as const;
    mocks.apiFetch.mockResolvedValue(
      new Response(
        `event: stream.ready\r\ndata: {"cursor":"evt-1"}\r\n\r\nid: evt-2\r\nevent: assistant.delta\r\ndata: ${JSON.stringify(event)}\r\n\r\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    const onEvent = vi.fn();
    await streamAgentEvents({
      projectId: "101",
      sessionId: "session-1",
      after: "evt-1",
      signal: new AbortController().signal,
      onEvent,
    });
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(event);
  });
});
