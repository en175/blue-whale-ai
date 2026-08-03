import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import { describe, expect, it } from "vitest";

import { validateAgentWorkerStartup } from "./startup.js";

describe("Agent Worker 启动边界", () => {
  it("领取工作前拒绝无效 Runtime Manifest", () => {
    const invalid = structuredClone(bundledAgentRuntimeManifest);
    invalid.role_resource_id = "role.missing";

    expect(() => validateAgentWorkerStartup(invalid)).toThrow(
      "role resource reference",
    );
  });
});
