import type {
  AgentAdapter,
  AgentRequest,
  AgentResult,
} from "@blue-whale/core";
import { createHash } from "node:crypto";

const FAILURE_MARKER = "fake:failure";
const DELAY_MARKER = /fake:delay:(\d+)/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFakeAgentAdapter(): AgentAdapter {
  return {
    name: "fake-agent-runtime",
    async ready() {
      return true;
    },
    async invoke(request) {
      if (request.prompt.includes(FAILURE_MARKER)) {
        throw new Error("fake agent explicit failure");
      }
      const delayMatch = DELAY_MARKER.exec(request.prompt);
      if (delayMatch) await sleep(Number(delayMatch[1]));

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
