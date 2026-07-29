import { describe, expect, it } from "vitest";

import type { ProjectSnapshot } from "@/lib/project-recovery";
import { inboxSnapshotToChatMessages } from "./inboxMessages";

describe("inboxSnapshotToChatMessages", () => {
  it("uses exact large conversation ids to isolate messages and generation cards", () => {
    const selected = "9007199254740993";
    const other = "9007199254740995";
    const snapshot: ProjectSnapshot = {
      project: {
        id: 1,
        name: "收件箱",
        thumb: null,
        created_at: "2026-07-29T00:00:00.000Z",
      },
      canvas: { id: null, project_id: 1, viewport: null, nodes: null },
      conversation_messages: [
        {
          message_id: "11",
          conversation_id: selected,
          role: "user",
          content: "当前对话",
          sequence_no: 1,
        },
        {
          message_id: "12",
          conversation_id: other,
          role: "user",
          content: "其他对话",
          sequence_no: 1,
        },
      ],
      agent_runs: [
        { agent_run_id: "21", conversation_id: selected },
        { agent_run_id: "22", conversation_id: other },
      ],
      generation_jobs: [
        {
          job_id: "31",
          agent_run_id: "21",
          source: "agent_run",
          type: "image",
          status: "queued",
        },
        {
          job_id: "32",
          agent_run_id: "22",
          source: "agent_run",
          type: "image",
          status: "queued",
        },
      ],
      assets: {},
      high_watermark_cursor: 1,
    };

    const messages = inboxSnapshotToChatMessages(snapshot, selected as never);

    expect(messages.map((message) => message.id)).toEqual([
      "message-11",
      "generation-job-31-slot-0",
    ]);
  });
});
