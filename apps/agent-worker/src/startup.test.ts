import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import { describe, expect, it } from "vitest";

import {
  createAgentAdapterFromEnv,
  validateAgentWorkerStartup,
} from "./startup.js";

describe("Agent Worker 启动边界", () => {
  it("领取工作前拒绝无效 Runtime Manifest", () => {
    const invalid = structuredClone(bundledAgentRuntimeManifest);
    invalid.role_resource_id = "role.missing";

    expect(() => validateAgentWorkerStartup(invalid)).toThrow(
      "role resource reference",
    );
  });
});

describe("按 AGENT_RUNTIME_MODE 装配适配器（IK7EU4）", () => {
  it("默认（无 env）装配 fake 适配器", () => {
    expect(createAgentAdapterFromEnv({}).name).toBe("fake-agent-runtime");
    expect(createAgentAdapterFromEnv({ AGENT_RUNTIME_MODE: "fake" }).name).toBe(
      "fake-agent-runtime",
    );
  });

  it("real 模式缺少 new-api env 时拒绝启动", () => {
    expect(() =>
      createAgentAdapterFromEnv({ AGENT_RUNTIME_MODE: "real" }),
    ).toThrow("NEW_API_BASE_URL");
    expect(() =>
      createAgentAdapterFromEnv({
        AGENT_RUNTIME_MODE: "real",
        NEW_API_BASE_URL: "http://new-api:3000",
      }),
    ).toThrow("NEW_API_ROOT_ACCESS_TOKEN");
  });

  it("real 模式装配 newapi 适配器（模型取自 manifest 选中 profile）", () => {
    const adapter = createAgentAdapterFromEnv({
      AGENT_RUNTIME_MODE: "real",
      NEW_API_BASE_URL: "http://new-api:3000",
      NEW_API_ROOT_ACCESS_TOKEN: "test-token",
    });

    expect(adapter.name).toBe("newapi-agent-runtime");
  });

  it("复用启动阶段已校验的 manifest，不再次解析运行时模式", () => {
    expect(
      createAgentAdapterFromEnv(
        { AGENT_RUNTIME_MODE: "staging" },
        bundledAgentRuntimeManifest,
      ).name,
    ).toBe("fake-agent-runtime");
  });

  it("未知 AGENT_RUNTIME_MODE 拒绝启动", () => {
    expect(() =>
      createAgentAdapterFromEnv({ AGENT_RUNTIME_MODE: "staging" }),
    ).toThrow("AGENT_RUNTIME_MODE");
  });
});
