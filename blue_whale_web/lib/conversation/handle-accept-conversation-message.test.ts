import type { ConversationRepo } from "@blue-whale/persistence";
import { describe, expect, it, vi } from "vitest";

import { handleAcceptConversationMessage } from "./handle-accept-conversation-message";

describe("handleAcceptConversationMessage", () => {
  it("preserves database ids beyond Number.MAX_SAFE_INTEGER", async () => {
    const huge = "9007199254740993";
    const deps: ConversationRepo = {
      acceptMessage: vi.fn().mockResolvedValue({
        kind: "accepted",
        project_id: "7",
        conversation_id: huge,
        message_id: huge,
        agent_run_id: huge,
        cursor: huge,
        sequence_no: 1,
      }),
    };

    const result = await handleAcceptConversationMessage(
      "9",
      "7",
      { client_message_id: "client-1", content: "生成蓝鲸" },
      "command-1",
      deps,
    );

    expect(result.data).toEqual({
      message_id: huge,
      agent_run_id: huge,
      cursor: huge,
    });
  });
});
