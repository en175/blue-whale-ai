import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import { describe, expect, it } from "vitest";

import { register } from "./instrumentation";

describe("Next.js 启动边界", () => {
  it("启动恢复扫描前拒绝无效 Runtime Manifest", async () => {
    const invalid = structuredClone(bundledAgentRuntimeManifest);
    invalid.selected_model_profile_id = "model.missing";

    await expect(register(invalid)).rejects.toThrow("model profile reference");
  });
});
