import type {
  AgentAdapter,
  AgentRequest,
  AgentResult,
} from "@blue-whale/core";
import { createHash } from "node:crypto";

export function createFakeAgentAdapter(): AgentAdapter {
  return {
    name: "fake-agent-runtime",
    async ready() {
      return true;
    },
    async invoke(request) {
      const fingerprint = createHash("sha256")
        .update(`blue-whale-agent-fake-v1\n${request.prompt}`)
        .digest("hex");

      return {
        provider: "fake",
        content: `fake-agent-response:${fingerprint}`,
      };
    },
  };
}
