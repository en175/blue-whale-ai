import type {
  GenerationAdapter,
  GenerationRequest,
  GenerationResult,
} from "@blue-whale/core";
import { createHash } from "node:crypto";

export function createFakeGenerationAdapter(): GenerationAdapter {
  return {
    name: "fake-generation-runtime",
    async ready() {
      return true;
    },
    async generate(request) {
      const contentId = createHash("sha256")
        .update(`blue-whale-fake-v1\n${request.prompt}\n${request.outputIndex}`)
        .digest("hex");

      return {
        provider: "fake",
        mediaType: "image/png",
        contentId,
        uri: `fake://assets/${contentId}.png`,
      };
    },
  };
}
